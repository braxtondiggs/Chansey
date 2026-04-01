import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, Repository } from 'typeorm';

import { getAllocationLimits, PipelineStage, SignalReasonCode } from '@chansey/api-interfaces';

import {
  PaperTradingAccount,
  PaperTradingExitType,
  PaperTradingOrder,
  PaperTradingOrderSide,
  PaperTradingOrderStatus,
  PaperTradingOrderType,
  PaperTradingSession,
  PaperTradingSignal,
  PaperTradingSignalDirection,
  PaperTradingSignalStatus,
  PaperTradingSignalType,
  PaperTradingSnapshot,
  SnapshotHolding
} from './entities';
import { PaperTradingMarketDataService } from './paper-trading-market-data.service';

import {
  AlgorithmContext,
  AlgorithmResult,
  SignalType as AlgoSignalType,
  TradingSignal as StrategySignal
} from '../../algorithm/interfaces';
import { AlgorithmRegistry } from '../../algorithm/registry/algorithm-registry.service';
import { getQuoteCurrency as getQuoteCurrencyUtil } from '../../exchange/constants';
import { ExchangeKey } from '../../exchange/exchange-key/exchange-key.entity';
import { CompositeRegimeService } from '../../market-regime/composite-regime.service';
import { CandleData } from '../../ohlc/ohlc-candle.entity';
import { DEFAULT_RISK_LEVEL } from '../../risk/risk.constants';
import { toErrorInfo } from '../../shared/error.util';
import {
  BacktestExitTracker,
  computeAtrFromOHLC,
  DEFAULT_OPPORTUNITY_SELLING_CONFIG,
  FeeCalculatorService,
  MetricsCalculatorService,
  OpportunitySellingUserConfig,
  Portfolio,
  PortfolioStateService,
  PositionAnalysisService,
  PositionManagerService,
  SerializableExitTrackerState,
  SignalFilterChainService,
  SerializableThrottleState,
  SignalThrottleService,
  ThrottleState,
  TimeframeType
} from '../backtest/shared';
import { resolveExitConfig } from '../utils/exit-config-merge.util';

export interface TradingSignal {
  action: 'BUY' | 'SELL' | 'HOLD' | 'OPEN_SHORT' | 'CLOSE_SHORT';
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

export type ExecuteOrderStatus = 'success' | 'insufficient_funds' | 'no_price' | 'no_position' | 'hold_period';

export interface ExecuteOrderResult {
  status: ExecuteOrderStatus;
  order: PaperTradingOrder | null;
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
    case AlgoSignalType.SHORT_ENTRY:
      action = 'OPEN_SHORT';
      break;
    case AlgoSignalType.SHORT_EXIT:
      action = 'CLOSE_SHORT';
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
  if (signal.action === 'BUY' || signal.action === 'OPEN_SHORT') return PaperTradingSignalType.ENTRY;
  if (signal.action === 'SELL' || signal.action === 'CLOSE_SHORT') return PaperTradingSignalType.EXIT;
  return PaperTradingSignalType.ADJUSTMENT;
};

@Injectable()
export class PaperTradingEngineService {
  private readonly logger = new Logger(PaperTradingEngineService.name);

  /** In-memory throttle state per session (survives across ticks, resets on restart) */
  private readonly throttleStates = new Map<string, ThrottleState>();

  /** In-memory exit tracker per session (SL/TP/trailing stop monitoring) */
  private readonly exitTrackers = new Map<string, BacktestExitTracker>();

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
    private readonly feeCalculator: FeeCalculatorService,
    private readonly positionManager: PositionManagerService,
    private readonly metricsCalculator: MetricsCalculatorService,
    private readonly portfolioState: PortfolioStateService,
    private readonly signalThrottle: SignalThrottleService,
    private readonly compositeRegimeService: CompositeRegimeService,
    private readonly signalFilterChain: SignalFilterChainService,
    private readonly positionAnalysis: PositionAnalysisService
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

      const quoteCurrency = this.getQuoteCurrency(accounts);
      const portfolio = this.buildPortfolioFromAccounts(accounts, quoteCurrency);

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

      // 3b. Fetch historical candles for algorithm indicator computation
      const historicalCandles: Record<string, CandleData[]> = {};
      const candleResults = await Promise.all(
        allSymbols.map(async (symbol) => {
          const candles = await this.marketDataService.getHistoricalCandles(
            exchangeSlug,
            symbol,
            '1h',
            100,
            session.user
          );
          return { symbol, candles };
        })
      );
      for (const { symbol, candles } of candleResults) {
        if (candles.length > 0) {
          historicalCandles[symbol] = candles;
        }
      }

      // 4. Update portfolio values with current prices
      const updatedPortfolio = this.updatePortfolioWithPrices(portfolio, priceMap, quoteCurrency);

