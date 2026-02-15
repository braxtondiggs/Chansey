import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, Repository } from 'typeorm';

import {
  PaperTradingAccount,
  PaperTradingOrder,
  PaperTradingOrderSide,
  PaperTradingOrderStatus,
  PaperTradingOrderType,
  PaperTradingSession,
  PaperTradingSignal,
  PaperTradingSignalDirection,
  PaperTradingSignalType,
  PaperTradingSnapshot,
  SnapshotHolding
} from './entities';
import { PaperTradingMarketDataService } from './paper-trading-market-data.service';

import {
  AlgorithmResult,
  SignalType as AlgoSignalType,
  TradingSignal as StrategySignal
} from '../../algorithm/interfaces';
import { AlgorithmRegistry } from '../../algorithm/registry/algorithm-registry.service';
import { ExchangeKey } from '../../exchange/exchange-key/exchange-key.entity';
import { toErrorInfo } from '../../shared/error.util';
import {
  FeeCalculatorService,
  MetricsCalculatorService,
  Portfolio,
  PortfolioStateService,
  PositionManagerService,
  SlippageService,
  TimeframeType
} from '../backtest/shared';

export interface TradingSignal {
  action: 'BUY' | 'SELL' | 'HOLD';
  coinId: string;
  symbol: string;
  quantity?: number;
  percentage?: number;
  reason: string;
  confidence?: number;
  metadata?: Record<string, any>;
  /** Preserves the original algorithm signal type (e.g. STOP_LOSS, TAKE_PROFIT) */
  originalType?: AlgoSignalType;
}

export interface TickResult {
  processed: boolean;
  signalsReceived: number;
  ordersExecuted: number;
  errors: string[];
  portfolioValue: number;
  prices: Record<string, number>;
}

const mapStrategySignal = (signal: StrategySignal, quoteCurrency: string): TradingSignal => {
  let action: TradingSignal['action'];
  switch (signal.type) {
    case AlgoSignalType.BUY:
      action = 'BUY';
      break;
    case AlgoSignalType.SELL:
    case AlgoSignalType.STOP_LOSS:
    case AlgoSignalType.TAKE_PROFIT:
      action = 'SELL';
      break;
    default:
      action = 'HOLD';
  }

  // Extract symbol from coinId using session's quote currency
  const symbol = `${signal.coinId}/${quoteCurrency}`;

  return {
    action,
    coinId: signal.coinId,
    symbol,
    quantity: signal.quantity,
    percentage: signal.strength,
    reason: signal.reason,
    confidence: signal.confidence,
    metadata: signal.metadata as Record<string, any>,
    originalType: signal.type
  };
};

const classifySignalType = (signal: TradingSignal): PaperTradingSignalType => {
  if (signal.originalType === AlgoSignalType.STOP_LOSS || signal.originalType === AlgoSignalType.TAKE_PROFIT) {
    return PaperTradingSignalType.RISK_CONTROL;
  }
  if (signal.action === 'BUY') return PaperTradingSignalType.ENTRY;
  if (signal.action === 'SELL') return PaperTradingSignalType.EXIT;
  return PaperTradingSignalType.ADJUSTMENT;
};

@Injectable()
export class PaperTradingEngineService {
  private readonly logger = new Logger(PaperTradingEngineService.name);

  /** Maximum allocation per trade (20% of portfolio) */
  private static readonly MAX_ALLOCATION = 0.2;
  /** Minimum allocation per trade (5% of portfolio) */
  private static readonly MIN_ALLOCATION = 0.05;

  constructor(
    @InjectRepository(PaperTradingAccount)
    private readonly accountRepository: Repository<PaperTradingAccount>,
    @InjectRepository(PaperTradingOrder)
    private readonly orderRepository: Repository<PaperTradingOrder>,
    @InjectRepository(PaperTradingSignal)
    private readonly signalRepository: Repository<PaperTradingSignal>,
    @InjectRepository(PaperTradingSnapshot)
    private readonly snapshotRepository: Repository<PaperTradingSnapshot>,
    private readonly dataSource: DataSource,
    private readonly marketDataService: PaperTradingMarketDataService,
    private readonly algorithmRegistry: AlgorithmRegistry,
    // Shared backtest services
    private readonly slippageService: SlippageService,
    private readonly feeCalculator: FeeCalculatorService,
    private readonly positionManager: PositionManagerService,
    private readonly metricsCalculator: MetricsCalculatorService,
    private readonly portfolioState: PortfolioStateService
  ) {}

