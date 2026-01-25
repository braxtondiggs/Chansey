import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import * as dayjs from 'dayjs';

import { createHash } from 'crypto';

import {
  BacktestCheckpointState,
  CheckpointPortfolio,
  DEFAULT_CHECKPOINT_CONFIG
} from './backtest-checkpoint.interface';
import { BacktestFinalMetrics } from './backtest-result.service';
import { BacktestStreamService } from './backtest-stream.service';
import {
  Backtest,
  BacktestPerformanceSnapshot,
  BacktestSignal,
  BacktestTrade,
  SignalDirection,
  SignalType,
  SimulatedOrderFill,
  SimulatedOrderStatus,
  SimulatedOrderType,
  TradeType
} from './backtest.entity';
import { MarketDataReaderService, OHLCVData } from './market-data-reader.service';
import { MarketDataSet } from './market-data-set.entity';
import { QuoteCurrencyResolverService } from './quote-currency-resolver.service';
import { SeededRandom } from './seeded-random';
import {
  applySlippage,
  calculateSimulatedSlippage,
  DEFAULT_SLIPPAGE_CONFIG,
  SlippageModelConfig,
  SlippageModelType
} from './slippage-model';

import {
  AlgorithmResult,
  SignalType as AlgoSignalType,
  TradingSignal as StrategySignal
} from '../../algorithm/interfaces';
import { AlgorithmRegistry } from '../../algorithm/registry/algorithm-registry.service';
import { Coin } from '../../coin/coin.entity';
import { CoinService } from '../../coin/coin.service';
import { AlgorithmNotRegisteredException } from '../../common/exceptions';
import { SharpeRatioCalculator } from '../../common/metrics/sharpe-ratio.calculator';
import { OHLCCandle } from '../../ohlc/ohlc-candle.entity';
import { OHLCService } from '../../ohlc/ohlc.service';

export interface MarketData {
  timestamp: Date;
  prices: Map<string, number>; // coinId -> price
}

export interface Position {
  coinId: string;
  quantity: number;
  averagePrice: number;
  totalValue: number;
}

export interface Portfolio {
  cashBalance: number;
  positions: Map<string, Position>;
  totalValue: number;
}

export interface TradingSignal {
  action: 'BUY' | 'SELL' | 'HOLD';
  coinId: string;
  quantity?: number;
  percentage?: number;
  reason: string;
  confidence?: number;
  metadata?: Record<string, any>;
}

interface ExecuteOptions {
  dataset: MarketDataSet;
  deterministicSeed: string;
  telemetryEnabled?: boolean;

  // Checkpoint options for resume capability
  /** Number of timestamps between checkpoints (default: 500) */
  checkpointInterval?: number;
  /** Callback invoked at each checkpoint with current state and total timestamp count */
  onCheckpoint?: (state: BacktestCheckpointState, results: CheckpointResults, totalTimestamps: number) => Promise<void>;
  /** Checkpoint state to resume from (if resuming a previous run) */
  resumeFrom?: BacktestCheckpointState;
}

interface CheckpointResults {
  trades: Partial<BacktestTrade>[];
  signals: Partial<BacktestSignal>[];
  simulatedFills: Partial<SimulatedOrderFill>[];
  snapshots: Partial<BacktestPerformanceSnapshot>[];
}

// Note: Seeded random generation now uses SeededRandom class for checkpoint support

const mapStrategySignal = (signal: StrategySignal): TradingSignal => {
  const action: TradingSignal['action'] =
    signal.type === AlgoSignalType.SELL ? 'SELL' : signal.type === AlgoSignalType.BUY ? 'BUY' : 'HOLD';

  return {
    action,
    coinId: signal.coinId,
    quantity: signal.quantity,
    percentage: signal.strength,
    reason: signal.reason,
    confidence: signal.confidence,
    metadata: signal.metadata
  };
};

/**
 * Configuration for running an optimization backtest
 */
export interface OptimizationBacktestConfig {
  algorithmId: string;
  parameters: Record<string, unknown>;
  startDate: Date;
  endDate: Date;
  initialCapital?: number;
  tradingFee?: number;
  coinIds?: string[];
}

/**
 * Result metrics from an optimization backtest
 */
export interface OptimizationBacktestResult {
  sharpeRatio: number;
  totalReturn: number;
  maxDrawdown: number;
  winRate: number;
  volatility: number;
  profitFactor: number;
  tradeCount: number;
  annualizedReturn?: number;
  finalValue?: number;
  /** Downside deviation for Sortino ratio calculation (standard deviation of negative returns only) */
  downsideDeviation?: number;
}

@Injectable()
export class BacktestEngine {
  private readonly logger = new Logger(BacktestEngine.name);

  constructor(
    private readonly backtestStream: BacktestStreamService,
    private readonly algorithmRegistry: AlgorithmRegistry,
    private readonly coinService: CoinService,
    @Inject(forwardRef(() => OHLCService))
    private readonly ohlcService: OHLCService,
    private readonly marketDataReader: MarketDataReaderService,
    private readonly sharpeCalculator: SharpeRatioCalculator,
    private readonly quoteCurrencyResolver: QuoteCurrencyResolverService
  ) {}