      // 4b. Check exit levels (SL/TP/trailing) before running algorithm
      const exitTracker = this.getOrCreateExitTracker(session);
      let exitOrdersExecuted = 0;
      if (exitTracker && exitTracker.size > 0) {
        exitOrdersExecuted = await this.checkAndExecuteExits(
          session,
          exitTracker,
          priceMap,
          historicalCandles,
          quoteCurrency,
          exchangeSlug,
          now
        );
        ordersExecuted += exitOrdersExecuted;
      }

      // 4c. Refresh portfolio after exits so algorithm sees accurate state
      let algoPortfolio = updatedPortfolio;
      if (exitOrdersExecuted > 0) {
        const refreshedAccounts = await this.accountRepository.find({
          where: { session: { id: session.id } }
        });
        algoPortfolio = this.updatePortfolioWithPrices(
          this.buildPortfolioFromAccounts(refreshedAccounts, quoteCurrency),
          priceMap,
          quoteCurrency
        );
      }

      // 5. Run algorithm to get signals
      const signals = await this.runAlgorithm(
        session,
        algoPortfolio,
        priceMap,
        accounts,
        quoteCurrency,
        historicalCandles
      );
      signalsReceived = signals.length;

      // 5b. Apply signal throttle: cooldowns, daily cap, min sell %
      const throttleState = this.getOrCreateThrottleState(session.id);
      const throttleConfig = this.signalThrottle.resolveConfig(session.algorithmConfig);
      const filteredSignals = this.signalThrottle.filterSignals(
        signals,
        throttleState,
        throttleConfig,
        Date.now()
      ) as TradingSignal[];

      if (signals.length > filteredSignals.length) {
        this.logger.debug(
          `Throttled ${signals.length - filteredSignals.length}/${signals.length} signals for session ${session.id}`
        );
        // Persist throttled signals as REJECTED with reason code
        const throttledSymbols = new Set(filteredSignals.map((s) => s.symbol));
        const throttledSignals = signals.filter((s) => !throttledSymbols.has(s.symbol));
        for (const blocked of throttledSignals) {
          const entity = await this.saveSignal(session, blocked);
          entity.status = PaperTradingSignalStatus.REJECTED;
          entity.rejectionCode = SignalReasonCode.SIGNAL_THROTTLED;
          entity.processed = true;
          entity.processedAt = new Date();
          await this.signalRepository.save(entity);
        }
      }

      // 5c. Apply regime filter chain: gate BUY in bear/extreme, scale allocations
      const compositeRegime = this.compositeRegimeService.getCompositeRegime();
      const { maxAllocation, minAllocation } = this.getSessionAllocationLimits(session);
      const regimeResult = this.signalFilterChain.apply(
        filteredSignals,
        {
          compositeRegime,
          riskLevel: session.riskLevel ?? DEFAULT_RISK_LEVEL,
          regimeGateEnabled: true,
          regimeScaledSizingEnabled: true,
          tradingContext: 'paper'
        },
        { maxAllocation, minAllocation }
      );

      const regimeFilteredSignals = regimeResult.signals as TradingSignal[];
      const adjustedAllocation = {
        maxAllocation: regimeResult.maxAllocation,
        minAllocation: regimeResult.minAllocation
      };

      if (regimeResult.regimeGateBlockedCount > 0) {
        this.logger.debug(
          `Regime gate blocked ${regimeResult.regimeGateBlockedCount} signals in ${compositeRegime} regime for session ${session.id}`
        );
        // Persist regime-gated signals as REJECTED with reason code
        const regimePassedSymbols = new Set(regimeFilteredSignals.map((s) => s.symbol));
        const regimeBlockedSignals = filteredSignals.filter((s: TradingSignal) => !regimePassedSymbols.has(s.symbol));
        for (const blocked of regimeBlockedSignals) {
          const entity = await this.saveSignal(session, blocked);
          entity.status = PaperTradingSignalStatus.REJECTED;
          entity.rejectionCode = SignalReasonCode.REGIME_GATE;
          entity.processed = true;
          entity.processedAt = new Date();
          await this.signalRepository.save(entity);
        }
      }

      // 6. Process signals and execute orders
      // Build set of currently-held coins to prevent duplicate BUY signals
      const activeAccounts =
        exitOrdersExecuted > 0
          ? await this.accountRepository.find({ where: { session: { id: session.id } } })
          : accounts;
      const heldCoins = new Set(
        activeAccounts.filter((a) => a.currency !== quoteCurrency && a.total > 1e-8).map((a) => a.currency)
      );

