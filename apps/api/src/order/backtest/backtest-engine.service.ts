import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import * as dayjs from 'dayjs';

import { createHash } from 'crypto';

import {
  BacktestCheckpointState,
  CheckpointPortfolio,
  DEFAULT_CHECKPOINT_CONFIG
} from './backtest-checkpoint.interface';
import {
  calculateReplayDelay,
  CheckpointResults,
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_LIVE_REPLAY_CHECKPOINT_INTERVAL,
  LiveReplayExecuteOptions,
  LiveReplayExecuteResult,
  ReplaySpeed
} from './backtest-pacing.interface';
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
  DEFAULT_THROTTLE_CONFIG,
  FeeCalculatorService,
  MetricsCalculatorService,
  Portfolio,
  PortfolioStateService,
  PositionManagerService,
  SerializableThrottleState,
  SlippageModelType as SharedSlippageModelType,
  SignalThrottleConfig,
  SignalThrottleService,
  SlippageConfig,
  SlippageService,
  ThrottleState,
  TimeframeType
} from './shared';

import {
  AlgorithmContext,
  AlgorithmResult,
  SignalType as AlgoSignalType,
  TradingSignal as StrategySignal
} from '../../algorithm/interfaces';
import { AlgorithmRegistry } from '../../algorithm/registry/algorithm-registry.service';
import { Coin } from '../../coin/coin.entity';
import { AlgorithmNotRegisteredException } from '../../common/exceptions';
import { OHLCCandle, PriceSummary, PriceSummaryByPeriod } from '../../ohlc/ohlc-candle.entity';
import { OHLCService } from '../../ohlc/ohlc.service';
import { toErrorInfo } from '../../shared/error.util';

// Default slippage config using shared service
const DEFAULT_SLIPPAGE_CONFIG: SlippageConfig = {
  type: SharedSlippageModelType.FIXED,
  fixedBps: 5,
  maxSlippageBps: 500
};

export interface MarketData {
  timestamp: Date;
  prices: Map<string, number>; // coinId -> price
}

// Re-export Position and Portfolio from shared module for backwards compatibility
export { Portfolio, Position } from './shared';

export interface TradingSignal {
  action: 'BUY' | 'SELL' | 'HOLD';
  coinId: string;
  quantity?: number;
  percentage?: number;
  reason: string;
  confidence?: number;
  metadata?: Record<string, any>;
  /** Preserves the original algorithm signal type (e.g. STOP_LOSS, TAKE_PROFIT) */
  originalType?: AlgoSignalType;
}

interface ExecuteOptions {
  dataset: MarketDataSet;
  deterministicSeed: string;
  telemetryEnabled?: boolean;

  /** Minimum time a position must be held before selling (ms). Default: 24h.
   *  Risk-control signals (STOP_LOSS, TAKE_PROFIT) always bypass this. */
  minHoldMs?: number;

  // Checkpoint options for resume capability
  /** Number of timestamps between checkpoints (default: 500) */
  checkpointInterval?: number;
  /** Callback invoked at each checkpoint with current state and total timestamp count */
  onCheckpoint?: (state: BacktestCheckpointState, results: CheckpointResults, totalTimestamps: number) => Promise<void>;
  /** Lightweight callback for progress updates (called at most every ~30 seconds) */
  onHeartbeat?: (index: number, totalTimestamps: number) => Promise<void>;
  /** Checkpoint state to resume from (if resuming a previous run) */
  resumeFrom?: BacktestCheckpointState;
}

interface MetricsAccumulator {
  totalTradeCount: number;
  totalSellCount: number;
  totalWinningSellCount: number;
  /** Portfolio values collected across all checkpoints for Sharpe calculation.
   *  Not cleared at checkpoints (Sharpe needs the full series).
   *  Bounded: 8 bytes/entry — ~14KB for 5yr daily, ~4MB for 1yr minute-level. */
  snapshotValues: number[];
  callbacks: {
    addTradeCount: (n: number) => void;
    addSellCount: (n: number) => void;
    addWinningSellCount: (n: number) => void;
    addSnapshotValues: (vals: number[]) => void;
  };
}

// Note: Seeded random generation now uses SeededRandom class for checkpoint support
// CheckpointResults is imported from backtest-pacing.interface.ts

const mapStrategySignal = (signal: StrategySignal): TradingSignal => {
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

  return {
    action,
    coinId: signal.coinId,
    quantity: signal.quantity,
    percentage: signal.strength,
    reason: signal.reason,
    confidence: signal.confidence,
    metadata: signal.metadata,
    originalType: signal.type
  };
};