  async executeHistoricalBacktest(
    backtest: Backtest,
    coins: Coin[],
    options: ExecuteOptions
  ): Promise<{
    trades: Partial<BacktestTrade>[];
    signals: Partial<BacktestSignal>[];
    simulatedFills: Partial<SimulatedOrderFill>[];
    snapshots: Partial<BacktestPerformanceSnapshot>[];
    finalMetrics: BacktestFinalMetrics;
  }> {
    if (!backtest.algorithm) {
      throw new Error('Backtest algorithm relation not loaded');
    }

    const isResuming = !!options.resumeFrom;
    const checkpointInterval = options.checkpointInterval ?? DEFAULT_CHECKPOINT_CONFIG.checkpointInterval;

    this.logger.log(
      `Starting historical backtest: ${backtest.name} (dataset=${options.dataset.id}, seed=${options.deterministicSeed}, resuming=${isResuming})`
    );

    // Initialize or restore RNG based on resume state
    let rng: SeededRandom;
    if (isResuming && options.resumeFrom) {
      rng = SeededRandom.fromState(options.resumeFrom.rngState);
      this.logger.log(`Restored RNG state from checkpoint at index ${options.resumeFrom.lastProcessedIndex}`);
    } else {
      rng = new SeededRandom(options.deterministicSeed);
    }

    // Initialize or restore portfolio based on resume state
    let portfolio: Portfolio;
    let peakValue: number;
    let maxDrawdown: number;

    if (isResuming && options.resumeFrom) {
      portfolio = this.restorePortfolio(options.resumeFrom.portfolio, backtest.initialCapital);
      peakValue = options.resumeFrom.peakValue;
      maxDrawdown = options.resumeFrom.maxDrawdown;
      this.logger.log(
        `Restored portfolio: cash=${portfolio.cashBalance.toFixed(2)}, positions=${portfolio.positions.size}, peak=${peakValue.toFixed(2)}`
      );
    } else {
      portfolio = {
        cashBalance: backtest.initialCapital,
        positions: new Map(),
        totalValue: backtest.initialCapital
      };
      peakValue = backtest.initialCapital;
      maxDrawdown = 0;
    }

    const trades: Partial<BacktestTrade>[] = [];
    const signals: Partial<BacktestSignal>[] = [];
    const simulatedFills: Partial<SimulatedOrderFill>[] = [];
    const snapshots: Partial<BacktestPerformanceSnapshot>[] = [];

    const coinIds = coins.map((coin) => coin.id);
    const coinMap = new Map<string, Coin>(coins.map((coin) => [coin.id, coin]));

    // Resolve quote currency from configSnapshot (default: USDT) with fallback chain
    const preferredQuoteCurrency = (backtest.configSnapshot?.run?.quoteCurrency as string) ?? 'USDT';
    const quoteCoin = await this.quoteCurrencyResolver.resolveQuoteCurrency(preferredQuoteCurrency);

    // Determine data source: storage file (CSV) or database (Price table)
    const startDate = options.dataset.startAt ?? backtest.startDate;
    const endDate = options.dataset.endAt ?? backtest.endDate;

    let historicalPrices: OHLCCandle[];

    if (this.marketDataReader.hasStorageLocation(options.dataset)) {
      // Use CSV data from MinIO storage
      this.logger.log(`Reading market data from storage: ${options.dataset.storageLocation}`);
      const marketDataResult = await this.marketDataReader.readMarketData(options.dataset, startDate, endDate);
      historicalPrices = this.convertOHLCVToCandles(marketDataResult.data);
      this.logger.log(
        `Loaded ${historicalPrices.length} candle records from storage (${marketDataResult.dateRange.start.toISOString()} to ${marketDataResult.dateRange.end.toISOString()})`
      );
    } else {
      // Fall back to database OHLC table
      historicalPrices = await this.getHistoricalPrices(coinIds, startDate, endDate);
    }

    if (historicalPrices.length === 0) {
      throw new Error('No historical price data available for the specified date range');
    }

    const pricesByTimestamp = this.groupPricesByTimestamp(historicalPrices);
    const timestamps = Object.keys(pricesByTimestamp).sort();

    const priceHistoryByCoin = new Map<string, OHLCCandle[]>();
    const priceSummariesByCoin = new Map<
      string,
      { avg: number; coin: string; date: Date; high: number; low: number }[]
    >();
    const indexByCoin = new Map<string, number>();

    for (const coinId of coinIds) {
      const history = historicalPrices
        .filter((price) => price.coinId === coinId)
        .sort((a, b) => this.getPriceTimestamp(a).getTime() - this.getPriceTimestamp(b).getTime());
      priceHistoryByCoin.set(coinId, history);
      priceSummariesByCoin.set(
        coinId,
        history.map((price) => this.buildPriceSummary(price))
      );
      indexByCoin.set(coinId, -1);
    }

    this.logger.log(`Processing ${timestamps.length} time periods`);

    // Build slippage config from backtest configSnapshot
    const slippageSnapshot = backtest.configSnapshot?.slippage;
    const slippageConfig: SlippageModelConfig = slippageSnapshot
      ? {
          type: (slippageSnapshot.model as SlippageModelType) ?? SlippageModelType.FIXED,
          fixedBps: slippageSnapshot.fixedBps ?? 5,
          baseSlippageBps: slippageSnapshot.baseBps ?? 5,
          volumeImpactFactor: slippageSnapshot.volumeImpactFactor ?? 100
        }
      : DEFAULT_SLIPPAGE_CONFIG;

    // Determine starting index: either from checkpoint or from beginning
    const startIndex = isResuming && options.resumeFrom ? options.resumeFrom.lastProcessedIndex + 1 : 0;

    if (isResuming) {
      this.logger.log(
        `Resuming from index ${startIndex} of ${timestamps.length} (${((startIndex / timestamps.length) * 100).toFixed(1)}% complete)`
      );
    }

    // Track result counts at last checkpoint for proper slicing during incremental persistence
    // When resuming, initialize from the checkpoint's persisted counts; otherwise start at zero
    let lastCheckpointCounts =
      isResuming && options.resumeFrom
        ? { ...options.resumeFrom.persistedCounts }
        : { trades: 0, signals: 0, fills: 0, snapshots: 0 };

    // Track timestamp index for checkpoint interval calculation
    let lastCheckpointIndex = startIndex - 1;

    for (let i = startIndex; i < timestamps.length; i++) {
      const timestamp = new Date(timestamps[i]);
      const currentPrices = pricesByTimestamp[timestamps[i]];

      const marketData: MarketData = {
        timestamp,
        prices: new Map(currentPrices.map((price) => [price.coinId, this.getPriceValue(price)]))
      };

      portfolio = this.updatePortfolioValues(portfolio, marketData.prices);

      const priceData: Record<string, { avg: number; coin: string; date: Date; high: number; low: number }[]> = {};
      for (const coin of coins) {
        const history = priceHistoryByCoin.get(coin.id) ?? [];
        let pointer = indexByCoin.get(coin.id) ?? -1;
        while (pointer + 1 < history.length && this.getPriceTimestamp(history[pointer + 1]) <= timestamp) {
          pointer += 1;
        }
        indexByCoin.set(coin.id, pointer);
        if (pointer >= 0) {
          const summaries = priceSummariesByCoin.get(coin.id) ?? [];
          priceData[coin.id] = summaries.slice(0, pointer + 1);
        }
      }

      const context = {
        coins,
        priceData,
        timestamp,
        config: backtest.configSnapshot?.parameters ?? {},
        positions: Object.fromEntries(
          [...portfolio.positions.entries()].map(([id, position]) => [id, position.quantity])
        ),
        availableBalance: portfolio.cashBalance,
        metadata: {
          datasetId: options.dataset.id,
          deterministicSeed: options.deterministicSeed,
          backtestId: backtest.id
        }
      };

      let strategySignals: TradingSignal[] = [];
      try {
        const result: AlgorithmResult = await this.algorithmRegistry.executeAlgorithm(backtest.algorithm.id, context);
        if (result.success && result.signals?.length) {
          strategySignals = result.signals.map(mapStrategySignal).filter((signal) => signal.action !== 'HOLD');
        }
      } catch (error) {
        if (error instanceof AlgorithmNotRegisteredException) {
          throw error;
        }
        this.logger.warn(`Algorithm execution failed at ${timestamp.toISOString()}: ${error.message}`);
      }

      for (const strategySignal of strategySignals) {
        const signalRecord: Partial<BacktestSignal> = {
          timestamp,
          signalType:
            strategySignal.action === 'BUY'
              ? SignalType.ENTRY
              : strategySignal.action === 'SELL'
                ? SignalType.EXIT
                : SignalType.ADJUSTMENT,
          instrument: strategySignal.coinId,
          direction:
            strategySignal.action === 'HOLD'
              ? SignalDirection.FLAT
              : strategySignal.action === 'BUY'
                ? SignalDirection.LONG
                : SignalDirection.SHORT,
          quantity: strategySignal.quantity ?? strategySignal.percentage ?? 0,
          price: marketData.prices.get(strategySignal.coinId),
          reason: strategySignal.reason,
          confidence: strategySignal.confidence,
          payload: strategySignal.metadata,
          backtest
        };
        signals.push(signalRecord);

        const tradeResult = await this.executeTrade(
          strategySignal,
          portfolio,
          marketData,
          backtest.tradingFee,
          rng,
          slippageConfig
        );
        if (tradeResult) {
          const { trade, slippageBps } = tradeResult;

          const baseCoin = coinMap.get(strategySignal.coinId);
          if (!baseCoin) {
            throw new Error(
              `baseCoin not found for coinId ${strategySignal.coinId}. Ensure all coins referenced by the algorithm are included in the backtest.`
            );
          }

          trades.push({ ...trade, executedAt: timestamp, backtest, baseCoin, quoteCoin });
          simulatedFills.push({
            orderType: SimulatedOrderType.MARKET,
            status: SimulatedOrderStatus.FILLED,
            filledQuantity: trade.quantity,
            averagePrice: trade.price,
            fees: trade.fee,
            slippageBps,
            executionTimestamp: timestamp,
            instrument: strategySignal.coinId,
            metadata: trade.metadata,
            backtest
          });
        }
      }

      if (portfolio.totalValue > peakValue) {
        peakValue = portfolio.totalValue;
      }
      const currentDrawdown = peakValue === 0 ? 0 : (peakValue - portfolio.totalValue) / peakValue;
      if (currentDrawdown > maxDrawdown) {
        maxDrawdown = currentDrawdown;
      }

      if (i % 24 === 0 || i === timestamps.length - 1) {
        snapshots.push({
          timestamp,
          portfolioValue: portfolio.totalValue,
          cashBalance: portfolio.cashBalance,
          holdings: this.portfolioToHoldings(portfolio, marketData.prices),
          cumulativeReturn: (portfolio.totalValue - backtest.initialCapital) / backtest.initialCapital,
          drawdown: currentDrawdown,
          backtest
        });

        if (options.telemetryEnabled) {
          await this.backtestStream.publishMetric(backtest.id, 'portfolio_value', portfolio.totalValue, 'USD', {
            timestamp: timestamp.toISOString()
          });
        }
      }

      // Checkpoint callback: save state periodically for resume capability
      const timeSinceLastCheckpoint = i - lastCheckpointIndex;
      if (options.onCheckpoint && timeSinceLastCheckpoint >= checkpointInterval) {
        const checkpointState = this.buildCheckpointState(
          i,
          timestamp.toISOString(),
          portfolio,
          peakValue,
          maxDrawdown,
          rng.getState(),
          trades.length,
          signals.length,
          simulatedFills.length,
          snapshots.length
        );

        // Results accumulated since last checkpoint - use counts from last checkpoint for proper slicing
        const checkpointResults: CheckpointResults = {
          trades: trades.slice(lastCheckpointCounts.trades),
          signals: signals.slice(lastCheckpointCounts.signals),
          simulatedFills: simulatedFills.slice(lastCheckpointCounts.fills),
          snapshots: snapshots.slice(lastCheckpointCounts.snapshots)
        };

        // Pass total timestamps count to callback for accurate progress reporting
        await options.onCheckpoint(checkpointState, checkpointResults, timestamps.length);

        // Update counts for next checkpoint slice
        lastCheckpointCounts = {
          trades: trades.length,
          signals: signals.length,
          fills: simulatedFills.length,
          snapshots: snapshots.length
        };
        lastCheckpointIndex = i;

        this.logger.debug(
          `Checkpoint saved at index ${i}/${timestamps.length} (${((i / timestamps.length) * 100).toFixed(1)}%)`
        );
      }
    }

    const finalMetrics = this.calculateFinalMetrics(backtest, portfolio, trades, snapshots, maxDrawdown);

    if (options.telemetryEnabled) {
      await this.backtestStream.publishMetric(
        backtest.id,
        'final_value',
        finalMetrics.finalValue ?? portfolio.totalValue,
        'USD'
      );
      await this.backtestStream.publishMetric(backtest.id, 'total_return', finalMetrics.totalReturn ?? 0, 'pct');
      await this.backtestStream.publishStatus(backtest.id, 'completed');
    }

    this.logger.log(`Backtest completed: ${trades.length} trades, final value: $${portfolio.totalValue.toFixed(2)}`);

    return { trades, signals, simulatedFills, snapshots, finalMetrics };
  }