  /**
   * Process a single tick for a paper trading session
   * This is the main entry point called by the processor
   */
  async processTick(session: PaperTradingSession, exchangeKey: ExchangeKey): Promise<TickResult> {
    const errors: string[] = [];
    let signalsReceived = 0;
    let ordersExecuted = 0;
    const now = new Date();

    try {
      // 1. Get current portfolio state
      const accounts = await this.accountRepository.find({
        where: { session: { id: session.id } }
      });

      const portfolio = this.buildPortfolioFromAccounts(accounts);
      const quoteCurrency = this.getQuoteCurrency(accounts);

      // 2. Determine which symbols to fetch prices for
      const holdingSymbols = accounts
        .filter((a) => a.currency !== quoteCurrency && a.total > 0)
        .map((a) => `${a.currency}/${quoteCurrency}`);

      // Add symbols from algorithm config if any
      const configSymbols = this.extractSymbolsFromConfig(session.algorithmConfig);
      const allSymbols = [...new Set([...holdingSymbols, ...configSymbols])];

      if (allSymbols.length === 0) {
        // Default to common trading pairs using session's quote currency
        allSymbols.push(`BTC/${quoteCurrency}`, `ETH/${quoteCurrency}`);
      }

      // 3. Fetch current prices
      const exchangeSlug = exchangeKey.exchange?.slug ?? 'binance_us';
      const prices = await this.marketDataService.getPrices(exchangeSlug, allSymbols);

      const priceMap: Record<string, number> = {};
      for (const [symbol, priceData] of prices) {
        priceMap[symbol] = priceData.price;
      }

      // 4. Update portfolio values with current prices
      const updatedPortfolio = this.updatePortfolioWithPrices(portfolio, priceMap, quoteCurrency);

      // 5. Run algorithm to get signals
      const signals = await this.runAlgorithm(session, updatedPortfolio, priceMap, accounts, quoteCurrency);
      signalsReceived = signals.length;

      // 6. Process signals and execute orders
      for (const signal of signals) {
        // Save signal to database
        const signalEntity = await this.saveSignal(session, signal);

        if (signal.action !== 'HOLD') {
          try {
            const order = await this.executeOrder(
              session,
              signal,
              signalEntity,
              updatedPortfolio,
              priceMap,
              exchangeSlug,
              quoteCurrency,
              now
            );

            if (order) {
              ordersExecuted++;
            }
          } catch (error: unknown) {
            const err = toErrorInfo(error);
            errors.push(`Failed to execute ${signal.action} order for ${signal.symbol}: ${err.message}`);
            this.logger.warn(`Order execution failed: ${err.message}`);
          }
        }

        // Mark signal as processed
        signalEntity.processed = true;
        signalEntity.processedAt = new Date();
        await this.signalRepository.save(signalEntity);
      }

      // 7. Calculate current portfolio value
      const finalAccounts = await this.accountRepository.find({
        where: { session: { id: session.id } }
      });
      const finalPortfolio = this.buildPortfolioFromAccounts(finalAccounts);
      const finalPortfolioValue = this.calculatePortfolioValue(finalPortfolio, priceMap, quoteCurrency);

      // 8. Take snapshot (periodically)
      const shouldSnapshot = session.tickCount % 10 === 0 || ordersExecuted > 0;
      if (shouldSnapshot) {
        await this.saveSnapshot(session, finalPortfolio, finalPortfolioValue, priceMap, quoteCurrency, now);
      }

      return {
        processed: true,
        signalsReceived,
        ordersExecuted,
        errors,
        portfolioValue: finalPortfolioValue,
        prices: priceMap
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Tick processing failed for session ${session.id}: ${err.message}`, err.stack);
      errors.push(err.message);

      return {
        processed: false,
        signalsReceived,
        ordersExecuted,
        errors,
        portfolioValue: session.currentPortfolioValue ?? session.initialCapital,
        prices: {}
      };
    }
  }

  /**
   * Run the algorithm and get trading signals
   */
  private async runAlgorithm(
    session: PaperTradingSession,
    portfolio: Portfolio,
    prices: Record<string, number>,
    accounts: PaperTradingAccount[],
    quoteCurrency: string
  ): Promise<TradingSignal[]> {
    try {
      // Build context for algorithm
      const coins = this.extractCoinsFromPrices(prices);
      const priceData = this.buildPriceDataContext(prices);
      const positions = this.buildPositionsContext(accounts, quoteCurrency);

      // Build a minimal context compatible with algorithm execution
      // Paper trading uses simplified coin objects with just id/symbol
      const context = {
        coins,
        priceData,
        timestamp: new Date(),
        config: session.algorithmConfig ?? {},
        positions,
        availableBalance: portfolio.cashBalance,
        metadata: {
          sessionId: session.id,
          isPaperTrading: true
        }
      };

      // Cast to any since paper trading uses a simplified context
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: AlgorithmResult = await this.algorithmRegistry.executeAlgorithm(
        session.algorithm?.id ?? '',
        context as any
      );

      if (result.success && result.signals?.length) {
        return result.signals
          .map((signal) => mapStrategySignal(signal, quoteCurrency))
          .filter((signal) => signal.action !== 'HOLD');
      }

      return [];
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Algorithm execution failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Execute a paper trading order using atomic transactions
   */
  private async executeOrder(
    session: PaperTradingSession,
    signal: TradingSignal,
    signalEntity: PaperTradingSignal,
    portfolio: Portfolio,
    prices: Record<string, number>,
    exchangeSlug: string,
    quoteCurrency: string,
    timestamp: Date
  ): Promise<PaperTradingOrder | null> {
    const basePrice = prices[signal.symbol];
    if (!basePrice) {
      this.logger.warn(`No price data available for ${signal.symbol}`);
      return null;
    }

    const [baseCurrency] = signal.symbol.split('/');
    const isBuy = signal.action === 'BUY';

    // Calculate slippage before transaction
    const slippageResult = await this.marketDataService.calculateRealisticSlippage(
      exchangeSlug,
      signal.symbol,
      signal.quantity ?? (portfolio.totalValue * 0.1) / basePrice,
      isBuy ? 'BUY' : 'SELL'
    );

    const executionPrice =
      slippageResult.estimatedPrice || basePrice * (1 + ((isBuy ? 1 : -1) * slippageResult.slippageBps) / 10000);
    const slippageBps = slippageResult.slippageBps;

    // Use transaction with pessimistic locking for atomic account updates
    return this.dataSource.transaction(async (transactionalEntityManager) => {
      // Get accounts with pessimistic write lock to prevent race conditions
      const quoteAccount = await transactionalEntityManager.findOne(PaperTradingAccount, {
        where: { session: { id: session.id }, currency: quoteCurrency },
        lock: { mode: 'pessimistic_write' }
      });

      let baseAccount = await transactionalEntityManager.findOne(PaperTradingAccount, {
        where: { session: { id: session.id }, currency: baseCurrency },
        lock: { mode: 'pessimistic_write' }
      });

      if (!quoteAccount) {
        throw new Error(`Quote currency account (${quoteCurrency}) not found`);
      }

      let quantity = 0;
      let totalValue = 0;

      if (isBuy) {
        // Calculate quantity based on signal
        if (signal.quantity) {
          quantity = signal.quantity;
        } else if (signal.percentage) {
          const investmentAmount =
            portfolio.totalValue * Math.min(signal.percentage, PaperTradingEngineService.MAX_ALLOCATION);
          quantity = investmentAmount / executionPrice;
        } else if (signal.confidence !== undefined) {
          const allocation =
            PaperTradingEngineService.MIN_ALLOCATION +
            signal.confidence * (PaperTradingEngineService.MAX_ALLOCATION - PaperTradingEngineService.MIN_ALLOCATION);
          const investmentAmount = portfolio.totalValue * allocation;
          quantity = investmentAmount / executionPrice;
        } else {
          const investmentAmount = portfolio.totalValue * PaperTradingEngineService.MIN_ALLOCATION;
          quantity = investmentAmount / executionPrice;
        }

        totalValue = quantity * executionPrice;

        // Calculate fee
        const feeConfig = this.feeCalculator.fromFlatRate(session.tradingFee);
        const feeResult = this.feeCalculator.calculateFee({ tradeValue: totalValue }, feeConfig);
        const fee = feeResult.fee;

        // Check if we have enough balance
        if (quoteAccount.available < totalValue + fee) {
          this.logger.warn(`Insufficient ${quoteCurrency} balance for BUY order`);
          return null;
        }

        // Update quote account atomically
        quoteAccount.available -= totalValue + fee;
        await transactionalEntityManager.save(quoteAccount);

        // Update or create base account atomically
        if (!baseAccount) {
          baseAccount = transactionalEntityManager.create(PaperTradingAccount, {
            currency: baseCurrency,
            available: 0,
            locked: 0,
            session
          });
        }

        // Update average cost
        const oldQuantity = baseAccount.available;
        const oldCost = baseAccount.averageCost ?? 0;
        const newQuantity = oldQuantity + quantity;
        baseAccount.averageCost =
          oldQuantity > 0 ? (oldCost * oldQuantity + executionPrice * quantity) / newQuantity : executionPrice;
        baseAccount.available = newQuantity;
        await transactionalEntityManager.save(baseAccount);

        // Create order record
        const order = transactionalEntityManager.create(PaperTradingOrder, {
          side: PaperTradingOrderSide.BUY,
          orderType: PaperTradingOrderType.MARKET,
          status: PaperTradingOrderStatus.FILLED,
          symbol: signal.symbol,
          baseCurrency,
          quoteCurrency,
          requestedQuantity: quantity,
          filledQuantity: quantity,
          executedPrice: executionPrice,
          averagePrice: executionPrice,
          slippageBps,
          fee,
          feeAsset: quoteCurrency,
          totalValue,
          executedAt: timestamp,
          session,
          signal: signalEntity,
          metadata: {
            reason: signal.reason,
            confidence: signal.confidence,
            basePrice
          }
        });

        return transactionalEntityManager.save(order);
      }

      // SELL order
      if (!baseAccount || baseAccount.available <= 0) {
        this.logger.warn(`No ${baseCurrency} position to sell`);
        return null;
      }

      const costBasis = baseAccount.averageCost ?? 0;

      // Calculate quantity to sell
      if (signal.quantity) {
        quantity = Math.min(signal.quantity, baseAccount.available);
      } else if (signal.percentage) {
        quantity = baseAccount.available * Math.min(signal.percentage, 1);
      } else if (signal.confidence !== undefined) {
        const sellPercent = 0.25 + signal.confidence * 0.75;
        quantity = baseAccount.available * sellPercent;
      } else {
        quantity = baseAccount.available * 0.5;
      }

      totalValue = quantity * executionPrice;

      // Calculate fee
      const feeConfig = this.feeCalculator.fromFlatRate(session.tradingFee);
      const feeResult = this.feeCalculator.calculateFee({ tradeValue: totalValue }, feeConfig);
      const fee = feeResult.fee;

      // Calculate realized P&L
      const realizedPnL = (executionPrice - costBasis) * quantity - fee;
      const realizedPnLPercent = costBasis > 0 ? (executionPrice - costBasis) / costBasis : 0;

      // Update base account atomically
      baseAccount.available -= quantity;
      if (baseAccount.available < 0.00000001) {
        baseAccount.available = 0;
        baseAccount.averageCost = null;
      }
      await transactionalEntityManager.save(baseAccount);

      // Update quote account atomically
      quoteAccount.available += totalValue - fee;
      await transactionalEntityManager.save(quoteAccount);

      // Create order record
      const order = transactionalEntityManager.create(PaperTradingOrder, {
        side: PaperTradingOrderSide.SELL,
        orderType: PaperTradingOrderType.MARKET,
        status: PaperTradingOrderStatus.FILLED,
        symbol: signal.symbol,
        baseCurrency,
        quoteCurrency,
        requestedQuantity: quantity,
        filledQuantity: quantity,
        executedPrice: executionPrice,
        averagePrice: executionPrice,
        slippageBps,
        fee,
        feeAsset: quoteCurrency,
        totalValue,
        realizedPnL,
        realizedPnLPercent,
        costBasis,
        executedAt: timestamp,
        session,
        signal: signalEntity,
        metadata: {
          reason: signal.reason,
          confidence: signal.confidence,
          basePrice
        }
      });

      return transactionalEntityManager.save(order);
    });
  }

  /**
   * Save a signal to the database
   */
  private async saveSignal(session: PaperTradingSession, signal: TradingSignal): Promise<PaperTradingSignal> {
    const signalEntity = this.signalRepository.create({
      signalType: classifySignalType(signal),
      direction:
        signal.action === 'BUY'
          ? PaperTradingSignalDirection.LONG
          : signal.action === 'SELL'
            ? PaperTradingSignalDirection.SHORT
            : PaperTradingSignalDirection.FLAT,
      instrument: signal.symbol,
      quantity: signal.quantity ?? 0,
      price: undefined, // Will be filled by market data
      confidence: signal.confidence,
      reason: signal.reason,
      payload: signal.metadata,
      processed: false,
      session
    });

    return this.signalRepository.save(signalEntity);
  }

  /**
   * Save a portfolio snapshot
   */
  private async saveSnapshot(
    session: PaperTradingSession,
    portfolio: Portfolio,
    portfolioValue: number,
    prices: Record<string, number>,
    quoteCurrency: string,
    timestamp: Date
  ): Promise<PaperTradingSnapshot> {
    const cumulativeReturn = (portfolioValue - session.initialCapital) / session.initialCapital;

    // Calculate drawdown
    const peakValue = session.peakPortfolioValue ?? session.initialCapital;
    const drawdown = peakValue > 0 ? (peakValue - portfolioValue) / peakValue : 0;

    // Build holdings map
    const holdings: Record<string, SnapshotHolding> = {};
    for (const [coinId, position] of portfolio.positions) {
      const symbol = `${coinId}/${quoteCurrency}`;
      const price = prices[symbol] ?? 0;
      const value = position.quantity * price;
      const unrealizedPnL = position.averagePrice > 0 ? (price - position.averagePrice) * position.quantity : 0;
      const unrealizedPnLPercent =
        position.averagePrice > 0 ? (price - position.averagePrice) / position.averagePrice : 0;

      holdings[coinId] = {
        quantity: position.quantity,
        value,
        price,
        averageCost: position.averagePrice,
        unrealizedPnL,
        unrealizedPnLPercent
      };
    }

    // Calculate unrealized P&L
    let unrealizedPnL = 0;
    for (const holding of Object.values(holdings)) {
      unrealizedPnL += holding.unrealizedPnL ?? 0;
    }

    // Get realized P&L from orders
    const realizedPnLResult = await this.orderRepository
      .createQueryBuilder('order')
      .select('SUM(order.realizedPnL)', 'totalRealizedPnL')
      .where('order.sessionId = :sessionId', { sessionId: session.id })
      .andWhere('order.realizedPnL IS NOT NULL')
      .getRawOne();

    const snapshot = this.snapshotRepository.create({
      portfolioValue,
      cashBalance: portfolio.cashBalance,
      holdings,
      cumulativeReturn,
      drawdown,
      unrealizedPnL,
      realizedPnL: realizedPnLResult?.totalRealizedPnL ?? 0,
      prices,
      timestamp,
      session
    });

    return this.snapshotRepository.save(snapshot);
  }

  /**
   * Calculate final session metrics
   */
  async calculateSessionMetrics(session: PaperTradingSession): Promise<{
    sharpeRatio: number;
    winRate: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    maxDrawdown: number;
  }> {
    // Get all orders
    const orders = await this.orderRepository.find({
      where: { session: { id: session.id } }
    });

    const sellOrders = orders.filter((o) => o.side === PaperTradingOrderSide.SELL);
    const winningTrades = sellOrders.filter((o) => (o.realizedPnL ?? 0) > 0).length;
    const losingTrades = sellOrders.filter((o) => (o.realizedPnL ?? 0) < 0).length;
    const totalTrades = orders.length;
    const winRate = sellOrders.length > 0 ? winningTrades / sellOrders.length : 0;

    // Get snapshots for Sharpe ratio
    const snapshots = await this.snapshotRepository.find({
      where: { session: { id: session.id } },
      order: { timestamp: 'ASC' }
    });

    const returns: number[] = [];
    for (let i = 1; i < snapshots.length; i++) {
      const previous = snapshots[i - 1].portfolioValue;
      const current = snapshots[i].portfolioValue;
      if (previous > 0) {
        returns.push((current - previous) / previous);
      }
    }

    // Calculate Sharpe ratio using 30-second intervals (crypto 24/7)
    // Using HOURLY as approximation since we have high-frequency data
    const sharpeRatio =
      returns.length > 2
        ? this.metricsCalculator.calculateSharpeRatio(returns, {
            timeframe: TimeframeType.HOURLY, // Closest approximation for high-frequency data
            useCryptoCalendar: true,
            riskFreeRate: 0.02
          })
        : 0;

    // Calculate max drawdown
    let maxDrawdown = 0;
    let peak = session.initialCapital;
    for (const snapshot of snapshots) {
      if (snapshot.portfolioValue > peak) {
        peak = snapshot.portfolioValue;
      }
      const drawdown = peak > 0 ? (peak - snapshot.portfolioValue) / peak : 0;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return {
      sharpeRatio,
      winRate,
      totalTrades,
      winningTrades,
      losingTrades,
      maxDrawdown
    };
  }

  /**
   * Helper: Build portfolio from account entities
   */
  private buildPortfolioFromAccounts(accounts: PaperTradingAccount[]): Portfolio {
    const quoteCurrency = this.getQuoteCurrency(accounts);
    const quoteAccount = accounts.find((a) => a.currency === quoteCurrency);

    const positions = new Map<string, { coinId: string; quantity: number; averagePrice: number; totalValue: number }>();

    for (const account of accounts) {
      if (account.currency !== quoteCurrency && account.total > 0) {
        positions.set(account.currency, {
          coinId: account.currency,
          quantity: account.total,
          averagePrice: account.averageCost ?? 0,
          totalValue: 0 // Will be calculated with prices
        });
      }
    }

    return {
      cashBalance: quoteAccount?.available ?? 0,
      positions,
      totalValue: quoteAccount?.available ?? 0 // Will be updated with positions
    };
  }

  /**
   * Helper: Get quote currency from accounts
   * Supports common quote currencies including fiat and crypto bases
   */
  private getQuoteCurrency(accounts: PaperTradingAccount[]): string {
    // Ordered by priority - fiat first, then stable coins, then crypto bases
    const quoteCurrencies = ['USD', 'EUR', 'GBP', 'USDT', 'USDC', 'BUSD', 'DAI', 'BTC', 'ETH'];
    const quoteAccount = accounts.find((a) => quoteCurrencies.includes(a.currency));
    return quoteAccount?.currency ?? 'USD';
  }

  /**
   * Helper: Update portfolio with current prices
   */
  private updatePortfolioWithPrices(
    portfolio: Portfolio,
    prices: Record<string, number>,
    quoteCurrency: string
  ): Portfolio {
    let positionsValue = 0;

    for (const [coinId, position] of portfolio.positions) {
      const symbol = `${coinId}/${quoteCurrency}`;
      const price = prices[symbol] ?? 0;
      position.totalValue = position.quantity * price;
      positionsValue += position.totalValue;
    }

    portfolio.totalValue = portfolio.cashBalance + positionsValue;
    return portfolio;
  }

  /**
   * Helper: Calculate total portfolio value
   */
  private calculatePortfolioValue(portfolio: Portfolio, prices: Record<string, number>, quoteCurrency: string): number {
    let total = portfolio.cashBalance;

    for (const [coinId, position] of portfolio.positions) {
      const symbol = `${coinId}/${quoteCurrency}`;
      const price = prices[symbol] ?? 0;
      total += position.quantity * price;
    }

    return total;
  }

  /**
   * Helper: Extract symbols from algorithm config
   */
  private extractSymbolsFromConfig(config?: Record<string, any>): string[] {
    if (!config) return [];

    const symbols: string[] = [];

    if (config.symbols && Array.isArray(config.symbols)) {
      symbols.push(...config.symbols);
    }
    if (config.tradingPairs && Array.isArray(config.tradingPairs)) {
      symbols.push(...config.tradingPairs);
    }

    return symbols;
  }

  /**
   * Helper: Extract coins from prices map
   */
  private extractCoinsFromPrices(prices: Record<string, number>): Array<{ id: string; symbol: string }> {
    const coins: Array<{ id: string; symbol: string }> = [];

    for (const symbol of Object.keys(prices)) {
      const [baseCurrency] = symbol.split('/');
      coins.push({
        id: baseCurrency,
        symbol: baseCurrency
      });
    }

    return coins;
  }

  /**
   * Helper: Build price data context for algorithm
   */
  private buildPriceDataContext(prices: Record<string, number>): Record<string, Array<{ avg: number; date: Date }>> {
    const priceData: Record<string, Array<{ avg: number; date: Date }>> = {};
    const now = new Date();

    for (const [symbol, price] of Object.entries(prices)) {
      const [baseCurrency] = symbol.split('/');
      priceData[baseCurrency] = [{ avg: price, date: now }];
    }

    return priceData;
  }

  /**
   * Helper: Build positions context for algorithm
   */
  private buildPositionsContext(accounts: PaperTradingAccount[], quoteCurrency: string): Record<string, number> {
    const positions: Record<string, number> = {};

    for (const account of accounts) {
      if (account.currency !== quoteCurrency && account.total > 0) {
        positions[account.currency] = account.total;
      }
    }

    return positions;
  }
}