      let currentPortfolio = updatedPortfolio;
      for (const signal of regimeFilteredSignals) {
        // Skip BUY if position already held for this symbol
        if (signal.action === 'BUY') {
          const [baseCurrency] = signal.symbol.split('/');
          if (heldCoins.has(baseCurrency)) {
            this.logger.debug(`Skipped duplicate BUY for ${signal.symbol}: position already held`);
            continue;
          }
        }

        // Save signal to database
        const signalEntity = await this.saveSignal(session, signal);

        if (signal.action !== 'HOLD') {
          try {
            let result = await this.executeOrder(
              session,
              signal,
              signalEntity,
              currentPortfolio,
              priceMap,
              exchangeSlug,
              quoteCurrency,
              now,
              adjustedAllocation
            );

            // Opportunity selling: only when BUY fails due to insufficient funds
            let opportunitySellingAttempted = false;
            if (result.status === 'insufficient_funds' && signal.action === 'BUY') {
              opportunitySellingAttempted = true;
              const oppSellCount = await this.attemptOpportunitySelling(
                session,
                signal,
                priceMap,
                quoteCurrency,
                exchangeSlug,
                now,
                adjustedAllocation
              );

              if (oppSellCount > 0) {
                ordersExecuted += oppSellCount;

                // Re-fetch fresh portfolio after sells, then retry BUY
                const retryAccounts = await this.accountRepository.find({
                  where: { session: { id: session.id } }
                });
                const retryPortfolio = this.buildPortfolioFromAccounts(retryAccounts, quoteCurrency);
                const updatedRetryPortfolio = this.updatePortfolioWithPrices(retryPortfolio, priceMap, quoteCurrency);

                result = await this.executeOrder(
                  session,
                  signal,
                  signalEntity,
                  updatedRetryPortfolio,
                  priceMap,
                  exchangeSlug,
                  quoteCurrency,
                  now,
                  adjustedAllocation
                );
              }
            }

            if (result.order) {
              ordersExecuted++;
              signalEntity.status = PaperTradingSignalStatus.SIMULATED;

              // Track newly bought coin to block subsequent same-tick BUY signals
              if (signal.action === 'BUY') {
                const [bought] = signal.symbol.split('/');
                heldCoins.add(bought);
              }

              // Remove sold coin so it can be re-bought by a later signal in the same tick
              if (signal.action === 'SELL') {
                const [sold] = signal.symbol.split('/');
                heldCoins.delete(sold);
              }

              // Register position in exit tracker on BUY fill
              if (exitTracker && signal.action === 'BUY') {
                const [baseCurrency] = signal.symbol.split('/');
                const candles = historicalCandles[signal.symbol];
                let atr: number | undefined;
                if (candles && candles.length > 0) {
                  const highs = candles.map((c) => c.high);
                  const lows = candles.map((c) => c.low);
                  const closes = candles.map((c) => c.avg);
                  atr = computeAtrFromOHLC(highs, lows, closes, session.exitConfig?.atrPeriod ?? 14);
                }
                if (result.order.executedPrice != null && result.order.executedPrice > 0) {
                  exitTracker.onBuy(baseCurrency, result.order.executedPrice, result.order.filledQuantity, atr);
                } else {
                  this.logger.warn(
                    `Skipping exit tracker registration for ${baseCurrency}: executedPrice is ${result.order.executedPrice}`
                  );
                }
              }

              // Update exit tracker on SELL fill
              if (exitTracker && signal.action === 'SELL') {
                const [baseCurrency] = signal.symbol.split('/');
                exitTracker.onSell(baseCurrency, result.order.filledQuantity);
              }

              // Refresh portfolio for next signal iteration
              const refreshedAccounts = await this.accountRepository.find({
                where: { session: { id: session.id } }
              });
              currentPortfolio = this.updatePortfolioWithPrices(
                this.buildPortfolioFromAccounts(refreshedAccounts, quoteCurrency),
                priceMap,
                quoteCurrency
              );
            } else {
              // No order produced — rejected (insufficient_funds, no_position, no_price, hold_period)
              signalEntity.status = PaperTradingSignalStatus.REJECTED;
              if (result.status === 'insufficient_funds') {
                signalEntity.rejectionCode = opportunitySellingAttempted
                  ? SignalReasonCode.OPPORTUNITY_SELLING_REJECTED
                  : SignalReasonCode.INSUFFICIENT_FUNDS;
              } else if (result.status === 'no_price') {
                signalEntity.rejectionCode = SignalReasonCode.SYMBOL_RESOLUTION_FAILED;
              } else if (result.status === 'hold_period') {
                signalEntity.rejectionCode = SignalReasonCode.TRADE_COOLDOWN;
              }
            }
          } catch (error: unknown) {
            const err = toErrorInfo(error);
            errors.push(`Failed to execute ${signal.action} order for ${signal.symbol}: ${err.message}`);
            this.logger.warn(`Order execution failed: ${err.message}`);
            signalEntity.status = PaperTradingSignalStatus.ERROR;
          }
        } else {
          // HOLD action — valid intentional no-op
          signalEntity.status = PaperTradingSignalStatus.SIMULATED;
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
      const finalPortfolio = this.buildPortfolioFromAccounts(finalAccounts, quoteCurrency);
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
    quoteCurrency: string,
    historicalCandles: Record<string, CandleData[]> = {}
  ): Promise<TradingSignal[]> {
    try {
      // Build context for algorithm
      const coins = this.extractCoinsFromPrices(prices);
      const priceData = this.buildPriceDataContext(prices, historicalCandles);
      const positions = this.buildPositionsContext(accounts, quoteCurrency);

      const context: AlgorithmContext = {
        coins,
        priceData,
        timestamp: new Date(),
        config: session.algorithmConfig ?? {},
        positions,
        availableBalance: portfolio.cashBalance,
        metadata: {
          sessionId: session.id,
          isPaperTrading: true
        },
        compositeRegime: this.compositeRegimeService.getCompositeRegime(),
        volatilityRegime: this.compositeRegimeService.getVolatilityRegime()
      };

      const result: AlgorithmResult = await this.algorithmRegistry.executeAlgorithm(
        session.algorithm?.id ?? '',
        context
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
    timestamp: Date,
    allocationOverrides?: { maxAllocation: number; minAllocation: number },
    exitType?: PaperTradingExitType
  ): Promise<ExecuteOrderResult> {
    const basePrice = prices[signal.symbol];
    if (!basePrice) {
      this.logger.warn(`No price data available for ${signal.symbol}`);
      return { status: 'no_price', order: null };
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

      // Resolve allocation limits: use regime-adjusted overrides if provided
      const { maxAllocation, minAllocation } = allocationOverrides ?? this.getSessionAllocationLimits(session);

      if (isBuy) {
        // Calculate quantity based on signal
        if (signal.quantity) {
          quantity = signal.quantity;
          // Cap explicit quantity to maxAllocation of portfolio value
          const maxQuantity = (portfolio.totalValue * maxAllocation) / executionPrice;
          if (quantity > maxQuantity) {
            this.logger.warn(
              `Capping explicit BUY quantity from ${quantity} to ${maxQuantity} (${maxAllocation * 100}% cap)`
            );
            quantity = maxQuantity;
          }
        } else if (signal.percentage) {
          const investmentAmount = portfolio.totalValue * Math.min(signal.percentage, maxAllocation);
          quantity = investmentAmount / executionPrice;
        } else if (signal.confidence !== undefined) {
          const allocation = minAllocation + signal.confidence * (maxAllocation - minAllocation);
          const investmentAmount = portfolio.totalValue * allocation;
          quantity = investmentAmount / executionPrice;
        } else {
          const investmentAmount = portfolio.totalValue * minAllocation;
          quantity = investmentAmount / executionPrice;
        }

        totalValue = quantity * executionPrice;

        // Calculate fee
        const feeConfig = this.feeCalculator.fromFlatRate(session.tradingFee);
        const feeResult = this.feeCalculator.calculateFee({ tradeValue: totalValue }, feeConfig);
        const fee = feeResult.fee;

        // Check if we have enough balance
        if (quoteAccount.available < totalValue + fee) {
          this.logger.warn(
            `Insufficient ${quoteCurrency} balance for BUY order: need ${(totalValue + fee).toFixed(2)}, have ${quoteAccount.available.toFixed(2)}`
          );
          return { status: 'insufficient_funds', order: null };
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
            entryDate: timestamp,
            session
          });
        }

        // Set entry date on first buy or when position was previously closed
        const oldQuantity = baseAccount.available;
        if (!baseAccount.entryDate || oldQuantity === 0) {
          baseAccount.entryDate = timestamp;
        }

        // Update average cost
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
          ...(exitType && { exitType }),
          metadata: {
            reason: signal.reason,
            confidence: signal.confidence,
            basePrice
          }
        });

        return { status: 'success', order: await transactionalEntityManager.save(order) };
      }

      // SELL order
      if (!baseAccount || baseAccount.available <= 0) {
        this.logger.warn(`No ${baseCurrency} position to sell`);
        return { status: 'no_position', order: null };
      }

      // Enforce minimum hold period (risk-control signals always bypass)
      const minHoldMs = this.resolveMinHoldMs(session.algorithmConfig);
      const isRiskControl =
        signal.originalType === AlgoSignalType.STOP_LOSS || signal.originalType === AlgoSignalType.TAKE_PROFIT;

      if (!isRiskControl && minHoldMs > 0 && baseAccount.entryDate) {
        const holdTimeMs = timestamp.getTime() - baseAccount.entryDate.getTime();
        if (holdTimeMs < minHoldMs) {
          this.logger.debug(
            `Hold period not met for ${baseCurrency}: held ${Math.round(holdTimeMs / 3600000)}h, min ${Math.round(minHoldMs / 3600000)}h`
          );
          return { status: 'hold_period', order: null };
        }
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
        baseAccount.averageCost = undefined;
        baseAccount.entryDate = undefined;
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
        ...(exitType && { exitType }),
        metadata: {
          reason: signal.reason,
          confidence: signal.confidence,
          basePrice
        }
      });