  /**
   * Get historical OHLC candle data for backtesting
   */
  private async getHistoricalPrices(coinIds: string[], startDate: Date, endDate: Date): Promise<OHLCCandle[]> {
    return this.ohlcService.getCandlesByDateRange(coinIds, startDate, endDate);
  }

  /**
   * Convert OHLCV data from storage to OHLCCandle format for compatibility
   * with backtest logic
   */
  private convertOHLCVToCandles(ohlcvData: OHLCVData[]): OHLCCandle[] {
    return ohlcvData.map(
      (data) =>
        new OHLCCandle({
          coinId: data.coinId,
          timestamp: data.timestamp,
          open: data.open,
          high: data.high,
          low: data.low,
          close: data.close,
          volume: data.volume
        })
    );
  }

  /**
   * Get timestamp from OHLC candle
   */
  private getPriceTimestamp(candle: OHLCCandle): Date {
    return candle.timestamp;
  }

  /**
   * Get price value from OHLC candle (uses close price)
   */
  private getPriceValue(candle: OHLCCandle): number {
    return candle.close;
  }

  /**
   * Build price summary from OHLC candle
   */
  private buildPriceSummary(candle: OHLCCandle): { avg: number; coin: string; date: Date; high: number; low: number } {
    return {
      avg: candle.close,
      coin: candle.coinId,
      date: candle.timestamp,
      high: candle.high,
      low: candle.low
    };
  }