const classifySignalType = (signal: TradingSignal): SignalType => {
  if (signal.originalType === AlgoSignalType.STOP_LOSS || signal.originalType === AlgoSignalType.TAKE_PROFIT) {
    return SignalType.RISK_CONTROL;
  }
  if (signal.action === 'BUY') return SignalType.ENTRY;
  if (signal.action === 'SELL') return SignalType.EXIT;
  return SignalType.ADJUSTMENT;
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

interface PriceTrackingContext {
  /** Only timestamps are stored (not full OHLCCandle objects) to reduce memory. */
  timestampsByCoin: Map<string, Date[]>;
  summariesByCoin: Map<string, PriceSummary[]>;
  indexByCoin: Map<string, number>;
  windowsByCoin: Map<string, PriceSummary[]>;
}

@Injectable()
export class BacktestEngine {
  private readonly logger = new Logger(BacktestEngine.name);

  /** Maximum allocation per trade (20% of portfolio) */
  private static readonly MAX_ALLOCATION = 0.2;
  /** Minimum allocation per trade (5% of portfolio) */
  private static readonly MIN_ALLOCATION = 0.05;
  /** Default minimum hold period before allowing SELL (24 hours in ms) */
  private static readonly DEFAULT_MIN_HOLD_MS = 24 * 60 * 60 * 1000;
  /** Maximum price history entries kept per coin in the sliding window.
   *  Strategies typically need at most ~200 periods; 500 provides ample margin. */
  private static readonly MAX_WINDOW_SIZE = 500;
  /** Per-iteration algorithm execution timeout (ms) */
  private static readonly ALGORITHM_TIMEOUT_MS = 60_000;

  constructor(
    private readonly backtestStream: BacktestStreamService,
    private readonly algorithmRegistry: AlgorithmRegistry,
    @Inject(forwardRef(() => OHLCService))
    private readonly ohlcService: OHLCService,
    private readonly marketDataReader: MarketDataReaderService,
    private readonly quoteCurrencyResolver: QuoteCurrencyResolverService,
    // Shared backtest services
    private readonly slippageService: SlippageService,
    private readonly feeCalculator: FeeCalculatorService,
    private readonly positionManager: PositionManagerService,
    private readonly metricsCalculator: MetricsCalculatorService,
    private readonly portfolioState: PortfolioStateService,
    private readonly signalThrottle: SignalThrottleService
  ) {}

  /**
   * Resolve throttle config from strategy parameters, falling back to defaults.
   */
  private resolveThrottleConfig(params?: Record<string, unknown>): SignalThrottleConfig {
    const clamp = (val: unknown, fallback: number, min: number, max: number): number => {
      const n = typeof val === 'number' && isFinite(val) ? val : fallback;
      return Math.max(min, Math.min(max, n));
    };
    return {
      cooldownMs: clamp(params?.cooldownMs, DEFAULT_THROTTLE_CONFIG.cooldownMs, 0, 604_800_000),
      maxTradesPerDay: clamp(params?.maxTradesPerDay, DEFAULT_THROTTLE_CONFIG.maxTradesPerDay, 0, 50),
      minSellPercent: clamp(params?.minSellPercent, DEFAULT_THROTTLE_CONFIG.minSellPercent, 0, 1)
    };
  }

  /**
   * Map legacy slippage model type string to shared enum
   */
  private mapSlippageModelType(model?: string): SharedSlippageModelType {
    switch (model) {
      case 'none':
        return SharedSlippageModelType.NONE;
      case 'volume-based':
        return SharedSlippageModelType.VOLUME_BASED;
      case 'historical':
        return SharedSlippageModelType.HISTORICAL;
      case 'fixed':
      default:
        return SharedSlippageModelType.FIXED;
    }
  }

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
      portfolio = this.portfolioState.deserialize(options.resumeFrom.portfolio);
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

    // Cumulative persisted counts - tracks total items persisted across all checkpoints
    const totalPersistedCounts =
      isResuming && options.resumeFrom
        ? { ...options.resumeFrom.persistedCounts }
        : { trades: 0, signals: 0, fills: 0, snapshots: 0 };

    // Lightweight metrics accumulators - avoids keeping full objects in memory after checkpoint
    const metricsAcc = this.createMetricsAccumulator(
      totalPersistedCounts.trades,
      totalPersistedCounts.sells ?? 0,
      totalPersistedCounts.winningSells ?? 0
    );

    const coinIds = coins.map((coin) => coin.id);
    const coinMap = new Map<string, Coin>(coins.map((coin) => [coin.id, coin]));

    // Resolve quote currency from configSnapshot (default: USDT) with fallback chain
    const preferredQuoteCurrency = (backtest.configSnapshot?.run?.quoteCurrency as string) ?? 'USDT';
    const quoteCoin = await this.quoteCurrencyResolver.resolveQuoteCurrency(preferredQuoteCurrency);

    // Load data from full dataset range for indicator warmup
    const dataLoadStartDate = options.dataset.startAt ?? backtest.startDate;
    const dataLoadEndDate = options.dataset.endAt ?? backtest.endDate;
    // Trading boundaries: always use the backtest's configured dates
    const tradingStartDate = backtest.startDate;
    const tradingEndDate = backtest.endDate;

    let historicalPrices: OHLCCandle[];

    if (this.marketDataReader.hasStorageLocation(options.dataset)) {
      // Use CSV data from MinIO storage
      this.logger.log(`Reading market data from storage: ${options.dataset.storageLocation}`);
      const marketDataResult = await this.marketDataReader.readMarketData(
        options.dataset,
        dataLoadStartDate,
        dataLoadEndDate
      );
      historicalPrices = this.convertOHLCVToCandles(marketDataResult.data);
      this.logger.log(
        `Loaded ${historicalPrices.length} candle records from storage (${marketDataResult.dateRange.start.toISOString()} to ${marketDataResult.dateRange.end.toISOString()})`
      );
    } else {
      // Fall back to database OHLC table
      historicalPrices = await this.getHistoricalPrices(coinIds, dataLoadStartDate, dataLoadEndDate);
    }

    if (historicalPrices.length === 0) {
      throw new Error('No historical price data available for the specified date range');
    }

    const pricesByTimestamp = this.groupPricesByTimestamp(historicalPrices);
    const timestamps = Object.keys(pricesByTimestamp).sort();

    const priceCtx = this.initPriceTracking(historicalPrices, coinIds);

    // Drop reference to the full candles array — objects still live in pricesByTimestamp
    historicalPrices = [];

    // Calculate warmup vs trading boundaries
    const tradingStartIndex = timestamps.findIndex((ts) => new Date(ts) >= tradingStartDate);
    const tradingEndIdx = (() => {
      let lastIdx = timestamps.length - 1;
      while (lastIdx >= 0 && new Date(timestamps[lastIdx]) > tradingEndDate) lastIdx--;
      return lastIdx;
    })();
    const effectiveTradingStartIndex = tradingStartIndex >= 0 ? tradingStartIndex : 0;
    // Trim timestamps to not exceed the trading end date
    const effectiveTimestampCount = tradingEndIdx + 1;
    const tradingTimestampCount = effectiveTimestampCount - effectiveTradingStartIndex;

    this.logger.log(
      `Processing ${timestamps.length} time periods (warmup: ${effectiveTradingStartIndex}, trading: ${tradingTimestampCount})`
    );

    // Build slippage config from backtest configSnapshot using shared service
    const slippageSnapshot = backtest.configSnapshot?.slippage;
    const slippageConfig: SlippageConfig = slippageSnapshot
      ? this.slippageService.buildConfig({
          type: this.mapSlippageModelType(slippageSnapshot.model as string),
          fixedBps: slippageSnapshot.fixedBps ?? 5,
          baseSlippageBps: slippageSnapshot.baseBps ?? 5,
          volumeImpactFactor: slippageSnapshot.volumeImpactFactor ?? 100
        })
      : DEFAULT_SLIPPAGE_CONFIG;

    // Minimum hold period: configurable via options, default 24h
    const minHoldMs = options.minHoldMs ?? BacktestEngine.DEFAULT_MIN_HOLD_MS;

    // Signal throttle: resolve config from strategy parameters, init or restore state
    const throttleConfig = this.resolveThrottleConfig(
      backtest.configSnapshot?.parameters as Record<string, unknown> | undefined
    );
    let throttleState: ThrottleState;
    if (isResuming && options.resumeFrom?.throttleState) {
      throttleState = this.signalThrottle.deserialize(options.resumeFrom.throttleState);
    } else {
      throttleState = this.signalThrottle.createState();
    }

    // Determine starting index: either from checkpoint or from beginning
    const startIndex = isResuming && options.resumeFrom ? options.resumeFrom.lastProcessedIndex + 1 : 0;

    if (isResuming) {
      this.logger.log(
        `Resuming from index ${startIndex} of ${effectiveTimestampCount} (${((startIndex / effectiveTimestampCount) * 100).toFixed(1)}% complete)`
      );

      // Fast-forward price windows to the resume point so indicators have correct history
      if (startIndex > 0) {
        for (let j = 0; j < startIndex; j++) {
          this.advancePriceWindows(priceCtx, coins, new Date(timestamps[j]));
        }
        this.logger.log(`Fast-forwarded price windows through ${startIndex} timestamps for resume`);
      }
    }

    // Track result counts at last checkpoint for proper slicing during incremental persistence
    // When resuming, initialize from the checkpoint's persisted counts; otherwise start at zero
    let lastCheckpointCounts =
      isResuming && options.resumeFrom
        ? { ...options.resumeFrom.persistedCounts }
        : { trades: 0, signals: 0, fills: 0, snapshots: 0 };

    // Track timestamp index for checkpoint interval calculation
    let lastCheckpointIndex = startIndex - 1;

    // Track consecutive algorithm failures to detect systematic issues
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 10;

    // Time-based heartbeat tracking (every ~30 seconds instead of every N iterations)
    let lastHeartbeatTime = Date.now();
    const HEARTBEAT_INTERVAL_MS = 30_000;

    for (let i = startIndex; i < effectiveTimestampCount; i++) {
      const iterStart = Date.now();
      const timestamp = new Date(timestamps[i]);
      const currentPrices = pricesByTimestamp[timestamps[i]];
      const isWarmup = i < effectiveTradingStartIndex;

      const marketData: MarketData = {
        timestamp,
        prices: new Map(currentPrices.map((price) => [price.coinId, this.getPriceValue(price)]))
      };

      // Always update portfolio values and advance price windows (needed for indicator warmup)
      portfolio = this.portfolioState.updateValues(portfolio, marketData.prices);

      const priceData = this.advancePriceWindows(priceCtx, coins, timestamp);

      // During warmup: run algorithm to prime internal state but skip trading/recording
      if (isWarmup) {
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
        try {
          await this.executeAlgorithmWithTimeout(
            backtest.algorithm.id,
            context,
            `warmup ${i}/${effectiveTradingStartIndex} (${timestamp.toISOString()})`
          );
        } catch {
          // Warmup failures are non-fatal — algorithm just won't have primed state
        }
        continue;
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
        const algoExecStart = Date.now();
        const result = await this.executeAlgorithmWithTimeout(
          backtest.algorithm.id,
          context,
          `iteration ${i}/${effectiveTimestampCount} (${timestamp.toISOString()})`
        );

        const algoExecDuration = Date.now() - algoExecStart;
        if (algoExecDuration > 5000) {
          this.logger.warn(
            `Slow algorithm execution at iteration ${i}/${effectiveTimestampCount}: ${algoExecDuration}ms ` +
              `(${backtest.algorithm.id}, ${timestamp.toISOString()})`
          );
        }

        if (result.success && result.signals?.length) {
          strategySignals = result.signals.map(mapStrategySignal).filter((signal) => signal.action !== 'HOLD');
        }
        consecutiveErrors = 0;
      } catch (error: unknown) {
        if (error instanceof AlgorithmNotRegisteredException) {
          throw error;
        }
        const err = toErrorInfo(error);
        consecutiveErrors++;
        this.logger.warn(
          `Algorithm execution failed at ${timestamp.toISOString()} ` +
            `(${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${err.message}`
        );
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          throw new Error(`Algorithm failed ${MAX_CONSECUTIVE_ERRORS} consecutive times. Last error: ${err.message}`);
        }
      }

      // Apply signal throttle: cooldowns, daily cap, min sell %
      strategySignals = this.signalThrottle.filterSignals(
        strategySignals,
        throttleState,
        throttleConfig,
        timestamp.getTime()
      );

      for (const strategySignal of strategySignals) {
        const signalRecord: Partial<BacktestSignal> = {
          timestamp,
          signalType: classifySignalType(strategySignal),
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

        // Extract volume from current candle for volume-based slippage calculation
        const dailyVolume = this.extractDailyVolume(currentPrices, strategySignal.coinId);

        const tradeResult = await this.executeTrade(
          strategySignal,
          portfolio,
          marketData,
          backtest.tradingFee,
          rng,
          slippageConfig,
          dailyVolume,
          minHoldMs
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

      const tradingRelativeIdx = i - effectiveTradingStartIndex;
      if (tradingRelativeIdx % 24 === 0 || i === effectiveTimestampCount - 1) {
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

      // Iteration timing telemetry
      const iterDuration = Date.now() - iterStart;
      if (iterDuration > 5000) {
        this.logger.warn(
          `Slow iteration ${i}/${effectiveTimestampCount} took ${iterDuration}ms ` + `at ${timestamp.toISOString()}`
        );
      }

      // Lightweight heartbeat for stale detection (every ~30 seconds)
      // Report progress relative to trading period
      if (options.onHeartbeat && Date.now() - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
        await options.onHeartbeat(tradingRelativeIdx, tradingTimestampCount);
        lastHeartbeatTime = Date.now();
      }

      // Checkpoint callback: save state periodically for resume capability
      const timeSinceLastCheckpoint = i - lastCheckpointIndex;
      if (options.onCheckpoint && timeSinceLastCheckpoint >= checkpointInterval) {
        const currentSells = this.countSells(trades);
        const checkpointState = this.buildCheckpointState(
          i,
          timestamp.toISOString(),
          portfolio,
          peakValue,
          maxDrawdown,
          rng.getState(),
          totalPersistedCounts.trades + trades.length,
          totalPersistedCounts.signals + signals.length,
          totalPersistedCounts.fills + simulatedFills.length,
          totalPersistedCounts.snapshots + snapshots.length,
          metricsAcc.totalSellCount + currentSells.sells,
          metricsAcc.totalWinningSellCount + currentSells.winningSells,
          this.signalThrottle.serialize(throttleState)
        );

        // Results accumulated since last checkpoint - use counts from last checkpoint for proper slicing
        const checkpointResults: CheckpointResults = {
          trades: trades.slice(lastCheckpointCounts.trades),
          signals: signals.slice(lastCheckpointCounts.signals),
          simulatedFills: simulatedFills.slice(lastCheckpointCounts.fills),
          snapshots: snapshots.slice(lastCheckpointCounts.snapshots)
        };

        // Pass trading timestamp count to callback for accurate progress reporting
        await options.onCheckpoint(checkpointState, checkpointResults, tradingTimestampCount);

        // Harvest metrics from current arrays into accumulators before clearing
        this.harvestMetrics(trades, snapshots, metricsAcc.callbacks);

        // Update cumulative persisted counts and clear arrays to free memory
        totalPersistedCounts.trades += trades.length;
        totalPersistedCounts.signals += signals.length;
        totalPersistedCounts.fills += simulatedFills.length;
        totalPersistedCounts.snapshots += snapshots.length;
        trades.length = 0;
        signals.length = 0;
        simulatedFills.length = 0;
        snapshots.length = 0;
        lastCheckpointCounts = { trades: 0, signals: 0, fills: 0, snapshots: 0 };
        lastCheckpointIndex = i;

        this.logger.debug(
          `Checkpoint saved at index ${i}/${effectiveTimestampCount} (${((tradingRelativeIdx / tradingTimestampCount) * 100).toFixed(1)}%)`
        );
      }
    }

    // Release large data structures — no longer needed after the main loop.
    // Clear in-place so GC can reclaim memory during metrics calculation and persistence.
    this.clearPriceData(pricesByTimestamp, priceCtx);

    // Harvest remaining items from final (post-last-checkpoint) arrays
    this.harvestMetrics(trades, snapshots, metricsAcc.callbacks);

    const finalMetrics = this.calculateFinalMetricsFromAccumulators(
      backtest,
      portfolio,
      metricsAcc.totalTradeCount,
      metricsAcc.totalSellCount,
      metricsAcc.totalWinningSellCount,
      metricsAcc.snapshotValues,
      maxDrawdown
    );

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

    this.logger.log(
      `Backtest completed: ${metricsAcc.totalTradeCount} trades, final value: $${portfolio.totalValue.toFixed(2)}`
    );

    return { trades, signals, simulatedFills, snapshots, finalMetrics };
  }

  /**
   * Helper method to introduce a delay between timestamp processing.
   * Used for live replay pacing.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Execute a live replay backtest with real-time pacing and pause/resume support.
   *
   * Key differences from executeHistoricalBacktest:
   * - Configurable delay between timestamps (pacing)
   * - Support for pause/resume via shouldPause callback
   * - More frequent checkpoints (every 100 timestamps vs 500 for historical)
   * - Returns paused state with checkpoint if paused
   *
   * @param backtest - The backtest entity
   * @param coins - Coins to include in the backtest
   * @param options - Live replay execution options including pacing configuration
   */
  async executeLiveReplayBacktest(
    backtest: Backtest,
    coins: Coin[],
    options: LiveReplayExecuteOptions
  ): Promise<LiveReplayExecuteResult> {
    if (!backtest.algorithm) {
      throw new Error('Backtest algorithm relation not loaded');
    }

    const isResuming = !!options.resumeFrom;
    const checkpointInterval = options.checkpointInterval ?? DEFAULT_LIVE_REPLAY_CHECKPOINT_INTERVAL;
    const replaySpeed = options.replaySpeed ?? ReplaySpeed.FAST_5X;
    const baseIntervalMs = options.baseIntervalMs ?? DEFAULT_BASE_INTERVAL_MS;
    const delayMs = calculateReplayDelay(replaySpeed, baseIntervalMs);

    this.logger.log(
      `Starting live replay backtest: ${backtest.name} (dataset=${options.dataset.id}, seed=${options.deterministicSeed}, resuming=${isResuming}, speed=${ReplaySpeed[replaySpeed]}, delay=${delayMs}ms)`
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
      portfolio = this.portfolioState.deserialize(options.resumeFrom.portfolio);
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

    // Cumulative persisted counts - tracks total items persisted across all checkpoints
    const totalPersistedCounts =
      isResuming && options.resumeFrom
        ? { ...options.resumeFrom.persistedCounts }
        : { trades: 0, signals: 0, fills: 0, snapshots: 0 };

    // Lightweight metrics accumulators - avoids keeping full objects in memory after checkpoint
    const metricsAcc = this.createMetricsAccumulator(
      totalPersistedCounts.trades,
      totalPersistedCounts.sells ?? 0,
      totalPersistedCounts.winningSells ?? 0
    );

    const coinIds = coins.map((coin) => coin.id);
    const coinMap = new Map<string, Coin>(coins.map((coin) => [coin.id, coin]));

    // Resolve quote currency from configSnapshot (default: USDT) with fallback chain
    const preferredQuoteCurrency = (backtest.configSnapshot?.run?.quoteCurrency as string) ?? 'USDT';
    const quoteCoin = await this.quoteCurrencyResolver.resolveQuoteCurrency(preferredQuoteCurrency);

    // Load data from full dataset range for indicator warmup
    const dataLoadStartDate = options.dataset.startAt ?? backtest.startDate;
    const dataLoadEndDate = options.dataset.endAt ?? backtest.endDate;
    // Trading boundaries: always use the backtest's configured dates
    const tradingStartDate = backtest.startDate;
    const tradingEndDate = backtest.endDate;

    let historicalPrices: OHLCCandle[];

    if (this.marketDataReader.hasStorageLocation(options.dataset)) {
      // Use CSV data from MinIO storage
      this.logger.log(`Reading market data from storage: ${options.dataset.storageLocation}`);
      const marketDataResult = await this.marketDataReader.readMarketData(
        options.dataset,
        dataLoadStartDate,
        dataLoadEndDate
      );
      historicalPrices = this.convertOHLCVToCandles(marketDataResult.data);
      this.logger.log(
        `Loaded ${historicalPrices.length} candle records from storage (${marketDataResult.dateRange.start.toISOString()} to ${marketDataResult.dateRange.end.toISOString()})`
      );
    } else {
      // Fall back to database OHLC table
      historicalPrices = await this.getHistoricalPrices(coinIds, dataLoadStartDate, dataLoadEndDate);
    }

    if (historicalPrices.length === 0) {
      throw new Error('No historical price data available for the specified date range');
    }

    const pricesByTimestamp = this.groupPricesByTimestamp(historicalPrices);
    const timestamps = Object.keys(pricesByTimestamp).sort();

    const priceCtx = this.initPriceTracking(historicalPrices, coinIds);

    // Drop reference to the full candles array — objects still live in pricesByTimestamp
    historicalPrices = [];

    // Calculate warmup vs trading boundaries
    const tradingStartIndex = timestamps.findIndex((ts) => new Date(ts) >= tradingStartDate);
    const tradingEndIdx = (() => {
      let lastIdx = timestamps.length - 1;
      while (lastIdx >= 0 && new Date(timestamps[lastIdx]) > tradingEndDate) lastIdx--;
      return lastIdx;
    })();
    const effectiveTradingStartIndex = tradingStartIndex >= 0 ? tradingStartIndex : 0;
    const effectiveTimestampCount = tradingEndIdx + 1;
    const tradingTimestampCount = effectiveTimestampCount - effectiveTradingStartIndex;

    this.logger.log(
      `Processing ${timestamps.length} time periods with ${delayMs}ms delay (warmup: ${effectiveTradingStartIndex}, trading: ${tradingTimestampCount})`
    );

    // Build slippage config from backtest configSnapshot
    const slippageSnapshot = backtest.configSnapshot?.slippage;
    const slippageConfig: SlippageConfig = slippageSnapshot
      ? {
          type: this.mapSlippageModelType(slippageSnapshot.model as string),
          fixedBps: slippageSnapshot.fixedBps ?? 5,
          baseSlippageBps: slippageSnapshot.baseBps ?? 5,
          volumeImpactFactor: slippageSnapshot.volumeImpactFactor ?? 100
        }
      : DEFAULT_SLIPPAGE_CONFIG;

    // Minimum hold period: configurable via options, default 24h
    const minHoldMs = options.minHoldMs ?? BacktestEngine.DEFAULT_MIN_HOLD_MS;

    // Signal throttle: resolve config from strategy parameters, init or restore state
    const throttleConfig = this.resolveThrottleConfig(
      backtest.configSnapshot?.parameters as Record<string, unknown> | undefined
    );
    let throttleState: ThrottleState;
    if (isResuming && options.resumeFrom?.throttleState) {
      throttleState = this.signalThrottle.deserialize(options.resumeFrom.throttleState);
    } else {
      throttleState = this.signalThrottle.createState();
    }

    // Determine starting index: either from checkpoint or from beginning
    const startIndex = isResuming && options.resumeFrom ? options.resumeFrom.lastProcessedIndex + 1 : 0;

    if (isResuming) {
      this.logger.log(
        `Resuming from index ${startIndex} of ${effectiveTimestampCount} (${((startIndex / effectiveTimestampCount) * 100).toFixed(1)}% complete)`
      );

      // Fast-forward price windows to the resume point so indicators have correct history
      if (startIndex > 0) {
        for (let j = 0; j < startIndex; j++) {
          this.advancePriceWindows(priceCtx, coins, new Date(timestamps[j]));
        }
        this.logger.log(`Fast-forwarded price windows through ${startIndex} timestamps for resume`);
      }
    }

    // Track result counts at last checkpoint for proper slicing during incremental persistence
    let lastCheckpointCounts =
      isResuming && options.resumeFrom
        ? { ...options.resumeFrom.persistedCounts }
        : { trades: 0, signals: 0, fills: 0, snapshots: 0 };

    // Track timestamp index for checkpoint interval calculation
    let lastCheckpointIndex = startIndex - 1;

    // Track consecutive algorithm failures to detect systematic issues
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 10;

    // Time-based heartbeat tracking (every ~30 seconds)
    let lastHeartbeatTime = Date.now();
    const HEARTBEAT_INTERVAL_MS = 30_000;

    // Track consecutive pause check failures for resilience
    // If pause checks fail repeatedly, force a pause as a safety measure
    const MAX_CONSECUTIVE_PAUSE_FAILURES = 3;
    let consecutivePauseFailures = 0;

    for (let i = startIndex; i < effectiveTimestampCount; i++) {
      // Check for pause request BEFORE processing this timestamp
      if (options.shouldPause) {
        try {
          const shouldPauseNow = await options.shouldPause();

          // Reset failure counter on successful check
          consecutivePauseFailures = 0;

          if (shouldPauseNow) {
            const pauseSells = this.countSells(trades);
            const checkpointState = this.buildCheckpointState(
              i - 1, // Last successfully processed index
              timestamps[Math.max(0, i - 1)],
              portfolio,
              peakValue,
              maxDrawdown,
              rng.getState(),
              totalPersistedCounts.trades + trades.length,
              totalPersistedCounts.signals + signals.length,
              totalPersistedCounts.fills + simulatedFills.length,
              totalPersistedCounts.snapshots + snapshots.length,
              metricsAcc.totalSellCount + pauseSells.sells,
              metricsAcc.totalWinningSellCount + pauseSells.winningSells,
              this.signalThrottle.serialize(throttleState)
            );

            this.logger.log(`Live replay paused at index ${i - 1}/${timestamps.length}`);

            // Call onPaused callback for state persistence
            if (options.onPaused) {
              await options.onPaused(checkpointState);
            }

            // Calculate partial final metrics using accumulators for correctness across checkpoints
            this.harvestMetrics(trades, snapshots, metricsAcc.callbacks);
            const finalMetrics = this.calculateFinalMetricsFromAccumulators(
              backtest,
              portfolio,
              metricsAcc.totalTradeCount,
              metricsAcc.totalSellCount,
              metricsAcc.totalWinningSellCount,
              metricsAcc.snapshotValues,
              maxDrawdown
            );

            return {
              trades,
              signals,
              simulatedFills,
              snapshots,
              finalMetrics,
              paused: true,
              pausedCheckpoint: checkpointState
            };
          }
        } catch (pauseError: unknown) {
          const err = toErrorInfo(pauseError);
          consecutivePauseFailures++;
          this.logger.warn(
            `Pause check failed at index ${i} (attempt ${consecutivePauseFailures}/${MAX_CONSECUTIVE_PAUSE_FAILURES}): ${err.message}`
          );

          // If pause checks fail repeatedly, force a precautionary pause
          // This ensures we don't miss a user's pause request due to transient Redis issues
          if (consecutivePauseFailures >= MAX_CONSECUTIVE_PAUSE_FAILURES) {
            this.logger.error(
              `Pause check failed ${MAX_CONSECUTIVE_PAUSE_FAILURES} times consecutively, forcing precautionary pause`
            );

            const forcedPauseSells = this.countSells(trades);
            const checkpointState = this.buildCheckpointState(
              i - 1,
              timestamps[Math.max(0, i - 1)],
              portfolio,
              peakValue,
              maxDrawdown,
              rng.getState(),
              totalPersistedCounts.trades + trades.length,
              totalPersistedCounts.signals + signals.length,
              totalPersistedCounts.fills + simulatedFills.length,
              totalPersistedCounts.snapshots + snapshots.length,
              metricsAcc.totalSellCount + forcedPauseSells.sells,
              metricsAcc.totalWinningSellCount + forcedPauseSells.winningSells,
              this.signalThrottle.serialize(throttleState)
            );

            if (options.onPaused) {
              await options.onPaused(checkpointState);
            }

            this.harvestMetrics(trades, snapshots, metricsAcc.callbacks);
            const finalMetrics = this.calculateFinalMetricsFromAccumulators(
              backtest,
              portfolio,
              metricsAcc.totalTradeCount,
              metricsAcc.totalSellCount,
              metricsAcc.totalWinningSellCount,
              metricsAcc.snapshotValues,
              maxDrawdown
            );

            return {
              trades,
              signals,
              simulatedFills,
              snapshots,
              finalMetrics,
              paused: true,
              pausedCheckpoint: checkpointState
            };
          }
        }
      }

      const timestamp = new Date(timestamps[i]);
      const currentPrices = pricesByTimestamp[timestamps[i]];
      const isWarmup = i < effectiveTradingStartIndex;

      const marketData: MarketData = {
        timestamp,
        prices: new Map(currentPrices.map((price) => [price.coinId, this.getPriceValue(price)]))
      };

      // Always update portfolio values and advance price windows (needed for indicator warmup)
      portfolio = this.portfolioState.updateValues(portfolio, marketData.prices);

      const priceData = this.advancePriceWindows(priceCtx, coins, timestamp);

      // During warmup: run algorithm to prime internal state but skip trading/recording
      if (isWarmup) {
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
            backtestId: backtest.id,
            isLiveReplay: true,
            replaySpeed: replaySpeed
          }
        };
        try {
          await this.executeAlgorithmWithTimeout(
            backtest.algorithm.id,
            context,
            `warmup ${i}/${effectiveTradingStartIndex} (${timestamp.toISOString()})`
          );
        } catch {
          // Warmup failures are non-fatal
        }
        continue;
      }

      // Apply pacing delay (except for the first trading timestamp and MAX_SPEED)
      if (delayMs > 0 && i > Math.max(startIndex, effectiveTradingStartIndex)) {
        await this.delay(delayMs);
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
          backtestId: backtest.id,
          isLiveReplay: true,
          replaySpeed: replaySpeed
        }
      };

      let strategySignals: TradingSignal[] = [];
      try {
        const result = await this.executeAlgorithmWithTimeout(
          backtest.algorithm.id,
          context,
          `iteration ${i}/${effectiveTimestampCount} (${timestamp.toISOString()})`
        );

        if (result.success && result.signals?.length) {
          strategySignals = result.signals.map(mapStrategySignal).filter((signal) => signal.action !== 'HOLD');
        }
        consecutiveErrors = 0;
      } catch (error: unknown) {
        if (error instanceof AlgorithmNotRegisteredException) {
          throw error;
        }
        const err = toErrorInfo(error);
        consecutiveErrors++;
        this.logger.warn(
          `Algorithm execution failed at ${timestamp.toISOString()} ` +
            `(${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${err.message}`
        );
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          throw new Error(`Algorithm failed ${MAX_CONSECUTIVE_ERRORS} consecutive times. Last error: ${err.message}`);
        }
      }

      // Apply signal throttle: cooldowns, daily cap, min sell %
      strategySignals = this.signalThrottle.filterSignals(
        strategySignals,
        throttleState,
        throttleConfig,
        timestamp.getTime()
      );

      for (const strategySignal of strategySignals) {
        const signalRecord: Partial<BacktestSignal> = {
          timestamp,
          signalType: classifySignalType(strategySignal),
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

        // Extract volume from current candle for volume-based slippage calculation
        const dailyVolume = this.extractDailyVolume(currentPrices, strategySignal.coinId);

        const tradeResult = await this.executeTrade(
          strategySignal,
          portfolio,
          marketData,
          backtest.tradingFee,
          rng,
          slippageConfig,
          dailyVolume,
          minHoldMs
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

      const tradingRelativeIdx = i - effectiveTradingStartIndex;
      if (tradingRelativeIdx % 24 === 0 || i === effectiveTimestampCount - 1) {
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
            timestamp: timestamp.toISOString(),
            isLiveReplay: 1,
            replaySpeed: ReplaySpeed[replaySpeed]
          });
        }
      }

      // Lightweight heartbeat for stale detection (every ~30 seconds)
      // Report progress relative to trading period
      if (options.onHeartbeat && Date.now() - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
        await options.onHeartbeat(tradingRelativeIdx, tradingTimestampCount);
        lastHeartbeatTime = Date.now();
      }

      // Checkpoint callback: save state periodically for resume capability
      // Live replay uses more frequent checkpoints (default: 100 vs 500 for historical)
      const timeSinceLastCheckpoint = i - lastCheckpointIndex;
      if (options.onCheckpoint && timeSinceLastCheckpoint >= checkpointInterval) {
        const currentSells = this.countSells(trades);
        const checkpointState = this.buildCheckpointState(
          i,
          timestamp.toISOString(),
          portfolio,
          peakValue,
          maxDrawdown,
          rng.getState(),
          totalPersistedCounts.trades + trades.length,
          totalPersistedCounts.signals + signals.length,
          totalPersistedCounts.fills + simulatedFills.length,
          totalPersistedCounts.snapshots + snapshots.length,
          metricsAcc.totalSellCount + currentSells.sells,
          metricsAcc.totalWinningSellCount + currentSells.winningSells,
          this.signalThrottle.serialize(throttleState)
        );

        // Results accumulated since last checkpoint - use counts from last checkpoint for proper slicing
        const checkpointResults: CheckpointResults = {
          trades: trades.slice(lastCheckpointCounts.trades),
          signals: signals.slice(lastCheckpointCounts.signals),
          simulatedFills: simulatedFills.slice(lastCheckpointCounts.fills),
          snapshots: snapshots.slice(lastCheckpointCounts.snapshots)
        };

        // Pass trading timestamp count to callback for accurate progress reporting
        await options.onCheckpoint(checkpointState, checkpointResults, tradingTimestampCount);

        // Harvest metrics from current arrays into accumulators before clearing
        this.harvestMetrics(trades, snapshots, metricsAcc.callbacks);

        // Update cumulative persisted counts and clear arrays to free memory
        totalPersistedCounts.trades += trades.length;
        totalPersistedCounts.signals += signals.length;
        totalPersistedCounts.fills += simulatedFills.length;
        totalPersistedCounts.snapshots += snapshots.length;
        trades.length = 0;
        signals.length = 0;
        simulatedFills.length = 0;
        snapshots.length = 0;
        lastCheckpointCounts = { trades: 0, signals: 0, fills: 0, snapshots: 0 };
        lastCheckpointIndex = i;

        this.logger.debug(
          `Live replay checkpoint saved at index ${i}/${effectiveTimestampCount} (${((tradingRelativeIdx / tradingTimestampCount) * 100).toFixed(1)}%)`
        );
      }
    }

    // Release large data structures — no longer needed after the main loop.
    this.clearPriceData(pricesByTimestamp, priceCtx);

    // Harvest remaining items from final (post-last-checkpoint) arrays
    this.harvestMetrics(trades, snapshots, metricsAcc.callbacks);

    const finalMetrics = this.calculateFinalMetricsFromAccumulators(
      backtest,
      portfolio,
      metricsAcc.totalTradeCount,
      metricsAcc.totalSellCount,
      metricsAcc.totalWinningSellCount,
      metricsAcc.snapshotValues,
      maxDrawdown
    );

    if (options.telemetryEnabled) {
      await this.backtestStream.publishMetric(
        backtest.id,
        'final_value',
        finalMetrics.finalValue ?? portfolio.totalValue,
        'USD',
        { isLiveReplay: 1 }
      );
      await this.backtestStream.publishMetric(backtest.id, 'total_return', finalMetrics.totalReturn ?? 0, 'pct', {
        isLiveReplay: 1
      });
      await this.backtestStream.publishStatus(backtest.id, 'completed', undefined, { isLiveReplay: true });
    }

    this.logger.log(
      `Live replay backtest completed: ${metricsAcc.totalTradeCount} trades, final value: $${portfolio.totalValue.toFixed(2)}`
    );

    return { trades, signals, simulatedFills, snapshots, finalMetrics, paused: false };
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
   * Execute an algorithm with a timeout guard.
   * Rejects if the algorithm does not resolve within ALGORITHM_TIMEOUT_MS.
   */
  private async executeAlgorithmWithTimeout(
    algorithmId: string,
    context: AlgorithmContext,
    iterationLabel: string
  ): Promise<AlgorithmResult> {
    const algoPromise = this.algorithmRegistry.executeAlgorithm(algorithmId, context);
    let algoTimeoutId: NodeJS.Timeout | undefined;
    const algoTimeoutPromise = new Promise<never>((_, reject) => {
      algoTimeoutId = setTimeout(
        () =>
          reject(
            new Error(
              `Algorithm execution timed out after ${BacktestEngine.ALGORITHM_TIMEOUT_MS}ms at ${iterationLabel}`
            )
          ),
        BacktestEngine.ALGORITHM_TIMEOUT_MS
      );
    });

    try {
      return await Promise.race([algoPromise, algoTimeoutPromise]);
    } finally {
      clearTimeout(algoTimeoutId);
    }
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
  private buildPriceSummary(candle: OHLCCandle): PriceSummary {
    return {
      avg: candle.close,
      coin: candle.coinId,
      date: candle.timestamp,
      high: candle.high,
      low: candle.low
    };
  }

  /**
   * Initialize price tracking state for a set of coins.
   * Filters historical prices by coinId, sorts by timestamp, pre-computes summaries,
   * and initializes sliding-window pointers.
   */
  private initPriceTracking(historicalPrices: OHLCCandle[], coinIds: string[]): PriceTrackingContext {
    const timestampsByCoin = new Map<string, Date[]>();
    const summariesByCoin = new Map<string, PriceSummary[]>();
    const indexByCoin = new Map<string, number>();
    const windowsByCoin = new Map<string, PriceSummary[]>();

    // Single-pass grouping: O(prices) instead of O(coins × prices)
    const pricesByCoin = new Map<string, OHLCCandle[]>();
    for (const candle of historicalPrices) {
      let group = pricesByCoin.get(candle.coinId);
      if (!group) {
        group = [];
        pricesByCoin.set(candle.coinId, group);
      }
      group.push(candle);
    }

    for (const coinId of coinIds) {
      const history = (pricesByCoin.get(coinId) ?? []).sort(
        (a, b) => this.getPriceTimestamp(a).getTime() - this.getPriceTimestamp(b).getTime()
      );
      // Store only timestamps (not full candles) to reduce memory footprint
      timestampsByCoin.set(
        coinId,
        history.map((price) => this.getPriceTimestamp(price))
      );
      summariesByCoin.set(
        coinId,
        history.map((price) => this.buildPriceSummary(price))
      );
      indexByCoin.set(coinId, -1);
      windowsByCoin.set(coinId, []);
    }

    return { timestampsByCoin, summariesByCoin, indexByCoin, windowsByCoin };
  }

  /**
   * Advance per-coin price windows up to and including the given timestamp.
   *
   * **Important:** The returned `PriceSummary[]` arrays are shared mutable references
   * held by `PriceTrackingContext`. Callers (including strategies) must treat them as
   * read-only. Mutating the arrays would corrupt the sliding-window state for
   * subsequent iterations.
   */
  private advancePriceWindows(ctx: PriceTrackingContext, coins: Coin[], timestamp: Date): PriceSummaryByPeriod {
    const priceData: PriceSummaryByPeriod = {};
    for (const coin of coins) {
      const coinTimestamps = ctx.timestampsByCoin.get(coin.id) ?? [];
      const summaries = ctx.summariesByCoin.get(coin.id) ?? [];
      const window = ctx.windowsByCoin.get(coin.id) ?? [];
      let pointer = ctx.indexByCoin.get(coin.id) ?? -1;
      while (pointer + 1 < coinTimestamps.length && coinTimestamps[pointer + 1] <= timestamp) {
        pointer += 1;
        window.push(summaries[pointer]);
      }
      // Trim window to sliding-window size to bound memory growth
      if (window.length > BacktestEngine.MAX_WINDOW_SIZE) {
        const excess = window.length - BacktestEngine.MAX_WINDOW_SIZE;
        window.splice(0, excess);
      }
      ctx.indexByCoin.set(coin.id, pointer);
      if (window.length > 0) {
        priceData[coin.id] = window;
      }
    }
    return priceData;
  }

  /**
   * Clear all price data structures in-place to allow GC to reclaim memory.
   * Called after the main processing loop when these structures are no longer needed.
   */
  private clearPriceData(pricesByTimestamp: Record<string, OHLCCandle[]>, priceCtx: PriceTrackingContext): void {
    for (const key of Object.keys(pricesByTimestamp)) {
      delete pricesByTimestamp[key];
    }
    priceCtx.timestampsByCoin.clear();
    priceCtx.summariesByCoin.clear();
    priceCtx.windowsByCoin.clear();
    priceCtx.indexByCoin.clear();
  }

  /**
   * Extract daily volume from OHLC candles for a specific coin
   */
  private extractDailyVolume(currentPrices: OHLCCandle[], coinId: string): number | undefined {
    return currentPrices.find((c) => c.coinId === coinId)?.volume;
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

  private async executeTrade(
    signal: TradingSignal,
    portfolio: Portfolio,
    marketData: MarketData,
    tradingFee: number,
    rng: SeededRandom,
    slippageConfig: SlippageConfig = DEFAULT_SLIPPAGE_CONFIG,
    dailyVolume?: number,
    minHoldMs: number = BacktestEngine.DEFAULT_MIN_HOLD_MS
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

    // Calculate slippage based on estimated order size and market volume
    let estimatedQuantity: number;
    if (signal.quantity) {
      estimatedQuantity = signal.quantity;
    } else if (isBuy) {
      // For BUY: estimate based on typical portfolio allocation (10%)
      estimatedQuantity = (portfolio.totalValue * 0.1) / basePrice;
    } else {
      // For SELL: estimate based on existing position (50% as reasonable middle-ground)
      const existingPosition = portfolio.positions.get(signal.coinId);
      estimatedQuantity = (existingPosition?.quantity ?? 0) * 0.5;
    }

    // Use shared SlippageService for consistent slippage calculation
    const slippageResult = this.slippageService.calculateSlippage(
      {
        price: basePrice,
        quantity: estimatedQuantity,
        isBuy,
        dailyVolume
      },
      slippageConfig
    );
    const slippageBps = slippageResult.slippageBps;
    const price = slippageResult.executionPrice;

    if (isBuy) {
      // Position sizing priority: quantity > percentage > confidence > random
      if (signal.quantity) {
        // Use explicit quantity if provided
        quantity = signal.quantity;
      } else if (signal.percentage) {
        // Use percentage (from signal.strength) if provided
        const investmentAmount = portfolio.totalValue * signal.percentage;
        quantity = investmentAmount / price;
      } else if (signal.confidence !== undefined) {
        // Use confidence-based sizing: higher confidence = larger position (scaled between min and max allocation)
        const confidenceBasedAllocation =
          BacktestEngine.MIN_ALLOCATION +
          signal.confidence * (BacktestEngine.MAX_ALLOCATION - BacktestEngine.MIN_ALLOCATION);
        const investmentAmount = portfolio.totalValue * confidenceBasedAllocation;
        quantity = investmentAmount / price;
      } else {
        // Fallback to random allocation (5-20% of portfolio)
        const investmentAmount =
          portfolio.totalValue *
          Math.min(BacktestEngine.MAX_ALLOCATION, Math.max(BacktestEngine.MIN_ALLOCATION, rng.next()));
        quantity = investmentAmount / price;
      }

      totalValue = quantity * price;
      const estimatedFeeResult = this.feeCalculator.calculateFee(
        { tradeValue: totalValue },
        this.feeCalculator.fromFlatRate(tradingFee)
      );

      if (portfolio.cashBalance < totalValue + estimatedFeeResult.fee) {
        this.logger.warn('Insufficient cash balance for BUY trade (including fees)');
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

      // Track entry date: set on new position, preserve on add-to (first-in basis)
      if (!existingPosition.entryDate) {
        existingPosition.entryDate = marketData.timestamp;
      }

      portfolio.positions.set(signal.coinId, existingPosition);
    }

    // Variables to track P&L for SELL trades
    let realizedPnL: number | undefined;
    let realizedPnLPercent: number | undefined;
    let costBasis: number | undefined;

    // Track hold time for SELL trades (used by monitoring dashboard)
    let holdTimeMs: number | undefined;

    if (signal.action === 'SELL') {
      const existingPosition = portfolio.positions.get(signal.coinId);
      if (!existingPosition || existingPosition.quantity === 0) {
        return null;
      }

      // Calculate hold time from entry date
      if (existingPosition.entryDate) {
        holdTimeMs = marketData.timestamp.getTime() - existingPosition.entryDate.getTime();
      }

      // Enforce minimum hold period to prevent premature exits
      // Risk control signals (STOP_LOSS, TAKE_PROFIT) bypass this check
      const isRiskControl =
        signal.originalType === AlgoSignalType.STOP_LOSS || signal.originalType === AlgoSignalType.TAKE_PROFIT;
      if (!isRiskControl && minHoldMs > 0 && holdTimeMs !== undefined && holdTimeMs < minHoldMs) {
        return null;
      }

      // Capture cost basis BEFORE modifying position
      costBasis = existingPosition.averagePrice;

      // Position sizing priority: quantity > percentage > confidence > random
      if (signal.quantity) {
        // Use explicit quantity if provided
        quantity = signal.quantity;
      } else if (signal.percentage) {
        // Use percentage (from signal.strength) to determine portion to sell
        quantity = existingPosition.quantity * Math.min(1, signal.percentage);
      } else if (signal.confidence !== undefined) {
        // Use confidence-based sizing: higher confidence = sell more (25% to 100% of position)
        const confidenceBasedPercent = 0.25 + signal.confidence * 0.75;
        quantity = existingPosition.quantity * confidenceBasedPercent;
      } else {
        // Fallback to random exit size (25-100% of position)
        quantity = existingPosition.quantity * Math.min(1, Math.max(0.25, rng.next()));
      }
      quantity = Math.min(quantity, existingPosition.quantity);
      totalValue = quantity * price;

      // Calculate realized P&L: (sell price - cost basis) * quantity
      // Note: This is gross P&L before fees. Fee is deducted from cashBalance separately.
      realizedPnL = (price - costBasis) * quantity;
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

    // Use shared FeeCalculatorService for consistent fee calculation
    const feeConfig = this.feeCalculator.fromFlatRate(tradingFee);
    const feeResult = this.feeCalculator.calculateFee({ tradeValue: totalValue }, feeConfig);
    const fee = feeResult.fee;
    portfolio.cashBalance -= fee;
    portfolio.totalValue =
      portfolio.cashBalance + this.portfolioState.calculatePositionsValue(portfolio.positions, marketData.prices);

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
          slippageBps, // Simulated slippage applied
          ...(holdTimeMs !== undefined && { holdTimeMs })
        }
      } as Partial<BacktestTrade>,
      slippageBps
    };
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

  /**
   * Extract lightweight metrics from trade/snapshot arrays into accumulators.
   * Called before clearing arrays after checkpoint persistence.
   */
  private harvestMetrics(
    trades: Partial<BacktestTrade>[],
    snapshots: Partial<BacktestPerformanceSnapshot>[],
    acc: {
      addTradeCount: (n: number) => void;
      addSellCount: (n: number) => void;
      addWinningSellCount: (n: number) => void;
      addSnapshotValues: (vals: number[]) => void;
    }
  ): void {
    acc.addTradeCount(trades.length);
    const sells = trades.filter((t) => t.type === TradeType.SELL);
    acc.addSellCount(sells.length);
    acc.addWinningSellCount(sells.filter((t) => (t.realizedPnL ?? 0) > 0).length);
    acc.addSnapshotValues(snapshots.map((s) => s.portfolioValue ?? 0));
  }

  private createMetricsAccumulator(
    initialTradeCount = 0,
    initialSellCount = 0,
    initialWinningSellCount = 0
  ): MetricsAccumulator {
    const acc: MetricsAccumulator = {
      totalTradeCount: initialTradeCount,
      totalSellCount: initialSellCount,
      totalWinningSellCount: initialWinningSellCount,
      snapshotValues: [],
      callbacks: {} as MetricsAccumulator['callbacks']
    };
    acc.callbacks = {
      addTradeCount: (n) => {
        acc.totalTradeCount += n;
      },
      addSellCount: (n) => {
        acc.totalSellCount += n;
      },
      addWinningSellCount: (n) => {
        acc.totalWinningSellCount += n;
      },
      addSnapshotValues: (vals) => {
        acc.snapshotValues.push(...vals);
      }
    };
    return acc;
  }

  /**
   * Compute final metrics from lightweight accumulators instead of full arrays.
   * Used after arrays have been cleared across checkpoints to avoid holding all
   * trade/snapshot objects in memory for the entire run.
   */
  private calculateFinalMetricsFromAccumulators(
    backtest: Backtest,
    portfolio: Portfolio,
    totalTradeCount: number,
    totalSellCount: number,
    totalWinningSellCount: number,
    snapshotValues: number[],
    maxDrawdown: number
  ): BacktestFinalMetrics {
    const finalValue = portfolio.totalValue;
    const totalReturn = (finalValue - backtest.initialCapital) / backtest.initialCapital;

    const durationDays = dayjs(backtest.endDate).diff(dayjs(backtest.startDate), 'day');
    const annualizedReturn = durationDays > 0 ? Math.pow(1 + totalReturn, 365 / durationDays) - 1 : totalReturn;

    // Calculate Sharpe ratio from lightweight portfolio value array
    const returns: number[] = [];
    for (let i = 1; i < snapshotValues.length; i++) {
      const previous = snapshotValues[i - 1] ?? backtest.initialCapital;
      const current = snapshotValues[i] ?? backtest.initialCapital;
      returns.push(previous === 0 ? 0 : (current - previous) / previous);
    }

    const sharpeRatio =
      returns.length > 0
        ? this.metricsCalculator.calculateSharpeRatio(returns, {
            timeframe: TimeframeType.DAILY,
            useCryptoCalendar: false,
            riskFreeRate: 0.02
          })
        : 0;

    return {
      finalValue,
      totalReturn,
      annualizedReturn,
      sharpeRatio,
      maxDrawdown,
      totalTrades: totalTradeCount,
      winningTrades: totalWinningSellCount,
      winRate: totalSellCount > 0 ? totalWinningSellCount / totalSellCount : 0
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
    rngState: number,
    throttleStateJson?: string
  ): string {
    return JSON.stringify({
      lastProcessedIndex,
      lastProcessedTimestamp,
      cashBalance,
      positionCount,
      peakValue,
      maxDrawdown,
      rngState,
      ...(throttleStateJson !== undefined && { throttleState: throttleStateJson })
    });
  }

  /**
   * Count sell trades and winning sells in an array of trades.
   * Used to persist cumulative sell counts at checkpoint time.
   */
  private countSells(trades: Partial<BacktestTrade>[]): { sells: number; winningSells: number } {
    let sells = 0,
      winningSells = 0;
    for (const t of trades) {
      if (t.type === TradeType.SELL) {
        sells++;
        if ((t.realizedPnL ?? 0) > 0) winningSells++;
      }
    }
    return { sells, winningSells };
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
    snapshotsCount: number,
    sellsCount: number,
    winningSellsCount: number,
    serializedThrottleState?: SerializableThrottleState
  ): BacktestCheckpointState {
    // Convert Map-based positions to array format for JSON serialization
    const checkpointPortfolio: CheckpointPortfolio = {
      cashBalance: portfolio.cashBalance,
      positions: Array.from(portfolio.positions.entries()).map(([coinId, pos]) => ({
        coinId,
        quantity: pos.quantity,
        averagePrice: pos.averagePrice,
        ...(pos.entryDate && { entryDate: pos.entryDate.toISOString() })
      }))
    };

    // Serialize throttle state to JSON for checksum inclusion (before computing checksum)
    const throttleStateJson = serializedThrottleState ? JSON.stringify(serializedThrottleState) : undefined;

    // Build checksum for data integrity verification using centralized helper
    const checksumData = this.buildChecksumData(
      lastProcessedIndex,
      lastProcessedTimestamp,
      portfolio.cashBalance,
      portfolio.positions.size,
      peakValue,
      maxDrawdown,
      rngState,
      throttleStateJson
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
        snapshots: snapshotsCount,
        sells: sellsCount,
        winningSells: winningSellsCount
      },
      checksum,
      ...(serializedThrottleState && { throttleState: serializedThrottleState })
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
    const throttleStateJson = checkpoint.throttleState ? JSON.stringify(checkpoint.throttleState) : undefined;
    const checksumData = this.buildChecksumData(
      checkpoint.lastProcessedIndex,
      checkpoint.lastProcessedTimestamp,
      checkpoint.portfolio.cashBalance,
      checkpoint.portfolio.positions.length,
      checkpoint.peakValue,
      checkpoint.maxDrawdown,
      checkpoint.rngState,
      throttleStateJson
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
    let historicalPrices = await this.getHistoricalPrices(coinIds, config.startDate, config.endDate);

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

    const priceCtx = this.initPriceTracking(historicalPrices, coinIds);

    // Drop reference to the full candles array — objects still live in pricesByTimestamp
    historicalPrices = [];

    let peakValue = initialCapital;
    let maxDrawdown = 0;

    // Signal throttle: resolve config from optimization parameters
    const throttleConfig = this.resolveThrottleConfig(config.parameters);
    const throttleState = this.signalThrottle.createState();

    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = new Date(timestamps[i]);
      const currentPrices = pricesByTimestamp[timestamps[i]];

      const marketData: MarketData = {
        timestamp,
        prices: new Map(currentPrices.map((price) => [price.coinId, this.getPriceValue(price)]))
      };

      portfolio = this.portfolioState.updateValues(portfolio, marketData.prices);

      const priceData = this.advancePriceWindows(priceCtx, coins, timestamp);

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
      } catch (error: unknown) {
        if (error instanceof AlgorithmNotRegisteredException) {
          throw error;
        }
        // Log but continue - optimization should be resilient to occasional failures
        const err = toErrorInfo(error);
        this.logger.warn(`Algorithm execution failed at ${timestamp.toISOString()}: ${err.message}`);
      }

      // Apply signal throttle: cooldowns, daily cap, min sell %
      strategySignals = this.signalThrottle.filterSignals(
        strategySignals,
        throttleState,
        throttleConfig,
        timestamp.getTime()
      );

      for (const strategySignal of strategySignals) {
        // Extract volume from current candle for volume-based slippage calculation
        const dailyVolume = this.extractDailyVolume(currentPrices, strategySignal.coinId);

        const tradeResult = await this.executeTrade(
          strategySignal,
          portfolio,
          marketData,
          tradingFee,
          rng,
          DEFAULT_SLIPPAGE_CONFIG,
          dailyVolume,
          BacktestEngine.DEFAULT_MIN_HOLD_MS
        );
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

    // Release large data structures after the main loop
    this.clearPriceData(pricesByTimestamp, priceCtx);

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

    // Calculate downside deviation for Sortino ratio
    // Uses same formula as SharpeRatioCalculator.calculateSortino for consistency
    const periodRiskFreeRate = 0.02 / 252; // 2% annual rate / 252 trading days
    const downsideReturns = returns.filter((r) => r < periodRiskFreeRate);
    const downsideVariance =
      returns.length > 0
        ? downsideReturns.reduce((sum, r) => sum + Math.pow(r - periodRiskFreeRate, 2), 0) / returns.length
        : 0;
    const downsideDeviation = Math.sqrt(downsideVariance) * Math.sqrt(252); // Annualized

    // Calculate Sharpe ratio using metricsCalculator for consistency
    const sharpeRatio = this.metricsCalculator.calculateSharpeRatio(returns, {
      timeframe: TimeframeType.DAILY,
      useCryptoCalendar: false,
      riskFreeRate: 0.02
    });

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