      return { status: 'success', order: await transactionalEntityManager.save(order) };
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
          : signal.action === 'SELL' || signal.action === 'OPEN_SHORT' || signal.action === 'CLOSE_SHORT'
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

    // Calculate drawdown (clamp to 0 – portfolio may exceed stale peak before processor updates it)
    const peakValue = Math.max(session.peakPortfolioValue ?? session.initialCapital, portfolioValue);
    const drawdown = peakValue > 0 ? Math.min(1, Math.max(0, (peakValue - portfolioValue) / peakValue)) : 0;

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
      const drawdown = peak > 0 ? Math.max(0, (peak - snapshot.portfolioValue) / peak) : 0;
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
  private buildPortfolioFromAccounts(accounts: PaperTradingAccount[], quoteCurrency: string): Portfolio {
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
    return getQuoteCurrencyUtil(accounts.map((a) => a.currency));
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
    const seen = new Set<string>();
    const coins: Array<{ id: string; symbol: string }> = [];

    for (const symbol of Object.keys(prices)) {
      const [baseCurrency] = symbol.split('/');
      if (!seen.has(baseCurrency)) {
        seen.add(baseCurrency);
        coins.push({ id: baseCurrency, symbol: baseCurrency });
      }
    }

    return coins;
  }

  /**
   * Build price data context with historical candles for algorithm indicator calculations.
   * Fetches OHLCV history so strategies (e.g. Confluence) have enough data for MACD, Bollinger Bands, ATR, etc.
   */
  private buildPriceDataContext(
    prices: Record<string, number>,
    historicalCandles: Record<string, CandleData[]> = {}
  ): Record<string, CandleData[]> {
    const priceData: Record<string, CandleData[]> = {};
    const now = new Date();

    for (const [symbol, price] of Object.entries(prices)) {
      const [baseCurrency] = symbol.split('/');
      const candles = historicalCandles[symbol] ?? [];
      const candidate =
        candles.length > 0
          ? [...candles, { avg: price, high: price, low: price, date: now }]
          : [{ avg: price, high: price, low: price, date: now }];

      // Keep the entry with the most candles (richest indicator data)
      if (!priceData[baseCurrency] || candidate.length > priceData[baseCurrency].length) {
        priceData[baseCurrency] = candidate;
      }
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

  private getSessionAllocationLimits(session: PaperTradingSession) {
    return getAllocationLimits(PipelineStage.PAPER_TRADE, session.riskLevel ?? DEFAULT_RISK_LEVEL);
  }

  private getOrCreateThrottleState(sessionId: string): ThrottleState {
    let state = this.throttleStates.get(sessionId);
    if (!state) {
      state = this.signalThrottle.createState();
      this.throttleStates.set(sessionId, state);
    }
    return state;
  }

  /** Clean up throttle state when session ends */
  clearThrottleState(sessionId: string): void {
    this.throttleStates.delete(sessionId);
  }

  /** Check if in-memory throttle state exists for a session */
  hasThrottleState(sessionId: string): boolean {
    return this.throttleStates.has(sessionId);
  }

  /** Restore throttle state from a previously serialized form (e.g. from DB) */
  restoreThrottleState(sessionId: string, serializedState: SerializableThrottleState): void {
    if (this.throttleStates.has(sessionId)) return;
    const state = this.signalThrottle.deserialize(serializedState);
    this.throttleStates.set(sessionId, state);
  }

  /** Serialize current throttle state for DB persistence */
  getSerializedThrottleState(sessionId: string): SerializableThrottleState | undefined {
    const state = this.throttleStates.get(sessionId);
    if (!state) return undefined;
    return this.signalThrottle.serialize(state);
  }

  private resolveMinHoldMs(algorithmConfig?: Record<string, any>): number {
    const DEFAULT_MIN_HOLD_MS = 24 * 60 * 60 * 1000;
    const val = algorithmConfig?.minHoldMs;
    if (typeof val !== 'number' || !isFinite(val) || val < 0) return DEFAULT_MIN_HOLD_MS;
    return val;
  }

  // ─── Exit Tracker Lifecycle ─────────────────────────────────────────────────

  /**
   * Get or create exit tracker for a session.
   * Returns null if session has no exitConfig (feature flag — backward compatible).
   */
  private getOrCreateExitTracker(session: PaperTradingSession): BacktestExitTracker | null {
    if (!session.exitConfig) return null;

    let tracker = this.exitTrackers.get(session.id);
    if (!tracker) {
      const config = resolveExitConfig(session.exitConfig);
      if (session.exitTrackerState) {
        tracker = BacktestExitTracker.deserialize(session.exitTrackerState, config);
      } else {
        tracker = new BacktestExitTracker(config);
      }
      this.exitTrackers.set(session.id, tracker);
    }
    return tracker;
  }

  /** Serialize exit tracker state for DB persistence */
  getSerializedExitTrackerState(sessionId: string): SerializableExitTrackerState | undefined {
    const tracker = this.exitTrackers.get(sessionId);
    if (!tracker) return undefined;
    return tracker.serialize();
  }

  /** Clean up exit tracker when session ends */
  clearExitTracker(sessionId: string): void {
    this.exitTrackers.delete(sessionId);
  }

  /**
   * Sweep in-memory state for sessions that are no longer active.
   * Prevents memory leaks if a session fails to reach a terminal state.
   * @param activeSessionIds Set of session IDs that are still RUNNING or PAUSED
   */
  sweepOrphanedState(activeSessionIds: Set<string>): number {
    let swept = 0;
    for (const sessionId of this.exitTrackers.keys()) {
      if (!activeSessionIds.has(sessionId)) {
        this.exitTrackers.delete(sessionId);
        swept++;
      }
    }
    for (const sessionId of this.throttleStates.keys()) {
      if (!activeSessionIds.has(sessionId)) {
        this.throttleStates.delete(sessionId);
        swept++;
      }
    }
    return swept;
  }

  /**
   * Check exit levels and execute exit orders for triggered positions.
   * Runs before algorithm so exits mirror live trading behavior.
   */
  private async checkAndExecuteExits(
    session: PaperTradingSession,
    exitTracker: BacktestExitTracker,
    priceMap: Record<string, number>,
    historicalCandles: Record<string, CandleData[]>,
    quoteCurrency: string,
    exchangeSlug: string,
    timestamp: Date
  ): Promise<number> {
    // Build close/low/high price maps from current prices + last candle data
    const closePrices = new Map<string, number>();
    const lowPrices = new Map<string, number>();
    const highPrices = new Map<string, number>();

    for (const [symbol, price] of Object.entries(priceMap)) {
      const [baseCurrency] = symbol.split('/');
      closePrices.set(baseCurrency, price);

      const candles = historicalCandles[symbol];
      if (candles && candles.length > 0) {
        const lastCandle = candles[candles.length - 1];
        // Use the wider range: last candle's high/low vs current price
        lowPrices.set(baseCurrency, Math.min(lastCandle.low, price));
        highPrices.set(baseCurrency, Math.max(lastCandle.high, price));
      } else {
        lowPrices.set(baseCurrency, price);
        highPrices.set(baseCurrency, price);
      }
    }

    const exitSignals = exitTracker.checkExits(closePrices, lowPrices, highPrices);
    if (exitSignals.length === 0) return 0;

    // Fetch accounts once before the loop
    let accounts = await this.accountRepository.find({ where: { session: { id: session.id } } });
    let currentPortfolio = this.updatePortfolioWithPrices(
      this.buildPortfolioFromAccounts(accounts, quoteCurrency),
      priceMap,
      quoteCurrency
    );

    const { maxAllocation, minAllocation } = this.getSessionAllocationLimits(session);

    let ordersExecuted = 0;
    for (const exit of exitSignals) {
      // Declare signalEntity outside try so catch block can access it
      let signalEntity: PaperTradingSignal | undefined;
      try {
        // Convert exit signal to trading signal
        const exitTradingSignal: TradingSignal = {
          action: 'SELL',
          coinId: exit.coinId,
          symbol: `${exit.coinId}/${quoteCurrency}`,
          quantity: exit.quantity,
          reason: exit.reason,
          metadata: exit.metadata as Record<string, any>,
          originalType:
            exit.exitType === 'STOP_LOSS'
              ? AlgoSignalType.STOP_LOSS
              : exit.exitType === 'TAKE_PROFIT'
                ? AlgoSignalType.TAKE_PROFIT
                : AlgoSignalType.STOP_LOSS // trailing stop treated as SL for signal classification
        };

        // Save signal as RISK_CONTROL type
        signalEntity = await this.saveSignal(session, exitTradingSignal);

        // Execute at the exit's execution price by temporarily overriding the price map
        const exitPriceMap = { ...priceMap, [`${exit.coinId}/${quoteCurrency}`]: exit.executionPrice };

        // Pass exitType into transaction so it's set atomically
        const result = await this.executeOrder(
          session,
          exitTradingSignal,
          signalEntity,
          currentPortfolio,
          exitPriceMap,
          exchangeSlug,
          quoteCurrency,
          timestamp,
          { maxAllocation, minAllocation },
          exit.exitType as PaperTradingExitType
        );

        if (result.status === 'success') {
          ordersExecuted++;
          // Refresh portfolio after successful exit for next iteration
          accounts = await this.accountRepository.find({ where: { session: { id: session.id } } });
          currentPortfolio = this.updatePortfolioWithPrices(
            this.buildPortfolioFromAccounts(accounts, quoteCurrency),
            priceMap,
            quoteCurrency
          );
          exitTracker.removePosition(exit.coinId);
          signalEntity.status = PaperTradingSignalStatus.SIMULATED;
          signalEntity.processed = true;
          signalEntity.processedAt = new Date();
          await this.signalRepository.save(signalEntity);
          this.logger.log(
            `Exit triggered for ${exit.coinId} in session ${session.id}: ${exit.exitType} at ${exit.executionPrice.toFixed(2)}`
          );
        } else if (result.status === 'no_position') {
          // Position already gone — clean up tracker and mark signal processed
          exitTracker.removePosition(exit.coinId);
          signalEntity.status = PaperTradingSignalStatus.SIMULATED;
          signalEntity.processed = true;
          signalEntity.processedAt = new Date();
          await this.signalRepository.save(signalEntity);
          this.logger.log(
            `Exit cleanup for ${exit.coinId} in session ${session.id}: position already closed (${result.status})`
          );
        } else {
          // Transient failure (no_price, insufficient_funds, hold_period) — keep position tracked for retry
          signalEntity.status = PaperTradingSignalStatus.REJECTED;
          if (result.status === 'no_price') {
            signalEntity.rejectionCode = SignalReasonCode.SYMBOL_RESOLUTION_FAILED;
          } else if (result.status === 'insufficient_funds') {
            signalEntity.rejectionCode = SignalReasonCode.INSUFFICIENT_FUNDS;
          } else if (result.status === 'hold_period') {
            signalEntity.rejectionCode = SignalReasonCode.TRADE_COOLDOWN;
          }
          signalEntity.processed = true;
          signalEntity.processedAt = new Date();
          await this.signalRepository.save(signalEntity);
          this.logger.warn(
            `Exit deferred for ${exit.coinId} in session ${session.id}: ${result.status} — will retry next tick`
          );
        }
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        if (signalEntity) {
          signalEntity.status = PaperTradingSignalStatus.ERROR;
          signalEntity.processed = true;
          signalEntity.processedAt = new Date();
          await this.signalRepository.save(signalEntity);
        }
        this.logger.warn(`Failed to execute exit order for ${exit.coinId}: ${err.message}`);
      }
    }

    return ordersExecuted;
  }

  /**
   * Attempt to sell weakest positions to free cash for a higher-confidence BUY signal.
   * Mirrors the BacktestEngine pattern using PositionAnalysisService for scoring.
   *
   * @returns number of sell orders executed
   */
  private async attemptOpportunitySelling(
    session: PaperTradingSession,
    buySignal: TradingSignal,
    priceMap: Record<string, number>,
    quoteCurrency: string,
    exchangeSlug: string,
    timestamp: Date,
    allocationOverrides?: { maxAllocation: number; minAllocation: number }
  ): Promise<number> {
    const { enabled, config } = this.resolveOpportunitySellingConfig(session.algorithmConfig);
    if (!enabled) return 0;

    const buyConfidence = buySignal.confidence ?? 0;
    if (buyConfidence < config.minOpportunityConfidence) return 0;

    // Get fresh accounts from DB
    const accounts = await this.accountRepository.find({
      where: { session: { id: session.id } }
    });
    const portfolio = this.buildPortfolioFromAccounts(accounts, quoteCurrency);
    const updatedPortfolio = this.updatePortfolioWithPrices(portfolio, priceMap, quoteCurrency);

    // Estimate the required buy amount
    const buyPrice = priceMap[buySignal.symbol];
    if (!buyPrice) return 0;

    const { maxAllocation, minAllocation } = allocationOverrides ?? this.getSessionAllocationLimits(session);
    let requiredAmount: number;
    if (buySignal.quantity) {
      requiredAmount = buySignal.quantity * buyPrice;
    } else if (buySignal.percentage) {
      requiredAmount = updatedPortfolio.totalValue * Math.min(buySignal.percentage, maxAllocation);
    } else if (buySignal.confidence !== undefined) {
      const alloc = minAllocation + buySignal.confidence * (maxAllocation - minAllocation);
      requiredAmount = updatedPortfolio.totalValue * alloc;
    } else {
      requiredAmount = updatedPortfolio.totalValue * minAllocation;
    }

    // Fee estimate
    const feeConfig = this.feeCalculator.fromFlatRate(session.tradingFee);
    const estFee = this.feeCalculator.calculateFee({ tradeValue: requiredAmount }, feeConfig).fee;
    const totalRequired = requiredAmount + estFee;

    if (updatedPortfolio.cashBalance >= totalRequired) return 0; // No shortfall

    const shortfall = totalRequired - updatedPortfolio.cashBalance;

    // Score and rank eligible positions
    const eligible: { coinId: string; score: number; quantity: number; price: number }[] = [];

    for (const [coinId, position] of updatedPortfolio.positions) {
      if (coinId === buySignal.coinId) continue;
      if (config.protectedCoins.includes(coinId)) continue;

      const symbol = `${coinId}/${quoteCurrency}`;
      const currentPrice = priceMap[symbol];
      if (!currentPrice || currentPrice <= 0) continue;

      const account = accounts.find((a) => a.currency === coinId);
      const score = this.positionAnalysis.calculatePositionSellScore(
        {
          coinId,
          averagePrice: account?.averageCost ?? position.averagePrice,
          quantity: position.quantity,
          entryDate: account?.entryDate
        },
        currentPrice,
        buyConfidence,
        config,
        timestamp
      );

      if (score.eligible) {
        eligible.push({ coinId, score: score.totalScore, quantity: position.quantity, price: currentPrice });
      }
    }

    if (eligible.length === 0) return 0;

    // Sort by score ASC (lowest = sell first)
    eligible.sort((a, b) => a.score - b.score);

    // Execute sells to cover the shortfall, respecting maxLiquidationPercent cap
    const maxSellValue = (updatedPortfolio.totalValue * config.maxLiquidationPercent) / 100;
    let coveredAmount = 0;
    let sellCount = 0;

    for (const candidate of eligible) {
      if (coveredAmount >= shortfall) break;
      if (coveredAmount >= maxSellValue) break;

      const remainingNeeded = Math.min(shortfall - coveredAmount, maxSellValue - coveredAmount);
      const sellQuantity = Math.min(candidate.quantity, remainingNeeded / candidate.price);
      if (sellQuantity <= 0) continue;

      const sellSignal: TradingSignal = {
        action: 'SELL',
        coinId: candidate.coinId,
        symbol: `${candidate.coinId}/${quoteCurrency}`,
        quantity: sellQuantity,
        reason: `Opportunity sell: freeing cash for ${buySignal.coinId} BUY (confidence ${buyConfidence.toFixed(2)})`,
        confidence: buyConfidence,
        metadata: { opportunitySell: true, targetBuyCoinId: buySignal.coinId }
      };

      const signalEntity = await this.saveSignal(session, sellSignal);

      try {
        // Build fresh portfolio for each sell (accounts may have changed)
        const freshAccounts = await this.accountRepository.find({
          where: { session: { id: session.id } }
        });
        const freshPortfolio = this.buildPortfolioFromAccounts(freshAccounts, quoteCurrency);
        const updatedFreshPortfolio = this.updatePortfolioWithPrices(freshPortfolio, priceMap, quoteCurrency);

        const result = await this.executeOrder(
          session,
          sellSignal,
          signalEntity,
          updatedFreshPortfolio,
          priceMap,
          exchangeSlug,
          quoteCurrency,
          timestamp
        );

        if (result.order) {
          coveredAmount += (result.order.totalValue ?? 0) - (result.order.fee ?? 0);
          sellCount++;
          signalEntity.status = PaperTradingSignalStatus.SIMULATED;
        } else {
          signalEntity.status = PaperTradingSignalStatus.REJECTED;
          signalEntity.rejectionCode = SignalReasonCode.INSUFFICIENT_FUNDS;
        }
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        signalEntity.status = PaperTradingSignalStatus.ERROR;
        this.logger.warn(`Opportunity sell failed for ${candidate.coinId}: ${err.message}`);
      }

      signalEntity.processed = true;
      signalEntity.processedAt = new Date();
      await this.signalRepository.save(signalEntity);
    }

    if (sellCount > 0) {
      this.logger.log(
        `Opportunity selling: executed ${sellCount} sells to free cash for ${buySignal.coinId} BUY (session ${session.id})`
      );
    }

    return sellCount;
  }

  private resolveOpportunitySellingConfig(algorithmConfig?: Record<string, any>): {
    enabled: boolean;
    config: OpportunitySellingUserConfig;
  } {
    const params = algorithmConfig ?? {};
    const enabled = params.enableOpportunitySelling === true;
    const userConfig = params.opportunitySellingConfig;

    if (!enabled || !userConfig || typeof userConfig !== 'object') {
      return { enabled, config: { ...DEFAULT_OPPORTUNITY_SELLING_CONFIG } };
    }

    const num = (val: unknown, fallback: number, min: number, max: number): number => {
      const n = typeof val === 'number' && isFinite(val) ? val : fallback;
      return Math.max(min, Math.min(max, n));
    };

    return {
      enabled,
      config: {
        minOpportunityConfidence: num(
          userConfig.minOpportunityConfidence,
          DEFAULT_OPPORTUNITY_SELLING_CONFIG.minOpportunityConfidence,
          0,
          1
        ),
        minHoldingPeriodHours: num(
          userConfig.minHoldingPeriodHours,
          DEFAULT_OPPORTUNITY_SELLING_CONFIG.minHoldingPeriodHours,
          0,
          8760
        ),
        protectGainsAbovePercent: num(
          userConfig.protectGainsAbovePercent,
          DEFAULT_OPPORTUNITY_SELLING_CONFIG.protectGainsAbovePercent,
          0,
          1000
        ),
        protectedCoins: Array.isArray(userConfig.protectedCoins) ? userConfig.protectedCoins : [],
        minOpportunityAdvantagePercent: num(
          userConfig.minOpportunityAdvantagePercent,
          DEFAULT_OPPORTUNITY_SELLING_CONFIG.minOpportunityAdvantagePercent,
          0,
          100
        ),
        maxLiquidationPercent: num(
          userConfig.maxLiquidationPercent,
          DEFAULT_OPPORTUNITY_SELLING_CONFIG.maxLiquidationPercent,
          1,
          100
        ),
        useAlgorithmRanking:
          typeof userConfig.useAlgorithmRanking === 'boolean'
            ? userConfig.useAlgorithmRanking
            : DEFAULT_OPPORTUNITY_SELLING_CONFIG.useAlgorithmRanking
      }
    };
  }
}