  private groupPricesByTimestamp(candles: OHLCCandle[]): Record<string, OHLCCandle[]> {
    return candles.reduce(
      (grouped, candle) => {
        const timestamp = candle.timestamp.toISOString();
        if (!grouped[timestamp]) {
          grouped[timestamp] = [];
        }
        grouped[timestamp].push(candle);
        return grouped;
      },
      {} as Record<string, OHLCCandle[]>
    );
  }

  private updatePortfolioValues(portfolio: Portfolio, currentPrices: Map<string, number>): Portfolio {
    let totalValue = portfolio.cashBalance;

    for (const [coinId, position] of portfolio.positions) {
      const currentPrice = currentPrices.get(coinId);
      if (currentPrice) {
        position.totalValue = position.quantity * currentPrice;
        totalValue += position.totalValue;
      }
    }

    return {
      ...portfolio,
      totalValue
    };
  }

  private async executeTrade(
    signal: TradingSignal,
    portfolio: Portfolio,
    marketData: MarketData,
    tradingFee: number,
    rng: SeededRandom,
    slippageConfig: SlippageModelConfig = DEFAULT_SLIPPAGE_CONFIG
  ): Promise<{ trade: Partial<BacktestTrade>; slippageBps: number } | null> {
    const basePrice = marketData.prices.get(signal.coinId);
    if (!basePrice) {
      this.logger.warn(`No price data available for coin ${signal.coinId}`);
      return null;
    }

    if (signal.action === 'HOLD') {
      return null;
    }

    const isBuy = signal.action === 'BUY';
    let quantity = 0;
    let totalValue = 0;

    // Calculate slippage based on estimated order size
    const estimatedQuantity = signal.quantity ?? (portfolio.totalValue * 0.1) / basePrice;
    const slippageBps = calculateSimulatedSlippage(slippageConfig, estimatedQuantity, basePrice);

    // Apply slippage to get execution price
    const price = applySlippage(basePrice, slippageBps, isBuy);

    if (isBuy) {
      if (signal.quantity) {
        quantity = signal.quantity;
      } else if (signal.percentage) {
        const investmentAmount = portfolio.totalValue * signal.percentage;
        quantity = investmentAmount / price;
      } else {
        const investmentAmount = portfolio.totalValue * Math.min(0.2, Math.max(0.05, rng.next()));
        quantity = investmentAmount / price;
      }

      totalValue = quantity * price;

      if (portfolio.cashBalance < totalValue) {
        this.logger.warn('Insufficient cash balance for BUY trade');
        return null;
      }

      portfolio.cashBalance -= totalValue;

      const existingPosition = portfolio.positions.get(signal.coinId) ?? {
        coinId: signal.coinId,
        quantity: 0,
        averagePrice: 0,
        totalValue: 0
      };

      const newQuantity = existingPosition.quantity + quantity;
      existingPosition.averagePrice = existingPosition.quantity
        ? (existingPosition.averagePrice * existingPosition.quantity + price * quantity) / newQuantity
        : price;
      existingPosition.quantity = newQuantity;
      existingPosition.totalValue = existingPosition.quantity * price;

      portfolio.positions.set(signal.coinId, existingPosition);
    }

    // Variables to track P&L for SELL trades
    let realizedPnL: number | undefined;
    let realizedPnLPercent: number | undefined;
    let costBasis: number | undefined;

    if (signal.action === 'SELL') {
      const existingPosition = portfolio.positions.get(signal.coinId);
      if (!existingPosition || existingPosition.quantity === 0) {
        return null;
      }

      // Capture cost basis BEFORE modifying position
      costBasis = existingPosition.averagePrice;

      quantity = signal.quantity ?? existingPosition.quantity * Math.min(1, Math.max(0.25, rng.next()));
      quantity = Math.min(quantity, existingPosition.quantity);
      totalValue = quantity * price;

      // Calculate realized P&L: (sell price - cost basis) * quantity
      // Fee will be subtracted separately below
      const grossPnL = (price - costBasis) * quantity;
      const fee = totalValue * tradingFee;
      realizedPnL = grossPnL - fee;
      realizedPnLPercent = costBasis > 0 ? (price - costBasis) / costBasis : 0;

      existingPosition.quantity -= quantity;
      existingPosition.totalValue = existingPosition.quantity * price;
      portfolio.cashBalance += totalValue;

      if (existingPosition.quantity === 0) {
        portfolio.positions.delete(signal.coinId);
      } else {
        portfolio.positions.set(signal.coinId, existingPosition);
      }
    }

    const fee = totalValue * tradingFee;
    portfolio.cashBalance -= fee;
    portfolio.totalValue = portfolio.cashBalance + this.calculatePositionsValue(portfolio.positions, marketData.prices);

    return {
      trade: {
        type: signal.action === 'BUY' ? TradeType.BUY : TradeType.SELL,
        quantity,
        price,
        totalValue,
        fee,
        realizedPnL,
        realizedPnLPercent,
        costBasis,
        metadata: {
          reason: signal.reason,
          confidence: signal.confidence ?? 0,
          basePrice, // Original price before slippage
          slippageBps // Simulated slippage applied
        }
      } as Partial<BacktestTrade>,
      slippageBps
    };
  }

  private calculatePositionsValue(positions: Map<string, Position>, currentPrices: Map<string, number>): number {
    let total = 0;
    for (const [coinId, position] of positions) {
      const price = currentPrices.get(coinId) ?? 0;
      total += position.quantity * price;
    }
    return total;
  }

  private portfolioToHoldings(portfolio: Portfolio, prices: Map<string, number>) {
    const holdings: Record<string, { quantity: number; value: number; price: number }> = {};
    for (const [coinId, position] of portfolio.positions) {
      const price = prices.get(coinId) ?? 0;
      holdings[coinId] = {
        quantity: position.quantity,
        value: position.quantity * price,
        price
      };
    }
    return holdings;
  }

  private calculateFinalMetrics(
    backtest: Backtest,
    portfolio: Portfolio,
    trades: Partial<BacktestTrade>[],
    snapshots: Partial<BacktestPerformanceSnapshot>[],
    maxDrawdown: number
  ): BacktestFinalMetrics {
    const finalValue = portfolio.totalValue;
    const totalReturn = (finalValue - backtest.initialCapital) / backtest.initialCapital;
    const totalTrades = trades.length;

    // Win rate is based on SELL trades with positive realized P&L
    // Only SELL trades have P&L calculated (they close positions)
    const sellTrades = trades.filter((t) => t.type === TradeType.SELL);
    const winningTrades = sellTrades.filter((t) => (t.realizedPnL ?? 0) > 0).length;
    const sellTradeCount = sellTrades.length;

    const durationDays = dayjs(backtest.endDate).diff(dayjs(backtest.startDate), 'day');
    const annualizedReturn = durationDays > 0 ? Math.pow(1 + totalReturn, 365 / durationDays) - 1 : totalReturn;

    const sharpeRatio = this.calculateSharpeRatio(snapshots, backtest.initialCapital);

    return {
      finalValue,
      totalReturn,
      annualizedReturn,
      sharpeRatio,
      maxDrawdown,
      totalTrades,
      winningTrades,
      winRate: sellTradeCount > 0 ? winningTrades / sellTradeCount : 0
    };
  }

  private calculateSharpeRatio(snapshots: Partial<BacktestPerformanceSnapshot>[], initialCapital: number): number {
    if (!snapshots.length) {
      return 0;
    }

    const returns: number[] = [];
    for (let i = 1; i < snapshots.length; i++) {
      const previous = snapshots[i - 1].portfolioValue ?? initialCapital;
      const current = snapshots[i].portfolioValue ?? initialCapital;
      returns.push(previous === 0 ? 0 : (current - previous) / previous);
    }

    if (returns.length === 0) {
      return 0;
    }

    // Use centralized calculator for consistent annualized Sharpe ratio
    // Historical backtests use daily snapshots, so periodsPerYear = 252
    return this.sharpeCalculator.calculate(returns, 0.02, 252);
  }

  /**
   * Restore portfolio state from a checkpoint.
   * Converts the serializable CheckpointPortfolio format back to the internal Portfolio structure.
   */
  private restorePortfolio(checkpointPortfolio: CheckpointPortfolio, initialCapital: number): Portfolio {
    const positions = new Map<string, Position>();
    let positionsValue = 0;

    for (const pos of checkpointPortfolio.positions) {
      const totalValue = pos.quantity * pos.averagePrice;
      positions.set(pos.coinId, {
        coinId: pos.coinId,
        quantity: pos.quantity,
        averagePrice: pos.averagePrice,
        totalValue
      });
      positionsValue += totalValue;
    }

    return {
      cashBalance: checkpointPortfolio.cashBalance,
      positions,
      totalValue: checkpointPortfolio.cashBalance + positionsValue
    };
  }

  /**
   * Build checksum data object for checkpoint integrity verification.
   * Centralized to ensure consistency between checkpoint creation and validation.
   */
  private buildChecksumData(
    lastProcessedIndex: number,
    lastProcessedTimestamp: string,
    cashBalance: number,
    positionCount: number,
    peakValue: number,
    maxDrawdown: number,
    rngState: number
  ): string {
    return JSON.stringify({
      lastProcessedIndex,
      lastProcessedTimestamp,
      cashBalance,
      positionCount,
      peakValue,
      maxDrawdown,
      rngState
    });
  }

  /**
   * Build a checkpoint state object for persistence.
   * Includes all state needed to resume execution from this point.
   */
  private buildCheckpointState(
    lastProcessedIndex: number,
    lastProcessedTimestamp: string,
    portfolio: Portfolio,
    peakValue: number,
    maxDrawdown: number,
    rngState: number,
    tradesCount: number,
    signalsCount: number,
    fillsCount: number,
    snapshotsCount: number
  ): BacktestCheckpointState {
    // Convert Map-based positions to array format for JSON serialization
    const checkpointPortfolio: CheckpointPortfolio = {
      cashBalance: portfolio.cashBalance,
      positions: Array.from(portfolio.positions.entries()).map(([coinId, pos]) => ({
        coinId,
        quantity: pos.quantity,
        averagePrice: pos.averagePrice
      }))
    };

    // Build checksum for data integrity verification using centralized helper
    const checksumData = this.buildChecksumData(
      lastProcessedIndex,
      lastProcessedTimestamp,
      portfolio.cashBalance,
      portfolio.positions.size,
      peakValue,
      maxDrawdown,
      rngState
    );
    const checksum = createHash('sha256').update(checksumData).digest('hex').substring(0, 16);

    return {
      lastProcessedIndex,
      lastProcessedTimestamp,
      portfolio: checkpointPortfolio,
      peakValue,
      maxDrawdown,
      rngState,
      persistedCounts: {
        trades: tradesCount,
        signals: signalsCount,
        fills: fillsCount,
        snapshots: snapshotsCount
      },
      checksum
    };
  }

  /**
   * Validate a checkpoint state against current market data.
   * Returns true if the checkpoint is valid and can be used for resume.
   */
  validateCheckpoint(checkpoint: BacktestCheckpointState, timestamps: string[]): { valid: boolean; reason?: string } {
    // Check if the checkpoint index is within bounds
    if (checkpoint.lastProcessedIndex < 0 || checkpoint.lastProcessedIndex >= timestamps.length) {
      return {
        valid: false,
        reason: `Checkpoint index ${checkpoint.lastProcessedIndex} out of bounds (0-${timestamps.length - 1})`
      };
    }

    // Verify the timestamp at the checkpoint index matches
    const expectedTimestamp = timestamps[checkpoint.lastProcessedIndex];
    if (checkpoint.lastProcessedTimestamp !== expectedTimestamp) {
      return {
        valid: false,
        reason: `Timestamp mismatch at index ${checkpoint.lastProcessedIndex}: expected ${expectedTimestamp}, got ${checkpoint.lastProcessedTimestamp}`
      };
    }

    // Verify checksum integrity using centralized helper for consistency
    const checksumData = this.buildChecksumData(
      checkpoint.lastProcessedIndex,
      checkpoint.lastProcessedTimestamp,
      checkpoint.portfolio.cashBalance,
      checkpoint.portfolio.positions.length,
      checkpoint.peakValue,
      checkpoint.maxDrawdown,
      checkpoint.rngState
    );
    const expectedChecksum = createHash('sha256').update(checksumData).digest('hex').substring(0, 16);

    if (checkpoint.checksum !== expectedChecksum) {
      return { valid: false, reason: 'Checkpoint checksum validation failed - data may be corrupted' };
    }

    return { valid: true };
  }

  /**
   * Execute a lightweight backtest for parameter optimization
   * This method doesn't persist any data - it runs the simulation and returns metrics only
   */
  async executeOptimizationBacktest(
    config: OptimizationBacktestConfig,
    coins: Coin[]
  ): Promise<OptimizationBacktestResult> {
    const initialCapital = config.initialCapital ?? 10000;
    const tradingFee = config.tradingFee ?? 0.001;
    const deterministicSeed = `optimization-${config.algorithmId}-${Date.now()}`;

    this.logger.debug(
      `Running optimization backtest: algo=${config.algorithmId}, ` +
        `range=${config.startDate.toISOString()} to ${config.endDate.toISOString()}`
    );

    const rng = new SeededRandom(deterministicSeed);

    let portfolio: Portfolio = {
      cashBalance: initialCapital,
      positions: new Map(),
      totalValue: initialCapital
    };

    const trades: Partial<BacktestTrade>[] = [];
    const snapshots: { portfolioValue: number; timestamp: Date }[] = [];

    const coinIds = coins.map((coin) => coin.id);
    const historicalPrices = await this.getHistoricalPrices(coinIds, config.startDate, config.endDate);

    if (historicalPrices.length === 0) {
      // Return neutral metrics if no price data
      return {
        sharpeRatio: 0,
        totalReturn: 0,
        maxDrawdown: 0,
        winRate: 0,
        volatility: 0,
        profitFactor: 1,
        tradeCount: 0
      };
    }

    const pricesByTimestamp = this.groupPricesByTimestamp(historicalPrices);
    const timestamps = Object.keys(pricesByTimestamp).sort();

    // Build price history for algorithm context
    const priceHistoryByCoin = new Map<string, { avg: number; date: Date; high: number; low: number }[]>();
    const indexByCoin = new Map<string, number>();

    for (const coinId of coinIds) {
      const history = historicalPrices
        .filter((price) => price.coinId === coinId)
        .sort((a, b) => this.getPriceTimestamp(a).getTime() - this.getPriceTimestamp(b).getTime())
        .map((price) => {
          const summary = this.buildPriceSummary(price);
          return {
            avg: summary.avg,
            date: summary.date,
            high: summary.high,
            low: summary.low
          };
        });
      priceHistoryByCoin.set(coinId, history);
      indexByCoin.set(coinId, -1);
    }

    let peakValue = initialCapital;
    let maxDrawdown = 0;

    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = new Date(timestamps[i]);
      const currentPrices = pricesByTimestamp[timestamps[i]];

      const marketData: MarketData = {
        timestamp,
        prices: new Map(currentPrices.map((price) => [price.coinId, this.getPriceValue(price)]))
      };

      portfolio = this.updatePortfolioValues(portfolio, marketData.prices);

      // Build price data context for algorithm
      const priceData: Record<string, { avg: number; coin: string; date: Date; high: number; low: number }[]> = {};
      for (const coin of coins) {
        const history = priceHistoryByCoin.get(coin.id) ?? [];
        let pointer = indexByCoin.get(coin.id) ?? -1;
        while (pointer + 1 < history.length && history[pointer + 1].date <= timestamp) {
          pointer += 1;
        }
        indexByCoin.set(coin.id, pointer);
        if (pointer >= 0) {
          priceData[coin.id] = history.slice(0, pointer + 1).map((h) => ({
            ...h,
            coin: coin.id
          }));
        }
      }

      // Build algorithm context with optimization parameters
      const context = {
        coins,
        priceData,
        timestamp,
        config: config.parameters, // Use optimization parameters instead of stored config
        positions: Object.fromEntries(
          [...portfolio.positions.entries()].map(([id, position]) => [id, position.quantity])
        ),
        availableBalance: portfolio.cashBalance,
        metadata: {
          isOptimization: true,
          algorithmId: config.algorithmId
        }
      };

      let strategySignals: TradingSignal[] = [];
      try {
        const result = await this.algorithmRegistry.executeAlgorithm(config.algorithmId, context);
        if (result.success && result.signals?.length) {
          strategySignals = result.signals.map(mapStrategySignal).filter((signal) => signal.action !== 'HOLD');
        }
      } catch (error) {
        if (error instanceof AlgorithmNotRegisteredException) {
          throw error;
        }
        // Log but continue - optimization should be resilient to occasional failures
        this.logger.warn(`Algorithm execution failed at ${timestamp.toISOString()}: ${error.message}`);
      }

      for (const strategySignal of strategySignals) {
        const tradeResult = await this.executeTrade(strategySignal, portfolio, marketData, tradingFee, rng);
        if (tradeResult) {
          trades.push({ ...tradeResult.trade, executedAt: timestamp });
        }
      }

      // Track peak and drawdown
      if (portfolio.totalValue > peakValue) {
        peakValue = portfolio.totalValue;
      }
      const currentDrawdown = peakValue === 0 ? 0 : (peakValue - portfolio.totalValue) / peakValue;
      if (currentDrawdown > maxDrawdown) {
        maxDrawdown = currentDrawdown;
      }

      // Sample snapshots less frequently for optimization (every 24 periods)
      if (i % 24 === 0 || i === timestamps.length - 1) {
        snapshots.push({
          timestamp,
          portfolioValue: portfolio.totalValue
        });
      }
    }

    // Calculate final metrics
    const finalValue = portfolio.totalValue;
    const totalReturn = (finalValue - initialCapital) / initialCapital;
    const totalTrades = trades.length;

    // Win rate is based on SELL trades with positive realized P&L
    const sellTrades = trades.filter((t) => t.type === TradeType.SELL);
    const winningTrades = sellTrades.filter((t) => (t.realizedPnL ?? 0) > 0).length;
    const sellTradeCount = sellTrades.length;
    const winRate = sellTradeCount > 0 ? winningTrades / sellTradeCount : 0;

    const durationDays = dayjs(config.endDate).diff(dayjs(config.startDate), 'day');
    const annualizedReturn = durationDays > 0 ? Math.pow(1 + totalReturn, 365 / durationDays) - 1 : totalReturn;

    // Calculate returns from snapshots
    const returns: number[] = [];
    for (let i = 1; i < snapshots.length; i++) {
      const previous = snapshots[i - 1].portfolioValue;
      const current = snapshots[i].portfolioValue;
      returns.push(previous === 0 ? 0 : (current - previous) / previous);
    }

    // Calculate annualized volatility (still needed for metrics interface)
    const avgReturn = returns.length > 0 ? returns.reduce((sum, r) => sum + r, 0) / returns.length : 0;
    const variance =
      returns.length > 0 ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length : 0;
    const volatility = Math.sqrt(variance) * Math.sqrt(252); // Annualized volatility

    // Calculate downside deviation (standard deviation of negative returns only)
    // Used for Sortino ratio: measures volatility of losses, ignoring upside volatility
    const negativeReturns = returns.filter((r) => r < 0);
    const downsideVariance =
      negativeReturns.length > 0
        ? negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length
        : 0;
    const downsideDeviation = Math.sqrt(downsideVariance) * Math.sqrt(252); // Annualized

    // Calculate Sharpe ratio using centralized calculator for consistency
    const sharpeRatio = this.sharpeCalculator.calculate(returns, 0.02, 252);

    // Calculate profit factor based on realized P&L from SELL trades
    const grossProfit = sellTrades
      .filter((t) => (t.realizedPnL ?? 0) > 0)
      .reduce((sum, t) => sum + (t.realizedPnL ?? 0), 0);
    const grossLoss = Math.abs(
      sellTrades.filter((t) => (t.realizedPnL ?? 0) < 0).reduce((sum, t) => sum + (t.realizedPnL ?? 0), 0)
    );
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 1;

    return {
      sharpeRatio,
      totalReturn,
      maxDrawdown,
      winRate,
      volatility,
      profitFactor: Math.min(profitFactor, 10), // Cap at 10 to avoid infinity issues
      tradeCount: totalTrades,
      annualizedReturn,
      finalValue,
      downsideDeviation
    };
  }
}
