import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import * as dayjs from 'dayjs';

import { createHash } from 'crypto';

import {
  CompositeRegimeType,
  DEFAULT_VOLATILITY_CONFIG,
  determineVolatilityRegime,
  getAllocationLimits,
  MAINTENANCE_MARGIN_RATE,
  MarketRegimeType,
  MAX_LEVERAGE_CAP,
  PipelineStage
} from '@chansey/api-interfaces';

import { AlgorithmWatchdog } from './algorithm-watchdog';
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
import { IncrementalSma } from './incremental-sma';
import { MarketDataReaderService, OHLCVData } from './market-data-reader.service';
import { MarketDataSet } from './market-data-set.entity';
import { QuoteCurrencyResolverService } from './quote-currency-resolver.service';
import { RingBuffer } from './ring-buffer';
import { SeededRandom } from './seeded-random';
import {
  BacktestExitTracker,
  DEFAULT_BACKTEST_EXIT_CONFIG,
  DEFAULT_SLIPPAGE_CONFIG,
  FeeCalculatorService,
  MetricsCalculatorService,
  Portfolio,
  PortfolioStateService,
  PositionManagerService,
  SerializableThrottleState,
  SignalFilterChainService,
  SignalThrottleService,
  SlippageConfig,
  SlippageModelType,
  SlippageService,
  ThrottleState,
  TimeframeType
} from './shared';

import {
  ATRCalculator,
  BollingerBandsCalculator,
  EMACalculator,
  MACDCalculator,
  RSICalculator,
  SMACalculator
} from '../../algorithm/indicators/calculators';
import { SignalType as AlgoSignalType, TradingSignal as StrategySignal } from '../../algorithm/interfaces';
import { AlgorithmRegistry } from '../../algorithm/registry/algorithm-registry.service';
import { Coin } from '../../coin/coin.entity';
import { AlgorithmNotRegisteredException } from '../../common/exceptions';
import { DEFAULT_QUOTE_CURRENCY } from '../../exchange/constants';
import { RegimeGateService } from '../../market-regime/regime-gate.service';
import { VolatilityCalculator } from '../../market-regime/volatility.calculator';
import { OHLCCandle, PriceSummary, PriceSummaryByPeriod } from '../../ohlc/ohlc-candle.entity';
import { OHLCService } from '../../ohlc/ohlc.service';
import { toErrorInfo } from '../../shared/error.util';
import { ExitConfig } from '../interfaces/exit-config.interface';
import {
  DEFAULT_OPPORTUNITY_SELLING_CONFIG,
  OpportunitySellingUserConfig
} from '../interfaces/opportunity-selling.interface';
import { PositionAnalysisService } from '../services/position-analysis.service';

export interface MarketData {
  timestamp: Date;
  prices: Map<string, number>; // coinId -> price
}

// Re-export Position and Portfolio from shared module for backwards compatibility
export { Portfolio, Position } from './shared';

export interface TradingSignal {
  action: 'BUY' | 'SELL' | 'HOLD' | 'OPEN_SHORT' | 'CLOSE_SHORT';
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

  /** Enable opportunity-based selling for this backtest run (default: false) */
  enableOpportunitySelling?: boolean;
  /** Opportunity selling configuration (uses DEFAULT_OPPORTUNITY_SELLING_CONFIG if not provided) */
  opportunitySellingConfig?: OpportunitySellingUserConfig;

  /** Maximum allocation per trade as fraction of portfolio (0-1). Overrides stage/risk defaults. */
  maxAllocation?: number;
  /** Minimum allocation per trade as fraction of portfolio (0-1). Overrides stage/risk defaults. */
  minAllocation?: number;

  /** Pipeline stage for allocation limit lookup (default: HISTORICAL) */
  pipelineStage?: PipelineStage;

  /** Enable mandatory hard stop-loss for all positions (default: true) */
  enableHardStopLoss?: boolean;
  /** Hard stop-loss threshold as a fraction (0-1). Default: 0.05 (5% loss triggers exit) */
  hardStopLossPercent?: number;

  /** Exit configuration for SL/TP/trailing stop simulation (overrides legacy hard stop-loss when provided) */
  exitConfig?: ExitConfig;

  /** Enable composite regime gate filtering (default: true).
   *  When enabled, BUY signals are blocked when BTC is below its 200-day SMA. */
  enableRegimeGate?: boolean;

  /** Enable regime-scaled position sizing (default: true to match live trading) */
  enableRegimeScaledSizing?: boolean;
  /** User risk level for regime multiplier lookup (1-5). Default: 3 */
  riskLevel?: number;

  // Checkpoint options for resume capability
  /** Number of timestamps between checkpoints (default: 500) */
  checkpointInterval?: number;
  /** Callback invoked at each checkpoint with current state and total timestamp count */
  onCheckpoint?: (state: BacktestCheckpointState, results: CheckpointResults, totalTimestamps: number) => Promise<void>;
  /** Lightweight callback for progress updates (called at most every ~30 seconds) */
  onHeartbeat?: (index: number, totalTimestamps: number) => Promise<void>;
  /** Checkpoint state to resume from (if resuming a previous run) */
  resumeFrom?: BacktestCheckpointState;

  /** Market type: 'spot' (default) or 'futures' */
  marketType?: string;
  /** Leverage multiplier for futures trading (default: 1) */
  leverage?: number;
}

interface MetricsAccumulator {
  totalTradeCount: number;
  totalSellCount: number;
  totalWinningSellCount: number;
  grossProfit: number;
  grossLoss: number;
  skippedBuyCount: number;
  /** Portfolio values collected across all checkpoints for Sharpe calculation.
   *  Not cleared at checkpoints (Sharpe needs the full series).
   *  Bounded: 8 bytes/entry — ~14KB for 5yr daily, ~4MB for 1yr minute-level. */
  snapshotValues: number[];
  callbacks: {
    addTradeCount: (n: number) => void;
    addSellCount: (n: number) => void;
    addWinningSellCount: (n: number) => void;
    addSnapshotValues: (vals: number[]) => void;
    addGrossProfit: (n: number) => void;
    addGrossLoss: (n: number) => void;
  };
}

interface ResolveExitTrackerOptions {
  exitConfig?: ExitConfig;
  enableHardStopLoss?: boolean;
  hardStopLossPercent?: number;
  resumeExitTrackerState?: import('./shared/exits/backtest-exit-tracker').SerializableExitTrackerState;
}

interface ProcessExitSignalsOptions {
  exitTracker: BacktestExitTracker;
  currentPrices: OHLCCandle[];
  marketData: MarketData;
  portfolio: Portfolio;
  tradingFee: number;
  rng: SeededRandom;
  timestamp: Date;
  trades: Partial<BacktestTrade>[];
  slippageConfig?: SlippageConfig;
  maxAllocation?: number;
  minAllocation?: number;
  // Full-fidelity fields (omit for lightweight optimization mode)
  signals?: Partial<BacktestSignal>[];
  simulatedFills?: Partial<SimulatedOrderFill>[];
  backtest?: Backtest;
  coinMap?: Map<string, Coin>;
  quoteCoin?: Coin;
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
    case AlgoSignalType.SHORT_ENTRY:
      action = 'OPEN_SHORT';
      break;
    case AlgoSignalType.SHORT_EXIT:
      action = 'CLOSE_SHORT';
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
  if (signal.action === 'BUY' || signal.action === 'OPEN_SHORT') return SignalType.ENTRY;
  if (signal.action === 'SELL' || signal.action === 'CLOSE_SHORT') return SignalType.EXIT;
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
  /** Hard stop-loss threshold as a fraction (0-1). Default: 0.05 (5%) */
  hardStopLossPercent?: number;
  /** Maximum allocation per trade as fraction of portfolio (0-1). Overrides stage/risk defaults. */
  maxAllocation?: number;
  /** Minimum allocation per trade as fraction of portfolio (0-1). Overrides stage/risk defaults. */
  minAllocation?: number;
  /** User risk level (1-5) for allocation limit lookup. Default: 3 */
  riskLevel?: number;
  /** Optional slippage config. Defaults to DEFAULT_SLIPPAGE_CONFIG (fixed 5 bps). */
  slippage?: SlippageConfig;
  /** Exit configuration for SL/TP/trailing stop simulation (overrides legacy hard stop-loss) */
  exitConfig?: ExitConfig;
  /** Enable composite regime gate filtering. Default: derived from riskLevel (ON for risk ≤ 2, OFF for risk ≥ 3). */
  enableRegimeGate?: boolean;
  /** Enable regime-scaled position sizing (default: true) */
  enableRegimeScaledSizing?: boolean;
  /** Market type: 'spot' (default) or 'futures' */
  marketType?: string;
  /** Leverage multiplier for futures trading (default: 1) */
  leverage?: number;
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
  windowsByCoin: Map<string, RingBuffer<PriceSummary>>;
  /** O(1) incremental SMA for BTC regime detection (initialized when btcCoin is present). */
  btcRegimeSma?: IncrementalSma;
  /** Coin ID used for BTC regime detection. */
  btcCoinId?: string;
}

/**
 * Cacheable (immutable) portion of PriceTrackingContext.
 * Safe to share across multiple optimization combo runs hitting the same date window.
 */
export interface ImmutablePriceTrackingData {
  timestampsByCoin: Map<string, Date[]>;
  summariesByCoin: Map<string, PriceSummary[]>;
}

/**
 * Pre-computed data for a single optimization window (date range).
 * Built once per unique date range, reused across all parameter combinations.
 */
export interface PrecomputedWindowData {
  pricesByTimestamp: Record<string, OHLCCandle[]>;
  timestamps: string[];
  immutablePriceData: ImmutablePriceTrackingData;
  volumeMap: Map<string, number>;
  filteredCandles: OHLCCandle[];
  /** Index in timestamps[] where actual trading begins (after warm-up period).
   *  Indicators are computed on the full range including warm-up, but trades
   *  are only executed at and after this index. Defaults to 0 (no warm-up). */
  tradingStartIndex: number;
}

interface CompositeRegimeResult {
  compositeRegime: CompositeRegimeType;
  volatilityRegime: MarketRegimeType;
}

@Injectable()
export class BacktestEngine {
  private readonly logger = new Logger(BacktestEngine.name);

  /** Default minimum hold period before allowing SELL (24 hours in ms) */
  private static readonly DEFAULT_MIN_HOLD_MS = 24 * 60 * 60 * 1000;
  /** Maximum price history entries kept per coin in the sliding window.
   *  Strategies typically need at most ~200 periods; 500 provides ample margin. */
  private static readonly MAX_WINDOW_SIZE = 500;
  /** Wall-clock algorithm stall timeout (ms) — checked only on error.
   *  Must accommodate concurrent workers (default 4) sharing the event loop;
   *  heavy strategies like Triple EMA take ~9s solo → ~35s under contention,
   *  so 180s allows several retries before giving up. */
  private static readonly ALGORITHM_STALL_TIMEOUT_MS = 180_000;
  /** Per-call timeout for algorithm execution — prevents indefinite blocking.
   *  With 4 concurrent backtest workers, CPU-bound iterations that take ~9s
   *  solo can spike to 35s+ under contention; 60s gives safe headroom. */
  private static readonly ALGORITHM_CALL_TIMEOUT_MS = 60_000;
  /** BTC SMA period for regime detection */
  private static readonly REGIME_SMA_PERIOD = 200;

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
    private readonly positionAnalysis: PositionAnalysisService,
    private readonly signalThrottle: SignalThrottleService,
    private readonly regimeGateService: RegimeGateService,
    private readonly volatilityCalculator: VolatilityCalculator,
    private readonly signalFilterChain: SignalFilterChainService
  ) {}

  /**
   * Map legacy slippage model type string to shared enum
   */
  private mapSlippageModelType(model?: string): SlippageModelType {
    switch (model) {
      case 'none':
        return SlippageModelType.NONE;
      case 'volume-based':
        return SlippageModelType.VOLUME_BASED;
      case 'historical':
        return SlippageModelType.HISTORICAL;
      case 'fixed':
      default:
        return SlippageModelType.FIXED;
    }
  }

  /**
   * Compute the composite regime (trend + volatility) from BTC price data.
   *
   * Trend detection uses the O(1) incremental SMA maintained by
   * `advancePriceWindows` instead of recomputing `SMA.calculate()` every bar.
   * Volatility still uses `mapToArray` (small window, acceptable cost).
   *
   * Returns null if insufficient data (< 200 bars or SMA not filled).
   */
  private computeCompositeRegime(btcCoinId: string, priceCtx: PriceTrackingContext): CompositeRegimeResult | null {
    const btcWindow = priceCtx.windowsByCoin.get(btcCoinId);
    if (!btcWindow || btcWindow.length < BacktestEngine.REGIME_SMA_PERIOD) {
      return null;
    }

    // Use the incremental SMA if available (O(1)), otherwise fall back to window-based calculation
    const sma200 = priceCtx.btcRegimeSma?.filled ? priceCtx.btcRegimeSma.value : undefined;
    if (sma200 === undefined) {
      return null;
    }

    const lastEntry = btcWindow.last();
    const latestBtcPrice = lastEntry ? (lastEntry.close ?? lastEntry.avg) : undefined;
    if (latestBtcPrice === undefined) {
      return null;
    }

    const trendAboveSma = latestBtcPrice > sma200;

    // Volatility detection still uses mapToArray (small window, acceptable)
    let volatilityRegime = MarketRegimeType.NORMAL;
    const volConfig = DEFAULT_VOLATILITY_CONFIG;
    const btcCloseCount = btcWindow.length;
    if (btcCloseCount >= volConfig.rollingDays + 1) {
      try {
        const btcCloses = btcWindow.mapToArray((p) => p.close ?? p.avg);
        const realizedVol = this.volatilityCalculator.calculateRealizedVolatility(btcCloses, volConfig);
        if (btcCloseCount >= volConfig.lookbackDays) {
          const percentile = this.volatilityCalculator.calculatePercentile(realizedVol, btcCloses, volConfig);
          volatilityRegime = determineVolatilityRegime(percentile);
        }
      } catch (error) {
        this.logger.debug?.(`Volatility regime calc fell back to NORMAL: ${toErrorInfo(error).message}`);
      }
    }

    const compositeRegime = this.regimeGateService.classifyComposite(volatilityRegime, trendAboveSma);
    return { compositeRegime, volatilityRegime };
  }

  private resolveRegimeConfig(
    options: { enableRegimeGate?: boolean; enableRegimeScaledSizing?: boolean; riskLevel?: number },
    coins: Coin[]
  ): { enableRegimeScaledSizing: boolean; riskLevel: number; regimeGateEnabled: boolean; btcCoin: Coin | undefined } {
    const enableRegimeScaledSizing = options.enableRegimeScaledSizing !== false;
    const riskLevel = options.riskLevel ?? 3;
    const regimeGateEnabled = options.enableRegimeGate ?? riskLevel <= 2;
    const btcCoin =
      regimeGateEnabled || enableRegimeScaledSizing ? coins.find((c) => c.symbol?.toUpperCase() === 'BTC') : undefined;
    if (regimeGateEnabled && !btcCoin) {
      this.logger.warn('Regime gate enabled but BTC not found in dataset — gate disabled for this run');
    }
    return { enableRegimeScaledSizing, riskLevel, regimeGateEnabled, btcCoin };
  }

  private resolveRegimeConfigForOptimization(
    config: { enableRegimeGate?: boolean; enableRegimeScaledSizing?: boolean; riskLevel?: number },
    coins: Coin[],
    priceCtx: PriceTrackingContext
  ): { enableRegimeScaledSizing: boolean; riskLevel: number; regimeGateEnabled: boolean; btcCoin: Coin | undefined } {
    const result = this.resolveRegimeConfig(config, coins);
    if (result.btcCoin) {
      priceCtx.btcRegimeSma = new IncrementalSma(BacktestEngine.REGIME_SMA_PERIOD);
      priceCtx.btcCoinId = result.btcCoin.id;
    }
    return result;
  }

  private applyBarRegime(
    strategySignals: TradingSignal[],
    priceCtx: PriceTrackingContext,
    regimeConfig: { btcCoin?: Coin; regimeGateEnabled: boolean; enableRegimeScaledSizing: boolean; riskLevel: number },
    allocationLimits: { maxAllocation: number; minAllocation: number },
    precomputedRegime?: CompositeRegimeResult | null
  ): { filteredSignals: TradingSignal[]; barMaxAllocation: number; barMinAllocation: number } {
    if (!regimeConfig.btcCoin || strategySignals.length === 0) {
      return {
        filteredSignals: strategySignals,
        barMaxAllocation: allocationLimits.maxAllocation,
        barMinAllocation: allocationLimits.minAllocation
      };
    }

    const regimeResult =
      precomputedRegime !== undefined
        ? precomputedRegime
        : this.computeCompositeRegime(regimeConfig.btcCoin.id, priceCtx);
    if (!regimeResult) {
      return {
        filteredSignals: strategySignals,
        barMaxAllocation: allocationLimits.maxAllocation,
        barMinAllocation: allocationLimits.minAllocation
      };
    }

    const result = this.signalFilterChain.apply(
      strategySignals,
      {
        compositeRegime: regimeResult.compositeRegime,
        riskLevel: regimeConfig.riskLevel,
        regimeGateEnabled: regimeConfig.regimeGateEnabled,
        regimeScaledSizingEnabled: regimeConfig.enableRegimeScaledSizing
      },
      allocationLimits
    );

    return {
      filteredSignals: result.signals,
      barMaxAllocation: result.maxAllocation,
      barMinAllocation: result.minAllocation
    };
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
        : { trades: 0, signals: 0, fills: 0, snapshots: 0, sells: 0, winningSells: 0, grossProfit: 0, grossLoss: 0 };

    // Lightweight metrics accumulators - avoids keeping full objects in memory after checkpoint
    const metricsAcc = this.createMetricsAccumulator(
      totalPersistedCounts.trades,
      totalPersistedCounts.sells ?? 0,
      totalPersistedCounts.winningSells ?? 0,
      totalPersistedCounts.grossProfit ?? 0,
      totalPersistedCounts.grossLoss ?? 0
    );

    const coinIds = coins.map((coin) => coin.id);
    const coinMap = new Map<string, Coin>(coins.map((coin) => [coin.id, coin]));

    // Resolve quote currency from configSnapshot (default: USDT) with fallback chain
    const preferredQuoteCurrency = (backtest.configSnapshot?.run?.quoteCurrency as string) ?? DEFAULT_QUOTE_CURRENCY;
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

    // Position sizing: resolve from stage/risk matrix, with per-run overrides
    const allocLimits = getAllocationLimits(options.pipelineStage ?? PipelineStage.HISTORICAL, options.riskLevel, {
      maxAllocation: options.maxAllocation,
      minAllocation: options.minAllocation
    });
    const maxAllocation = allocLimits.maxAllocation;
    const minAllocation = allocLimits.minAllocation;

    // Hard stop-loss: configurable per-run, default enabled at 5%
    const enableHardStopLoss = options.enableHardStopLoss !== false;
    const hardStopLossPercent = options.hardStopLossPercent ?? 0.05;

    // Exit tracker: resolve effective ExitConfig from options or legacy hard stop-loss
    const exitTracker = this.resolveExitTracker({
      exitConfig: options.exitConfig,
      enableHardStopLoss,
      hardStopLossPercent,
      resumeExitTrackerState: isResuming ? options.resumeFrom?.exitTrackerState : undefined
    });

    // Opportunity selling config
    const oppSellingEnabled = options.enableOpportunitySelling ?? false;
    const oppSellingConfig = options.opportunitySellingConfig ?? DEFAULT_OPPORTUNITY_SELLING_CONFIG;

    // Regime-scaled position sizing + regime gate
    const { enableRegimeScaledSizing, riskLevel, regimeGateEnabled, btcCoin } = this.resolveRegimeConfig(
      options,
      coins
    );

    // Initialize incremental SMA for BTC regime detection
    if (btcCoin) {
      priceCtx.btcRegimeSma = new IncrementalSma(BacktestEngine.REGIME_SMA_PERIOD);
      priceCtx.btcCoinId = btcCoin.id;
    }

    // Signal throttle: resolve config from strategy parameters, init or restore state
    const throttleConfig = this.signalThrottle.resolveConfig(
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
        : { trades: 0, signals: 0, fills: 0, snapshots: 0, sells: 0, winningSells: 0, grossProfit: 0, grossLoss: 0 };

    // Track timestamp index for checkpoint interval calculation
    let lastCheckpointIndex = startIndex - 1;

    // Track consecutive algorithm failures to detect systematic issues
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 10;

    // Wall-clock watchdog: detect algorithm stalls
    const watchdog = new AlgorithmWatchdog(BacktestEngine.ALGORITHM_STALL_TIMEOUT_MS);

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

      // Check for liquidated positions after price update
      const liquidationTrades = this.checkAndApplyLiquidations(portfolio, marketData, backtest.tradingFee);
      for (const liqTrade of liquidationTrades) {
        liqTrade.executedAt = timestamp;
        trades.push(liqTrade as Partial<BacktestTrade>);
      }

      const priceData = this.advancePriceWindows(priceCtx, coins, timestamp);

      // During warmup: run algorithm to prime internal state but skip trading/recording
      if (isWarmup) {
        const warmupRegime = btcCoin ? this.computeCompositeRegime(btcCoin.id, priceCtx) : null;
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
          },
          compositeRegime: warmupRegime?.compositeRegime,
          volatilityRegime: warmupRegime?.volatilityRegime
        };
        try {
          await this.executeWithTimeout(
            this.algorithmRegistry.executeAlgorithm(backtest.algorithm.id, context),
            BacktestEngine.ALGORITHM_CALL_TIMEOUT_MS,
            `Algorithm timed out during warmup at ${timestamp.toISOString()}`
          );
          watchdog.recordSuccess();
        } catch {
          // Warmup failures are non-fatal — algorithm just won't have primed state
        }

        // Heartbeat during warmup so the stale watchdog sees progress
        if (options.onHeartbeat && Date.now() - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
          await options.onHeartbeat(i, effectiveTimestampCount);
          lastHeartbeatTime = Date.now();
        }

        // Yield to event loop periodically during warmup
        if (i % 100 === 0) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }

        continue;
      }

      // Exit tracker: check SL/TP/trailing exits BEFORE algorithm runs new decisions
      if (exitTracker) {
        await this.processExitSignals({
          exitTracker,
          currentPrices,
          marketData,
          portfolio,
          tradingFee: backtest.tradingFee,
          rng,
          timestamp,
          trades,
          slippageConfig,
          maxAllocation,
          minAllocation,
          signals,
          simulatedFills,
          backtest,
          coinMap,
          quoteCoin
        });
      }

      // Compute regime once per bar for context + filtering
      const barRegimeResult = btcCoin ? this.computeCompositeRegime(btcCoin.id, priceCtx) : null;

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
        },
        compositeRegime: barRegimeResult?.compositeRegime,
        volatilityRegime: barRegimeResult?.volatilityRegime
      };

      let strategySignals: TradingSignal[] = [];
      try {
        const algoExecStart = Date.now();
        const result = await this.executeWithTimeout(
          this.algorithmRegistry.executeAlgorithm(backtest.algorithm.id, context),
          BacktestEngine.ALGORITHM_CALL_TIMEOUT_MS,
          `Algorithm timed out at iteration ${i}/${effectiveTimestampCount} (${timestamp.toISOString()})`
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
        watchdog.recordSuccess();
        consecutiveErrors = 0;
      } catch (error: unknown) {
        if (error instanceof AlgorithmNotRegisteredException) {
          throw error;
        }
        watchdog.checkStall(`${i}/${effectiveTimestampCount} (${timestamp.toISOString()})`);
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

      // Regime gate + regime-scaled position sizing (pass precomputed to avoid double-computing)
      const { filteredSignals, barMaxAllocation, barMinAllocation } = this.applyBarRegime(
        strategySignals,
        priceCtx,
        { btcCoin, regimeGateEnabled, enableRegimeScaledSizing, riskLevel },
        { maxAllocation, minAllocation },
        barRegimeResult
      );
      strategySignals = filteredSignals;

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
                : strategySignal.action === 'OPEN_SHORT' ||
                    strategySignal.action === 'CLOSE_SHORT' ||
                    strategySignal.action === 'SELL'
                  ? SignalDirection.SHORT
                  : SignalDirection.FLAT,
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

        let tradeResult = await this.executeTrade(
          strategySignal,
          portfolio,
          marketData,
          backtest.tradingFee,
          rng,
          slippageConfig,
          dailyVolume,
          minHoldMs,
          barMaxAllocation,
          barMinAllocation
        );

        // Opportunity selling: if BUY failed (likely insufficient cash), attempt to sell positions to fund it
        if (!tradeResult && strategySignal.action === 'BUY' && oppSellingEnabled) {
          const oppResult = await this.attemptOpportunitySelling(
            strategySignal,
            portfolio,
            marketData,
            backtest.tradingFee,
            rng,
            slippageConfig,
            oppSellingConfig,
            coinMap,
            quoteCoin,
            backtest,
            timestamp,
            trades,
            simulatedFills,
            dailyVolume,
            barMaxAllocation,
            barMinAllocation
          );

          if (oppResult) {
            // Re-attempt the buy after sells freed up cash
            tradeResult = await this.executeTrade(
              strategySignal,
              portfolio,
              marketData,
              backtest.tradingFee,
              rng,
              slippageConfig,
              dailyVolume,
              minHoldMs,
              barMaxAllocation,
              barMinAllocation
            );
          }
        }

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

          // Update exit tracker: register new BUY positions, reduce on SELL
          if (exitTracker && trade.price != null && trade.quantity != null) {
            if (strategySignal.action === 'BUY') {
              exitTracker.onBuy(strategySignal.coinId, trade.price, trade.quantity);
            } else if (strategySignal.action === 'SELL') {
              exitTracker.onSell(strategySignal.coinId, trade.quantity);
            }
          }
        } else if (strategySignal.action === 'BUY') {
          metricsAcc.skippedBuyCount++;
        }
      }

      if (portfolio.totalValue > peakValue) {
        peakValue = portfolio.totalValue;
      }
      const currentDrawdown = peakValue === 0 ? 0 : Math.max(0, (peakValue - portfolio.totalValue) / peakValue);
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
      // Report progress using global indices so warmup + trading is monotonic
      if (options.onHeartbeat && Date.now() - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
        await options.onHeartbeat(i, effectiveTimestampCount);
        lastHeartbeatTime = Date.now();
      }

      // Yield to the event loop periodically to allow heartbeat DB writes,
      // BullMQ lock renewals, and concurrent workers to make progress.
      if (i % 100 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
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
          this.signalThrottle.serialize(throttleState),
          metricsAcc.grossProfit + currentSells.grossProfit,
          metricsAcc.grossLoss + currentSells.grossLoss,
          exitTracker?.serialize()
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
      maxDrawdown,
      metricsAcc.grossProfit,
      metricsAcc.grossLoss
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
      `Backtest completed: ${metricsAcc.totalTradeCount} trades, final value: $${portfolio.totalValue.toFixed(2)}` +
        (metricsAcc.skippedBuyCount > 0
          ? `, ${metricsAcc.skippedBuyCount} buy signals skipped (insufficient cash)`
          : '')
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

  /** Race a promise against a timeout — prevents indefinite blocking on algorithm calls */
  private executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
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
        : { trades: 0, signals: 0, fills: 0, snapshots: 0, sells: 0, winningSells: 0, grossProfit: 0, grossLoss: 0 };

    // Lightweight metrics accumulators - avoids keeping full objects in memory after checkpoint
    const metricsAcc = this.createMetricsAccumulator(
      totalPersistedCounts.trades,
      totalPersistedCounts.sells ?? 0,
      totalPersistedCounts.winningSells ?? 0,
      totalPersistedCounts.grossProfit ?? 0,
      totalPersistedCounts.grossLoss ?? 0
    );

    const coinIds = coins.map((coin) => coin.id);
    const coinMap = new Map<string, Coin>(coins.map((coin) => [coin.id, coin]));

    // Resolve quote currency from configSnapshot (default: USDT) with fallback chain
    const preferredQuoteCurrency = (backtest.configSnapshot?.run?.quoteCurrency as string) ?? DEFAULT_QUOTE_CURRENCY;
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

    // Position sizing: resolve from stage/risk matrix, with per-run overrides
    const lrAllocLimits = getAllocationLimits(options.pipelineStage ?? PipelineStage.LIVE_REPLAY, options.riskLevel, {
      maxAllocation: options.maxAllocation,
      minAllocation: options.minAllocation
    });
    const maxAllocation = lrAllocLimits.maxAllocation;
    const minAllocation = lrAllocLimits.minAllocation;

    // Hard stop-loss: configurable per-run, default enabled at 5%
    const enableHardStopLoss = options.enableHardStopLoss !== false;
    const hardStopLossPercent = options.hardStopLossPercent ?? 0.05;

    // Exit tracker: resolve effective ExitConfig from options or legacy hard stop-loss
    const exitTracker = this.resolveExitTracker({
      exitConfig: options.exitConfig,
      enableHardStopLoss,
      hardStopLossPercent,
      resumeExitTrackerState: isResuming ? options.resumeFrom?.exitTrackerState : undefined
    });

    // Regime-scaled position sizing + regime gate
    const { enableRegimeScaledSizing, riskLevel, regimeGateEnabled, btcCoin } = this.resolveRegimeConfig(
      options,
      coins
    );

    // Initialize incremental SMA for BTC regime detection
    if (btcCoin) {
      priceCtx.btcRegimeSma = new IncrementalSma(BacktestEngine.REGIME_SMA_PERIOD);
      priceCtx.btcCoinId = btcCoin.id;
    }

    // Signal throttle: resolve config from strategy parameters, init or restore state
    const throttleConfig = this.signalThrottle.resolveConfig(
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
        : { trades: 0, signals: 0, fills: 0, snapshots: 0, sells: 0, winningSells: 0, grossProfit: 0, grossLoss: 0 };

    // Track timestamp index for checkpoint interval calculation
    let lastCheckpointIndex = startIndex - 1;

    // Track consecutive algorithm failures to detect systematic issues
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 10;

    // Wall-clock watchdog: detect algorithm stalls
    const watchdog = new AlgorithmWatchdog(BacktestEngine.ALGORITHM_STALL_TIMEOUT_MS);

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
              this.signalThrottle.serialize(throttleState),
              metricsAcc.grossProfit + pauseSells.grossProfit,
              metricsAcc.grossLoss + pauseSells.grossLoss,
              exitTracker?.serialize()
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
              maxDrawdown,
              metricsAcc.grossProfit,
              metricsAcc.grossLoss
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
              this.signalThrottle.serialize(throttleState),
              metricsAcc.grossProfit + forcedPauseSells.grossProfit,
              metricsAcc.grossLoss + forcedPauseSells.grossLoss,
              exitTracker?.serialize()
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
              maxDrawdown,
              metricsAcc.grossProfit,
              metricsAcc.grossLoss
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

      // Check for liquidated positions after price update
      const liquidationTrades = this.checkAndApplyLiquidations(portfolio, marketData, backtest.tradingFee);
      for (const liqTrade of liquidationTrades) {
        liqTrade.executedAt = timestamp;
        trades.push(liqTrade as Partial<BacktestTrade>);
      }

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
          await this.executeWithTimeout(
            this.algorithmRegistry.executeAlgorithm(backtest.algorithm.id, context),
            BacktestEngine.ALGORITHM_CALL_TIMEOUT_MS,
            `Algorithm timed out during warmup at ${timestamp.toISOString()}`
          );
          watchdog.recordSuccess();
        } catch {
          // Warmup failures are non-fatal
        }

        // Heartbeat during warmup so the stale watchdog sees progress
        if (options.onHeartbeat && Date.now() - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
          await options.onHeartbeat(i, effectiveTimestampCount);
          lastHeartbeatTime = Date.now();
        }

        // Yield to event loop periodically during warmup
        if (i % 100 === 0) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }

        continue;
      }

      // Exit tracker: check SL/TP/trailing exits BEFORE algorithm runs new decisions
      if (exitTracker) {
        await this.processExitSignals({
          exitTracker,
          currentPrices,
          marketData,
          portfolio,
          tradingFee: backtest.tradingFee,
          rng,
          timestamp,
          trades,
          slippageConfig,
          maxAllocation,
          minAllocation,
          signals,
          simulatedFills,
          backtest,
          coinMap,
          quoteCoin
        });
      }

      // Apply pacing delay (except for the first trading timestamp and MAX_SPEED)
      if (delayMs > 0 && i > Math.max(startIndex, effectiveTradingStartIndex)) {
        await this.delay(delayMs);
      }

      // Compute regime once per bar for context + filtering
      const barRegimeResult = btcCoin ? this.computeCompositeRegime(btcCoin.id, priceCtx) : null;

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
        },
        compositeRegime: barRegimeResult?.compositeRegime,
        volatilityRegime: barRegimeResult?.volatilityRegime
      };

      let strategySignals: TradingSignal[] = [];
      try {
        const result = await this.executeWithTimeout(
          this.algorithmRegistry.executeAlgorithm(backtest.algorithm.id, context),
          BacktestEngine.ALGORITHM_CALL_TIMEOUT_MS,
          `Algorithm timed out at iteration ${i}/${effectiveTimestampCount} (${timestamp.toISOString()})`
        );

        if (result.success && result.signals?.length) {
          strategySignals = result.signals.map(mapStrategySignal).filter((signal) => signal.action !== 'HOLD');
        }
        watchdog.recordSuccess();
        consecutiveErrors = 0;
      } catch (error: unknown) {
        if (error instanceof AlgorithmNotRegisteredException) {
          throw error;
        }
        watchdog.checkStall(`${i}/${effectiveTimestampCount} (${timestamp.toISOString()})`);
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

      // Regime gate + regime-scaled position sizing (pass precomputed to avoid double-computing)
      const { filteredSignals, barMaxAllocation, barMinAllocation } = this.applyBarRegime(
        strategySignals,
        priceCtx,
        { btcCoin, regimeGateEnabled, enableRegimeScaledSizing, riskLevel },
        { maxAllocation, minAllocation },
        barRegimeResult
      );
      strategySignals = filteredSignals;

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
                : strategySignal.action === 'OPEN_SHORT' ||
                    strategySignal.action === 'CLOSE_SHORT' ||
                    strategySignal.action === 'SELL'
                  ? SignalDirection.SHORT
                  : SignalDirection.FLAT,
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
          minHoldMs,
          barMaxAllocation,
          barMinAllocation
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

          // Update exit tracker: register new BUY positions, reduce on SELL
          if (exitTracker && trade.price != null && trade.quantity != null) {
            if (strategySignal.action === 'BUY') {
              exitTracker.onBuy(strategySignal.coinId, trade.price, trade.quantity);
            } else if (strategySignal.action === 'SELL') {
              exitTracker.onSell(strategySignal.coinId, trade.quantity);
            }
          }
        } else if (strategySignal.action === 'BUY') {
          metricsAcc.skippedBuyCount++;
        }
      }

      if (portfolio.totalValue > peakValue) {
        peakValue = portfolio.totalValue;
      }
      const currentDrawdown = peakValue === 0 ? 0 : Math.max(0, (peakValue - portfolio.totalValue) / peakValue);
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
      // Report progress using global indices so warmup + trading is monotonic
      if (options.onHeartbeat && Date.now() - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
        await options.onHeartbeat(i, effectiveTimestampCount);
        lastHeartbeatTime = Date.now();
      }

      // Yield to the event loop periodically to allow heartbeat DB writes,
      // BullMQ lock renewals, and concurrent workers to make progress.
      if (i % 100 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
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
          this.signalThrottle.serialize(throttleState),
          metricsAcc.grossProfit + currentSells.grossProfit,
          metricsAcc.grossLoss + currentSells.grossLoss,
          exitTracker?.serialize()
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
      maxDrawdown,
      metricsAcc.grossProfit,
      metricsAcc.grossLoss
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
      `Live replay backtest completed: ${metricsAcc.totalTradeCount} trades, final value: $${portfolio.totalValue.toFixed(2)}` +
        (metricsAcc.skippedBuyCount > 0
          ? `, ${metricsAcc.skippedBuyCount} buy signals skipped (insufficient cash)`
          : '')
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
      avg: candle.close, // representative price — close used as the primary indicator input
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
    const windowsByCoin = new Map<string, RingBuffer<PriceSummary>>();

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
      windowsByCoin.set(coinId, new RingBuffer<PriceSummary>(BacktestEngine.MAX_WINDOW_SIZE));
    }

    return { timestampsByCoin, summariesByCoin, indexByCoin, windowsByCoin };
  }

  /**
   * Extract the expensive immutable work from initPriceTracking:
   * groups candles by coin, sorts per-coin, builds Date[] timestamps and PriceSummary[] arrays.
   * Does NOT create mutable state (indexByCoin, windowsByCoin).
   */
  private buildImmutablePriceData(historicalPrices: OHLCCandle[], coinIds: string[]): ImmutablePriceTrackingData {
    const timestampsByCoin = new Map<string, Date[]>();
    const summariesByCoin = new Map<string, PriceSummary[]>();

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
      timestampsByCoin.set(
        coinId,
        history.map((price) => this.getPriceTimestamp(price))
      );
      summariesByCoin.set(
        coinId,
        history.map((price) => this.buildPriceSummary(price))
      );
    }

    return { timestampsByCoin, summariesByCoin };
  }

  /**
   * Create fresh mutable state (indexByCoin, windowsByCoin) combined with cached immutable data.
   * Returns a full PriceTrackingContext. Safe because advancePriceWindows() only reads
   * timestampsByCoin/summariesByCoin and only mutates indexByCoin/windowsByCoin.
   */
  private initPriceTrackingFromPrecomputed(immutable: ImmutablePriceTrackingData): PriceTrackingContext {
    const indexByCoin = new Map<string, number>();
    const windowsByCoin = new Map<string, RingBuffer<PriceSummary>>();

    for (const coinId of immutable.timestampsByCoin.keys()) {
      indexByCoin.set(coinId, -1);
      windowsByCoin.set(coinId, new RingBuffer<PriceSummary>(BacktestEngine.MAX_WINDOW_SIZE));
    }

    return {
      timestampsByCoin: immutable.timestampsByCoin,
      summariesByCoin: immutable.summariesByCoin,
      indexByCoin,
      windowsByCoin
    };
  }

  /**
   * Filter out coins that don't have enough OHLC bars for the strategy's minimum
   * data requirement. Logs a single summary warning for excluded coins instead of
   * per-timestamp warnings inside the strategy loop.
   */
  private async filterCoinsWithSufficientData(
    algorithmId: string,
    coins: Coin[],
    parameters: Record<string, unknown>,
    summariesByCoin: Map<string, PriceSummary[]>
  ): Promise<Coin[]> {
    const strategy = await this.algorithmRegistry.getStrategyForAlgorithm(algorithmId);

    if (!strategy?.getMinDataPoints) {
      return coins;
    }

    const minRequired = strategy.getMinDataPoints(parameters);
    if (minRequired <= 0) {
      return coins;
    }

    const excluded: string[] = [];
    const filtered = coins.filter((coin) => {
      const totalBars = summariesByCoin.get(coin.id)?.length ?? 0;
      if (totalBars < minRequired) {
        excluded.push(`${coin.symbol}(${totalBars}/${minRequired})`);
        return false;
      }
      return true;
    });

    if (excluded.length > 0) {
      this.logger.warn(
        `Excluded ${excluded.length} coin(s) with insufficient data for optimization: ${excluded.join(', ')}`
      );
    }

    return filtered;
  }

  /**
   * Advance per-coin price windows up to and including the given timestamp.
   *
   * Returns a snapshot of each coin's price window as a plain `PriceSummary[]`
   * for backward compatibility with strategies. The underlying storage uses a
   * `RingBuffer` so that per-iteration maintenance is O(1) instead of O(K).
   */
  private advancePriceWindows(ctx: PriceTrackingContext, coins: Coin[], timestamp: Date): PriceSummaryByPeriod {
    const priceData: PriceSummaryByPeriod = {};
    for (const coin of coins) {
      const coinTimestamps = ctx.timestampsByCoin.get(coin.id) ?? [];
      const summaries = ctx.summariesByCoin.get(coin.id) ?? [];
      const window = ctx.windowsByCoin.get(coin.id);
      if (!window) continue;
      let pointer = ctx.indexByCoin.get(coin.id) ?? -1;
      while (pointer + 1 < coinTimestamps.length && coinTimestamps[pointer + 1] <= timestamp) {
        pointer += 1;
        window.push(summaries[pointer]); // O(1) — ring buffer auto-evicts oldest
        // Feed the incremental SMA for BTC regime detection
        if (ctx.btcRegimeSma && coin.id === ctx.btcCoinId) {
          ctx.btcRegimeSma.push(summaries[pointer].close ?? summaries[pointer].avg);
        }
      }
      ctx.indexByCoin.set(coin.id, pointer);
      if (window.length > 0) {
        priceData[coin.id] = window.toArray();
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
    priceCtx.btcRegimeSma = undefined;
    priceCtx.btcCoinId = undefined;
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
    minHoldMs: number = BacktestEngine.DEFAULT_MIN_HOLD_MS,
    maxAllocation: number = getAllocationLimits().maxAllocation,
    minAllocation: number = getAllocationLimits().minAllocation,
    defaultLeverage = 1
  ): Promise<{ trade: Partial<BacktestTrade>; slippageBps: number } | null> {
    const marketPrice = marketData.prices.get(signal.coinId);
    if (!marketPrice) {
      this.logger.warn(`No price data available for coin ${signal.coinId}`);
      return null;
    }

    if (signal.action === 'HOLD') {
      return null;
    }

    // Position conflict guards: prevent opposite-direction positions on same coin
    if (signal.action === 'BUY') {
      const existingShort = portfolio.positions.get(signal.coinId);
      if (existingShort && existingShort.side === 'short' && existingShort.quantity > 0) {
        this.logger.debug(`Cannot buy ${signal.coinId}: short position already exists`);
        return null;
      }
    }
    if (signal.action === 'OPEN_SHORT') {
      const existingLong = portfolio.positions.get(signal.coinId);
      if (existingLong && existingLong.side !== 'short' && existingLong.quantity > 0) {
        this.logger.debug(`Cannot open short for ${signal.coinId}: long position already exists`);
        return null;
      }
    }

    // Hard stop-loss override: use the stop execution price (the price a real
    // stop order would fill at) instead of the candle close.
    const basePrice: number =
      signal.metadata?.hardStopLoss && signal.metadata?.stopExecutionPrice
        ? signal.metadata.stopExecutionPrice
        : marketPrice;

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
        const confidenceBasedAllocation = minAllocation + signal.confidence * (maxAllocation - minAllocation);
        const investmentAmount = portfolio.totalValue * confidenceBasedAllocation;
        quantity = investmentAmount / price;
      } else {
        // Fallback to random allocation (within min–max range of portfolio)
        const investmentAmount = portfolio.totalValue * Math.min(maxAllocation, Math.max(minAllocation, rng.next()));
        quantity = investmentAmount / price;
      }

      totalValue = quantity * price;
      const estimatedFeeResult = this.feeCalculator.calculateFee(
        { tradeValue: totalValue },
        this.feeCalculator.fromFlatRate(tradingFee)
      );

      if (portfolio.cashBalance < totalValue + estimatedFeeResult.fee) {
        this.logger.debug('Insufficient cash balance for BUY trade (including fees)');
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

    // Short position tracking fields
    let positionSide: string | undefined;
    let leverage: number | undefined;
    let liquidationPrice: number | undefined;
    let marginUsed: number | undefined;

    if (signal.action === 'OPEN_SHORT') {
      const shortLeverage = Math.min(
        Math.max(1, (signal.metadata?.leverage as number) ?? defaultLeverage),
        MAX_LEVERAGE_CAP
      );

      // Position sizing priority: quantity > percentage > confidence > random
      if (signal.quantity) {
        quantity = signal.quantity;
      } else if (signal.percentage) {
        const investmentAmount = portfolio.totalValue * signal.percentage;
        quantity = investmentAmount / price;
      } else if (signal.confidence !== undefined) {
        const confidenceBasedAllocation = minAllocation + signal.confidence * (maxAllocation - minAllocation);
        const investmentAmount = portfolio.totalValue * confidenceBasedAllocation;
        quantity = investmentAmount / price;
      } else {
        const investmentAmount = portfolio.totalValue * Math.min(maxAllocation, Math.max(minAllocation, rng.next()));
        quantity = investmentAmount / price;
      }

      const marginAmount = (quantity * price) / shortLeverage;
      totalValue = marginAmount;

      const estimatedFeeResult = this.feeCalculator.calculateFee(
        { tradeValue: quantity * price },
        this.feeCalculator.fromFlatRate(tradingFee)
      );

      if (portfolio.cashBalance < marginAmount + estimatedFeeResult.fee) {
        this.logger.debug('Insufficient cash balance for OPEN_SHORT trade (margin + fees)');
        return null;
      }

      portfolio.cashBalance -= marginAmount;

      const maintenanceMarginRate = MAINTENANCE_MARGIN_RATE;
      const calcLiquidationPrice = price * (1 + 1 / shortLeverage - maintenanceMarginRate);

      const shortPosition: import('./shared').Position = {
        coinId: signal.coinId,
        quantity,
        averagePrice: price,
        totalValue: marginAmount,
        side: 'short',
        leverage: shortLeverage,
        marginAmount,
        liquidationPrice: calcLiquidationPrice,
        entryDate: marketData.timestamp
      };

      portfolio.positions.set(signal.coinId, shortPosition);
      portfolio.totalMarginUsed = (portfolio.totalMarginUsed ?? 0) + marginAmount;
      portfolio.availableMargin = portfolio.cashBalance;

      positionSide = 'short';
      leverage = shortLeverage;
      liquidationPrice = calcLiquidationPrice;
      marginUsed = marginAmount;
    }

    if (signal.action === 'CLOSE_SHORT') {
      const existingPosition = portfolio.positions.get(signal.coinId);
      if (!existingPosition || existingPosition.side !== 'short' || existingPosition.quantity === 0) {
        return null;
      }

      costBasis = existingPosition.averagePrice;

      // Position sizing priority: quantity > percentage > confidence > random
      if (signal.quantity) {
        quantity = signal.quantity;
      } else if (signal.percentage) {
        quantity = existingPosition.quantity * Math.min(1, signal.percentage);
      } else if (signal.confidence !== undefined) {
        const confidenceBasedPercent = 0.25 + signal.confidence * 0.75;
        quantity = existingPosition.quantity * confidenceBasedPercent;
      } else {
        quantity = existingPosition.quantity * Math.min(1, Math.max(0.25, rng.next()));
      }
      quantity = Math.min(quantity, existingPosition.quantity);

      // Calculate realized P&L: (entryPrice - exitPrice) * quantity (inverted from long)
      realizedPnL = (costBasis - price) * quantity;
      realizedPnLPercent = costBasis > 0 ? (costBasis - price) / costBasis : 0;

      // Return margin proportionally
      const returnedMargin = (existingPosition.marginAmount ?? 0) * (quantity / existingPosition.quantity);
      totalValue = returnedMargin;

      // Cap loss at margin amount (can't lose more than margin posted)
      realizedPnL = Math.max(-returnedMargin, realizedPnL);

      portfolio.cashBalance += returnedMargin + realizedPnL;

      existingPosition.quantity -= quantity;
      if (existingPosition.quantity <= 0) {
        portfolio.positions.delete(signal.coinId);
      } else {
        const remainingMargin = (existingPosition.marginAmount ?? 0) - returnedMargin;
        existingPosition.marginAmount = remainingMargin;
        existingPosition.totalValue =
          remainingMargin + (existingPosition.averagePrice - price) * existingPosition.quantity;
        portfolio.positions.set(signal.coinId, existingPosition);
      }

      portfolio.totalMarginUsed = Math.max(0, (portfolio.totalMarginUsed ?? 0) - returnedMargin);
      portfolio.availableMargin = portfolio.cashBalance;

      positionSide = 'short';
      leverage = existingPosition.leverage;
      liquidationPrice = existingPosition.liquidationPrice;
      marginUsed = returnedMargin;
    }

    // Fee base: use notional value for shorts, totalValue for longs
    const feeBaseValue =
      signal.action === 'OPEN_SHORT' || signal.action === 'CLOSE_SHORT' ? quantity * price : totalValue;

    // Use shared FeeCalculatorService for consistent fee calculation
    const feeConfig = this.feeCalculator.fromFlatRate(tradingFee);
    const feeResult = this.feeCalculator.calculateFee({ tradeValue: feeBaseValue }, feeConfig);
    const fee = feeResult.fee;
    portfolio.cashBalance -= fee;
    portfolio.totalValue =
      portfolio.cashBalance + this.portfolioState.calculatePositionsValue(portfolio.positions, marketData.prices);

    // Determine trade type
    let tradeType: TradeType;
    if (signal.action === 'BUY' || signal.action === 'OPEN_SHORT') {
      tradeType = TradeType.BUY;
    } else {
      tradeType = TradeType.SELL;
    }

    return {
      trade: {
        type: tradeType,
        quantity,
        price,
        totalValue,
        fee,
        realizedPnL,
        realizedPnLPercent,
        costBasis,
        positionSide,
        leverage,
        liquidationPrice,
        marginUsed,
        metadata: {
          ...(signal.metadata ?? {}),
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

  /**
   * Check all leveraged positions for liquidation and force-close any that have been breached.
   * Returns an array of liquidation trade records.
   */
  private checkAndApplyLiquidations(
    portfolio: Portfolio,
    marketData: MarketData,
    tradingFee: number
  ): Partial<BacktestTrade>[] {
    const liquidationTrades: Partial<BacktestTrade>[] = [];
    const positionsToDelete: string[] = [];

    for (const [coinId, position] of portfolio.positions) {
      if (!position.leverage || position.leverage <= 1) continue;

      const currentPrice = marketData.prices.get(coinId);
      if (currentPrice === undefined) continue;

      if (this.positionManager.isLiquidated(position, currentPrice)) {
        const marginLost = position.marginAmount ?? 0;

        // Record liquidation trade (total loss of margin)
        liquidationTrades.push({
          type: position.side === 'short' ? TradeType.BUY : TradeType.SELL,
          quantity: position.quantity,
          price: currentPrice,
          totalValue: 0,
          fee: 0,
          realizedPnL: -marginLost,
          realizedPnLPercent: -1,
          costBasis: position.averagePrice,
          positionSide: position.side,
          leverage: position.leverage,
          liquidationPrice: position.liquidationPrice,
          marginUsed: marginLost,
          metadata: { liquidated: true }
        });

        positionsToDelete.push(coinId);

        // Update margin tracking
        portfolio.totalMarginUsed = Math.max(0, (portfolio.totalMarginUsed ?? 0) - marginLost);

        this.logger.debug(
          `Position liquidated: ${coinId} ${position.side} at ${currentPrice} (liq price: ${position.liquidationPrice})`
        );
      }
    }

    // Delete liquidated positions
    for (const coinId of positionsToDelete) {
      portfolio.positions.delete(coinId);
    }

    if (positionsToDelete.length > 0) {
      portfolio.availableMargin = portfolio.cashBalance;
      portfolio.totalValue =
        portfolio.cashBalance + this.portfolioState.calculatePositionsValue(portfolio.positions, marketData.prices);
    }

    return liquidationTrades;
  }

  /**
   * Resolve the effective ExitConfig and instantiate a BacktestExitTracker.
   *
   * Centralises the exit-tracker initialisation logic shared by all four
   * execution paths (historical, live-replay, optimization, optimization-precomputed).
   */
  private resolveExitTracker(opts: ResolveExitTrackerOptions): BacktestExitTracker | null {
    const effectiveExitConfig = opts.exitConfig
      ? { ...DEFAULT_BACKTEST_EXIT_CONFIG, ...opts.exitConfig }
      : opts.enableHardStopLoss !== false
        ? { ...DEFAULT_BACKTEST_EXIT_CONFIG, stopLossValue: (opts.hardStopLossPercent ?? 0.05) * 100 }
        : null;

    if (
      !effectiveExitConfig ||
      (!effectiveExitConfig.enableStopLoss &&
        !effectiveExitConfig.enableTakeProfit &&
        !effectiveExitConfig.enableTrailingStop)
    ) {
      return null;
    }

    return opts.resumeExitTrackerState
      ? BacktestExitTracker.deserialize(opts.resumeExitTrackerState, effectiveExitConfig)
      : new BacktestExitTracker(effectiveExitConfig);
  }

  /**
   * Process exit signals (SL/TP/trailing) for the current bar.
   *
   * When `signals`, `simulatedFills`, and `backtest` are all provided, runs in
   * full-fidelity mode (historical / live-replay) and records BacktestSignal and
   * SimulatedOrderFill entries. Otherwise runs in lightweight mode (optimization)
   * and pushes only minimal trade records.
   */
  private async processExitSignals(opts: ProcessExitSignalsOptions): Promise<void> {
    const { exitTracker, currentPrices, marketData, portfolio, tradingFee, rng, timestamp, trades } = opts;

    if (exitTracker.size === 0) return;

    const lowPrices = new Map(currentPrices.map((c) => [c.coinId, c.low]));
    const highPrices = new Map(currentPrices.map((c) => [c.coinId, c.high]));
    const exitSignals = exitTracker.checkExits(marketData.prices, lowPrices, highPrices);

    const fullFidelity = !!(opts.signals && opts.simulatedFills && opts.backtest);

    for (const exitSig of exitSignals) {
      const exitTradingSignal: TradingSignal = {
        action: 'SELL',
        coinId: exitSig.coinId,
        quantity: exitSig.quantity,
        reason: exitSig.reason,
        confidence: 1,
        originalType: exitSig.exitType === 'TAKE_PROFIT' ? AlgoSignalType.TAKE_PROFIT : AlgoSignalType.STOP_LOSS,
        metadata: fullFidelity ? { ...exitSig.metadata, exitType: exitSig.exitType } : { exitType: exitSig.exitType }
      };

      if (fullFidelity) {
        opts.signals!.push({
          timestamp,
          signalType: SignalType.RISK_CONTROL,
          instrument: exitSig.coinId,
          direction: SignalDirection.SHORT,
          quantity: exitSig.quantity,
          price: exitSig.executionPrice,
          reason: exitSig.reason,
          confidence: 1,
          payload: exitSig.metadata,
          backtest: opts.backtest
        });
      }

      const dailyVolume = fullFidelity ? this.extractDailyVolume(currentPrices, exitSig.coinId) : undefined;
      const tradeResult = await this.executeTrade(
        exitTradingSignal,
        portfolio,
        marketData,
        tradingFee,
        rng,
        opts.slippageConfig ?? DEFAULT_SLIPPAGE_CONFIG,
        dailyVolume,
        0, // bypass hold period for risk-control exits
        opts.maxAllocation,
        opts.minAllocation
      );

      if (tradeResult) {
        const { trade, slippageBps } = tradeResult;
        if (fullFidelity) {
          const baseCoin = opts.coinMap?.get(exitSig.coinId);
          trades.push({
            ...trade,
            executedAt: timestamp,
            backtest: opts.backtest,
            baseCoin: baseCoin || undefined,
            quoteCoin: opts.quoteCoin
          });
          opts.simulatedFills!.push({
            orderType: SimulatedOrderType.MARKET,
            status: SimulatedOrderStatus.FILLED,
            filledQuantity: trade.quantity,
            averagePrice: trade.price,
            fees: trade.fee,
            slippageBps,
            executionTimestamp: timestamp,
            instrument: exitSig.coinId,
            metadata: { ...(trade.metadata ?? {}), exitType: exitSig.exitType },
            backtest: opts.backtest
          });
        } else {
          trades.push({ ...trade, executedAt: timestamp });
        }
      }
      exitTracker.removePosition(exitSig.coinId);
    }
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
   * Attempt opportunity selling: score existing positions, sell the weakest ones
   * to free up cash for a higher-confidence buy signal.
   *
   * Operates directly on the in-memory portfolio. Sell trades and fills are
   * appended to the provided arrays.
   *
   * @returns true if sells were executed and the buy should be re-attempted
   */
  private async attemptOpportunitySelling(
    buySignal: TradingSignal,
    portfolio: Portfolio,
    marketData: MarketData,
    tradingFee: number,
    rng: SeededRandom,
    slippageConfig: SlippageConfig,
    config: OpportunitySellingUserConfig,
    coinMap: Map<string, Coin>,
    quoteCoin: Coin,
    backtest: Backtest,
    timestamp: Date,
    trades: Partial<BacktestTrade>[],
    simulatedFills: Partial<SimulatedOrderFill>[],
    dailyVolume?: number,
    maxAllocation: number = getAllocationLimits().maxAllocation,
    minAllocation: number = getAllocationLimits().minAllocation
  ): Promise<boolean> {
    const buyConfidence = buySignal.confidence ?? 0;

    // Gate: confidence threshold
    if (buyConfidence < config.minOpportunityConfidence) return false;

    // Estimate the required buy amount
    const buyPrice = marketData.prices.get(buySignal.coinId);
    if (!buyPrice) return false;

    let requiredAmount: number;
    if (buySignal.quantity) {
      requiredAmount = buySignal.quantity * buyPrice;
    } else if (buySignal.percentage) {
      requiredAmount = portfolio.totalValue * buySignal.percentage;
    } else if (buySignal.confidence !== undefined) {
      const alloc = minAllocation + buySignal.confidence * (maxAllocation - minAllocation);
      requiredAmount = portfolio.totalValue * alloc;
    } else {
      requiredAmount = portfolio.totalValue * minAllocation;
    }

    // Fee estimate
    const feeConfig = this.feeCalculator.fromFlatRate(tradingFee);
    const estFee = this.feeCalculator.calculateFee({ tradeValue: requiredAmount }, feeConfig).fee;
    const totalRequired = requiredAmount + estFee;

    if (portfolio.cashBalance >= totalRequired) return false; // No shortfall

    const shortfall = totalRequired - portfolio.cashBalance;

    // Score and rank eligible positions
    const eligible = this.scoreEligiblePositions(
      portfolio,
      buySignal.coinId,
      buyConfidence,
      config,
      marketData,
      timestamp
    );
    if (eligible.length === 0) return false;

    // Execute sells to cover the shortfall
    const maxSellValue = (portfolio.totalValue * config.maxLiquidationPercent) / 100;
    return this.executeSellPlan(
      eligible,
      shortfall,
      maxSellValue,
      buySignal,
      buyConfidence,
      totalRequired,
      portfolio,
      marketData,
      tradingFee,
      rng,
      slippageConfig,
      coinMap,
      quoteCoin,
      backtest,
      timestamp,
      trades,
      simulatedFills,
      dailyVolume
    );
  }

  /**
   * Score all portfolio positions for opportunity selling eligibility.
   * Returns sorted candidates (lowest score = sell first).
   */
  private scoreEligiblePositions(
    portfolio: Portfolio,
    buyCoinId: string,
    buyConfidence: number,
    config: OpportunitySellingUserConfig,
    marketData: MarketData,
    timestamp: Date
  ): { coinId: string; score: number; quantity: number; price: number }[] {
    const eligible: { coinId: string; score: number; quantity: number; price: number }[] = [];

    for (const [coinId, position] of portfolio.positions) {
      if (coinId === buyCoinId) continue;
      if (config.protectedCoins.includes(coinId)) continue;

      const currentPrice = marketData.prices.get(coinId);
      if (!currentPrice || currentPrice <= 0) continue;

      const score = this.positionAnalysis.calculatePositionSellScore(
        position,
        currentPrice,
        buyConfidence,
        config,
        timestamp
      );

      if (score.eligible) {
        eligible.push({ coinId, score: score.totalScore, quantity: position.quantity, price: currentPrice });
      }
    }

    // Sort by score ASC (lowest = sell first)
    eligible.sort((a, b) => a.score - b.score);
    return eligible;
  }

  /**
   * Execute sells from ranked candidates to cover a cash shortfall.
   * Appends resulting trades and fills to the provided arrays.
   *
   * @returns true if any sells were executed
   */
  private async executeSellPlan(
    candidates: { coinId: string; score: number; quantity: number; price: number }[],
    shortfall: number,
    maxSellValue: number,
    buySignal: TradingSignal,
    buyConfidence: number,
    totalRequired: number,
    portfolio: Portfolio,
    marketData: MarketData,
    tradingFee: number,
    rng: SeededRandom,
    slippageConfig: SlippageConfig,
    coinMap: Map<string, Coin>,
    quoteCoin: Coin,
    backtest: Backtest,
    timestamp: Date,
    trades: Partial<BacktestTrade>[],
    simulatedFills: Partial<SimulatedOrderFill>[],
    dailyVolume?: number
  ): Promise<boolean> {
    let remainingShortfall = shortfall;
    let totalSellValue = 0;
    let sellExecuted = false;

    for (const candidate of candidates) {
      if (remainingShortfall <= 0 || totalSellValue >= maxSellValue) break;

      const maxByShortfall = remainingShortfall / candidate.price;
      const maxByLiquidation = (maxSellValue - totalSellValue) / candidate.price;
      const quantity = Math.min(candidate.quantity, maxByShortfall, maxByLiquidation);
      if (quantity <= 0) continue;

      // Execute the sell on the in-memory portfolio
      const sellSignal: TradingSignal = {
        action: 'SELL',
        coinId: candidate.coinId,
        quantity,
        reason: `Opportunity sell: freeing cash for ${buySignal.coinId} buy (confidence=${(buyConfidence * 100).toFixed(0)}%)`,
        confidence: buyConfidence,
        metadata: {
          opportunitySell: true,
          buyTargetCoin: buySignal.coinId,
          buyConfidence,
          shortfall,
          totalRequired,
          eligibleCount: candidates.length,
          candidateScore: candidate.score,
          remainingShortfall
        }
      };

      // Use minHoldMs=0 so the sell isn't blocked by hold period (already checked by scoring)
      const sellResult = await this.executeTrade(
        sellSignal,
        portfolio,
        marketData,
        tradingFee,
        rng,
        slippageConfig,
        dailyVolume,
        0
      );
      if (sellResult) {
        const { trade, slippageBps } = sellResult;
        const baseCoin = coinMap.get(candidate.coinId);

        trades.push({ ...trade, executedAt: timestamp, backtest, baseCoin: baseCoin || undefined, quoteCoin });
        simulatedFills.push({
          orderType: SimulatedOrderType.MARKET,
          status: SimulatedOrderStatus.FILLED,
          filledQuantity: trade.quantity,
          averagePrice: trade.price,
          fees: trade.fee,
          slippageBps,
          executionTimestamp: timestamp,
          instrument: candidate.coinId,
          metadata: { ...(trade.metadata ?? {}), opportunitySell: true },
          backtest
        });

        totalSellValue += (trade.quantity ?? 0) * (trade.price ?? 0);
        remainingShortfall -= (trade.quantity ?? 0) * (trade.price ?? 0);
        sellExecuted = true;
      }
    }

    return sellExecuted;
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
      addGrossProfit: (n: number) => void;
      addGrossLoss: (n: number) => void;
    }
  ): void {
    acc.addTradeCount(trades.length);
    const { sells, winningSells, grossProfit, grossLoss } = this.countSells(trades);
    acc.addSellCount(sells);
    acc.addWinningSellCount(winningSells);
    acc.addGrossProfit(grossProfit);
    acc.addGrossLoss(grossLoss);
    acc.addSnapshotValues(snapshots.map((s) => s.portfolioValue ?? 0));
  }

  private createMetricsAccumulator(
    initialTradeCount = 0,
    initialSellCount = 0,
    initialWinningSellCount = 0,
    initialGrossProfit = 0,
    initialGrossLoss = 0
  ): MetricsAccumulator {
    const acc: MetricsAccumulator = {
      totalTradeCount: initialTradeCount,
      totalSellCount: initialSellCount,
      totalWinningSellCount: initialWinningSellCount,
      grossProfit: initialGrossProfit,
      grossLoss: initialGrossLoss,
      skippedBuyCount: 0,
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
      },
      addGrossProfit: (n) => {
        acc.grossProfit += n;
      },
      addGrossLoss: (n) => {
        acc.grossLoss += n;
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
    maxDrawdown: number,
    grossProfit: number,
    grossLoss: number
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

    // Compute profitFactor from accumulated gross profit/loss (capped at 10)
    const rawProfitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 10 : 1;
    const profitFactor = Math.min(rawProfitFactor, 10);

    // Compute annualized volatility from returns series
    let volatility = 0;
    if (returns.length > 0) {
      const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
      volatility = Math.sqrt(variance) * Math.sqrt(252);
    }

    return {
      finalValue,
      totalReturn,
      annualizedReturn,
      sharpeRatio,
      maxDrawdown,
      totalTrades: totalTradeCount,
      winningTrades: totalWinningSellCount,
      losingTrades: totalSellCount - totalWinningSellCount,
      winRate: totalSellCount > 0 ? totalWinningSellCount / totalSellCount : 0,
      profitFactor,
      volatility
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
  private countSells(trades: Partial<BacktestTrade>[]): {
    sells: number;
    winningSells: number;
    grossProfit: number;
    grossLoss: number;
  } {
    let sells = 0,
      winningSells = 0,
      grossProfit = 0,
      grossLoss = 0;
    for (const t of trades) {
      if (t.type === TradeType.SELL) {
        sells++;
        const pnl = t.realizedPnL ?? 0;
        if (pnl > 0) {
          winningSells++;
          grossProfit += pnl;
        } else if (pnl < 0) {
          grossLoss += Math.abs(pnl);
        }
      }
    }
    return { sells, winningSells, grossProfit, grossLoss };
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
    serializedThrottleState?: SerializableThrottleState,
    grossProfit = 0,
    grossLoss = 0,
    exitTrackerState?: import('./shared/exits/backtest-exit-tracker').SerializableExitTrackerState
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
        winningSells: winningSellsCount,
        grossProfit,
        grossLoss
      },
      checksum,
      ...(serializedThrottleState && { throttleState: serializedThrottleState }),
      ...(exitTrackerState && { exitTrackerState })
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
    const coinIds = coins.map((coin) => coin.id);
    const historicalPrices = await this.getHistoricalPrices(coinIds, config.startDate, config.endDate);
    return this.runOptimizationBacktestCore(config, coins, historicalPrices);
  }

  /**
   * Execute an optimization backtest using pre-loaded candle data indexed by coin.
   * Uses binary search for O(log N) range extraction instead of linear filter.
   * Used by the optimization orchestrator to avoid redundant DB queries across windows.
   */
  async executeOptimizationBacktestWithData(
    config: OptimizationBacktestConfig,
    coins: Coin[],
    preloadedCandlesByCoin: Map<string, OHLCCandle[]>
  ): Promise<OptimizationBacktestResult> {
    const startTime = config.startDate.getTime();
    const endTime = config.endDate.getTime();
    const coinIds = new Set(coins.map((coin) => coin.id));
    const segments: OHLCCandle[][] = [];
    let totalLen = 0;

    for (const coinId of coinIds) {
      const coinCandles = preloadedCandlesByCoin.get(coinId);
      if (!coinCandles || coinCandles.length === 0) continue;

      const left = BacktestEngine.binarySearchLeft(coinCandles, startTime);
      const right = BacktestEngine.binarySearchRight(coinCandles, endTime);
      if (left < right) {
        const segment = coinCandles.slice(left, right);
        segments.push(segment);
        totalLen += segment.length;
      }
    }

    // Pre-allocate and concatenate segments
    const filtered = new Array<OHLCCandle>(totalLen);
    let offset = 0;
    for (const seg of segments) {
      for (let i = 0; i < seg.length; i++) {
        filtered[offset++] = seg[i];
      }
    }

    return this.runOptimizationBacktestCore(config, coins, filtered);
  }

  /**
   * Pre-compute all expensive per-window data once for a single date range.
   * Called once per unique date range by the orchestrator, then reused across all parameter combinations.
   * Combines binary search filtering, groupPricesByTimestamp(), buildImmutablePriceData(), and volume map construction.
   */
  precomputeWindowData(
    coins: Coin[],
    preloadedCandlesByCoin: Map<string, OHLCCandle[]>,
    startDate: Date,
    endDate: Date
  ): PrecomputedWindowData {
    const startTime = startDate.getTime();
    const endTime = endDate.getTime();
    const coinIds = new Set(coins.map((coin) => coin.id));
    const segments: OHLCCandle[][] = [];
    let totalLen = 0;

    for (const coinId of coinIds) {
      const coinCandles = preloadedCandlesByCoin.get(coinId);
      if (!coinCandles || coinCandles.length === 0) continue;

      const left = BacktestEngine.binarySearchLeft(coinCandles, startTime);
      const right = BacktestEngine.binarySearchRight(coinCandles, endTime);
      if (left < right) {
        const segment = coinCandles.slice(left, right);
        segments.push(segment);
        totalLen += segment.length;
      }
    }

    // Pre-allocate and concatenate segments
    const filteredCandles = new Array<OHLCCandle>(totalLen);
    let offset = 0;
    for (const seg of segments) {
      for (let i = 0; i < seg.length; i++) {
        filteredCandles[offset++] = seg[i];
      }
    }

    const pricesByTimestamp = this.groupPricesByTimestamp(filteredCandles);
    const timestamps = Object.keys(pricesByTimestamp).sort();
    const coinIdArray = coins.map((c) => c.id);
    const immutablePriceData = this.buildImmutablePriceData(filteredCandles, coinIdArray);

    // Precompute volume lookup: timestamp+coinId → volume
    const volumeMap = new Map<string, number>();
    for (const tsKey of timestamps) {
      for (const candle of pricesByTimestamp[tsKey]) {
        if (candle.volume != null) {
          volumeMap.set(`${tsKey}:${candle.coinId}`, candle.volume);
        }
      }
    }

    return { pricesByTimestamp, timestamps, immutablePriceData, volumeMap, filteredCandles, tradingStartIndex: 0 };
  }

  /**
   * Fast-path optimization backtest using pre-computed window data.
   * Creates only fresh mutable state + indicators (which depend on per-combo config.parameters).
   * Reuses pricesByTimestamp, timestamps, immutablePriceData, and volumeMap from PrecomputedWindowData.
   */
  async runOptimizationBacktestWithPrecomputed(
    config: OptimizationBacktestConfig,
    coins: Coin[],
    precomputed: PrecomputedWindowData
  ): Promise<OptimizationBacktestResult> {
    const initialCapital = config.initialCapital ?? 10000;
    const tradingFee = config.tradingFee ?? 0.001;
    const hardStopLossPercent = config.hardStopLossPercent ?? 0.05;
    const slippageConfig = config.slippage ?? DEFAULT_SLIPPAGE_CONFIG;
    const deterministicSeed = `optimization-${config.algorithmId}-${Date.now()}`;

    // Exit tracker for optimization (lightweight — no signal/fill recording)
    const optExitTracker = this.resolveExitTracker({
      exitConfig: config.exitConfig,
      enableHardStopLoss: true,
      hardStopLossPercent
    });

    this.logger.debug(
      `Running precomputed optimization backtest: algo=${config.algorithmId}, ` +
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

    if (precomputed.filteredCandles.length === 0) {
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

    const { pricesByTimestamp, timestamps, immutablePriceData, volumeMap, tradingStartIndex } = precomputed;

    // Create fresh mutable state from cached immutable data
    const priceCtx = this.initPriceTrackingFromPrecomputed(immutablePriceData);

    // Pre-filter coins whose total bar count is below the strategy's minimum requirement
    const coinsWithData = await this.filterCoinsWithSufficientData(
      config.algorithmId,
      coins,
      config.parameters,
      priceCtx.summariesByCoin
    );

    // Precompute indicators only for coins that passed the filter
    const precomputedIndicators = await this.precomputeIndicatorsForOptimization(config, coinsWithData, priceCtx);

    // Position sizing for OPTIMIZE stage
    const optAllocLimits = getAllocationLimits(PipelineStage.OPTIMIZE, config.riskLevel, {
      maxAllocation: config.maxAllocation,
      minAllocation: config.minAllocation
    });
    let optMaxAllocation = optAllocLimits.maxAllocation;
    let optMinAllocation = optAllocLimits.minAllocation;

    // Regime gate + scaled sizing for optimization
    const { enableRegimeScaledSizing, riskLevel, regimeGateEnabled, btcCoin } = this.resolveRegimeConfigForOptimization(
      config,
      coins,
      priceCtx
    );

    let peakValue = initialCapital;
    let maxDrawdown = 0;

    // Signal throttle
    const throttleConfig = this.signalThrottle.resolveConfig(config.parameters);
    const throttleState = this.signalThrottle.createState();

    // Reusable price map
    const currentPriceMap = new Map<string, number>();

    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = new Date(timestamps[i]);
      const currentPrices = pricesByTimestamp[timestamps[i]];

      currentPriceMap.clear();
      for (const price of currentPrices) {
        currentPriceMap.set(price.coinId, this.getPriceValue(price));
      }

      const marketData: MarketData = {
        timestamp,
        prices: currentPriceMap
      };

      // Always update portfolio values and price windows (needed for indicator warm-up)
      portfolio = this.portfolioState.updateValues(portfolio, marketData.prices);

      const priceData = this.advancePriceWindows(priceCtx, coinsWithData, timestamp);

      // Skip trading logic during warm-up period — indicators need history to produce
      // valid values, but no trades should execute before the original window start date
      if (i < tradingStartIndex) {
        continue;
      }

      // Lightweight exit tracker check for optimization (no signal/fill recording)
      if (optExitTracker) {
        await this.processExitSignals({
          exitTracker: optExitTracker,
          currentPrices,
          marketData,
          portfolio,
          tradingFee,
          rng,
          timestamp,
          trades,
          slippageConfig
        });
      }

      // Compute regime for context + filtering
      const barRegimeResult = btcCoin ? this.computeCompositeRegime(btcCoin.id, priceCtx) : null;

      // Build algorithm context
      const positions =
        portfolio.positions.size > 0
          ? Object.fromEntries([...portfolio.positions.entries()].map(([id, position]) => [id, position.quantity]))
          : {};

      const context = {
        coins: coinsWithData,
        priceData,
        timestamp,
        config: config.parameters,
        positions,
        availableBalance: portfolio.cashBalance,
        metadata: {
          isOptimization: true,
          algorithmId: config.algorithmId
        },
        precomputedIndicators,
        currentTimestampIndex: i,
        compositeRegime: barRegimeResult?.compositeRegime,
        volatilityRegime: barRegimeResult?.volatilityRegime
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
        const err = toErrorInfo(error);
        this.logger.warn(`Algorithm execution failed at ${timestamp.toISOString()}: ${err.message}`);
      }

      // Apply signal throttle
      strategySignals = this.signalThrottle.filterSignals(
        strategySignals,
        throttleState,
        throttleConfig,
        timestamp.getTime()
      );

      // Regime gate + regime-scaled position sizing
      if (btcCoin) {
        const { filteredSignals, barMaxAllocation, barMinAllocation } = this.applyBarRegime(
          strategySignals,
          priceCtx,
          { btcCoin, regimeGateEnabled, enableRegimeScaledSizing, riskLevel },
          { maxAllocation: optAllocLimits.maxAllocation, minAllocation: optAllocLimits.minAllocation },
          barRegimeResult
        );
        strategySignals = filteredSignals;
        optMaxAllocation = barMaxAllocation;
        optMinAllocation = barMinAllocation;
      }

      for (const strategySignal of strategySignals) {
        const dailyVolume = volumeMap.get(`${timestamps[i]}:${strategySignal.coinId}`);

        const tradeResult = await this.executeTrade(
          strategySignal,
          portfolio,
          marketData,
          tradingFee,
          rng,
          slippageConfig,
          dailyVolume,
          BacktestEngine.DEFAULT_MIN_HOLD_MS,
          optMaxAllocation,
          optMinAllocation
        );
        if (tradeResult) {
          trades.push({ ...tradeResult.trade, executedAt: timestamp });
          if (optExitTracker && tradeResult.trade.price != null && tradeResult.trade.quantity != null) {
            if (strategySignal.action === 'BUY') {
              optExitTracker.onBuy(strategySignal.coinId, tradeResult.trade.price, tradeResult.trade.quantity);
            } else if (strategySignal.action === 'SELL') {
              optExitTracker.onSell(strategySignal.coinId, tradeResult.trade.quantity);
            }
          }
        }
      }

      // Track peak and drawdown
      if (portfolio.totalValue > peakValue) {
        peakValue = portfolio.totalValue;
      }
      const currentDrawdown = peakValue === 0 ? 0 : Math.max(0, (peakValue - portfolio.totalValue) / peakValue);
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

    // Only clear mutable state — immutable data is shared across combos
    priceCtx.indexByCoin.clear();
    priceCtx.windowsByCoin.clear();
    priceCtx.btcRegimeSma = undefined;
    priceCtx.btcCoinId = undefined;

    return this.calculateOptimizationMetrics(
      trades,
      snapshots,
      portfolio.totalValue,
      maxDrawdown,
      initialCapital,
      config.startDate,
      config.endDate
    );
  }

  /**
   * Find the index of the first candle with timestamp >= target.
   * Candles array must be sorted by timestamp ascending.
   */
  private static binarySearchLeft(candles: OHLCCandle[], targetTime: number): number {
    let lo = 0;
    let hi = candles.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (candles[mid].timestamp.getTime() < targetTime) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /**
   * Find the index of the first candle with timestamp > target.
   * Candles array must be sorted by timestamp ascending.
   */
  private static binarySearchRight(candles: OHLCCandle[], targetTime: number): number {
    let lo = 0;
    let hi = candles.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (candles[mid].timestamp.getTime() <= targetTime) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /**
   * Precompute indicator series for all coins ONCE before the timestamp loop.
   * Eliminates per-timestamp IndicatorService calls (MD5 hashing + Redis I/O).
   * Returns a map: coinId → indicatorKey → full padded number array.
   */
  private async precomputeIndicatorsForOptimization(
    config: OptimizationBacktestConfig,
    coins: Coin[],
    priceCtx: PriceTrackingContext
  ): Promise<Record<string, Record<string, Float64Array>> | undefined> {
    let strategy;
    try {
      strategy = await this.algorithmRegistry.getStrategyForAlgorithm(config.algorithmId);
    } catch {
      return undefined;
    }
    if (!strategy?.getIndicatorRequirements) return undefined;

    const requirements = strategy.getIndicatorRequirements(config.parameters);
    if (requirements.length === 0) return undefined;

    const result: Record<string, Record<string, Float64Array>> = {};

    // Instantiate calculators once
    const emaCalc = new EMACalculator();
    const smaCalc = new SMACalculator();
    const rsiCalc = new RSICalculator();
    const macdCalc = new MACDCalculator();
    const bbCalc = new BollingerBandsCalculator();
    const atrCalc = new ATRCalculator();

    for (const coin of coins) {
      const summaries = priceCtx.summariesByCoin.get(coin.id);
      if (!summaries || summaries.length === 0) continue;

      const coinIndicators: Record<string, Float64Array> = {};
      const avgPrices = summaries.map((s) => s.avg);
      const highPrices = summaries.map((s) => s.high);
      const lowPrices = summaries.map((s) => s.low);

      for (const req of requirements) {
        // Resolve parameter values from config, falling back to defaults
        const resolveParam = (key: string): number => {
          const val = config.parameters[key];
          return typeof val === 'number' && isFinite(val) ? val : req.defaultParams[key];
        };

        try {
          switch (req.type) {
            case 'EMA': {
              const periodKey = req.paramKeys[0];
              const period = resolveParam(periodKey);
              const key = `ema_${period}`;
              if (!coinIndicators[key] && avgPrices.length >= period) {
                const raw = emaCalc.calculate({ values: avgPrices, period });
                coinIndicators[key] = this.padIndicatorArray(raw, avgPrices.length);
              }
              break;
            }
            case 'SMA': {
              const periodKey = req.paramKeys[0];
              const period = resolveParam(periodKey);
              const key = `sma_${period}`;
              if (!coinIndicators[key] && avgPrices.length >= period) {
                const raw = smaCalc.calculate({ values: avgPrices, period });
                coinIndicators[key] = this.padIndicatorArray(raw, avgPrices.length);
              }
              break;
            }
            case 'RSI': {
              const periodKey = req.paramKeys[0];
              const period = resolveParam(periodKey);
              const key = `rsi_${period}`;
              if (!coinIndicators[key] && avgPrices.length > period) {
                const raw = rsiCalc.calculate({ values: avgPrices, period });
                coinIndicators[key] = this.padIndicatorArray(raw, avgPrices.length);
              }
              break;
            }
            case 'MACD': {
              const fast = resolveParam(req.paramKeys[0]);
              const slow = resolveParam(req.paramKeys[1]);
              const signal = resolveParam(req.paramKeys[2]);
              const baseKey = `macd_${fast}_${slow}_${signal}`;
              if (!coinIndicators[`${baseKey}_macd`] && avgPrices.length >= slow + signal - 1) {
                const raw = macdCalc.calculate({
                  values: avgPrices,
                  fastPeriod: fast,
                  slowPeriod: slow,
                  signalPeriod: signal
                });
                const len = avgPrices.length;
                coinIndicators[`${baseKey}_macd`] = this.padIndicatorArray(
                  raw.map((r) => r.MACD ?? NaN),
                  len
                );
                coinIndicators[`${baseKey}_signal`] = this.padIndicatorArray(
                  raw.map((r) => r.signal ?? NaN),
                  len
                );
                coinIndicators[`${baseKey}_histogram`] = this.padIndicatorArray(
                  raw.map((r) => r.histogram ?? NaN),
                  len
                );
              }
              break;
            }
            case 'BOLLINGER_BANDS': {
              const period = resolveParam(req.paramKeys[0]);
              const stdDev = resolveParam(req.paramKeys[1]);
              const baseKey = `bb_${period}_${stdDev}`;
              if (!coinIndicators[`${baseKey}_upper`] && avgPrices.length >= period) {
                const raw = bbCalc.calculate({ values: avgPrices, period, stdDev });
                const len = avgPrices.length;
                coinIndicators[`${baseKey}_upper`] = this.padIndicatorArray(
                  raw.map((r) => r.upper),
                  len
                );
                coinIndicators[`${baseKey}_middle`] = this.padIndicatorArray(
                  raw.map((r) => r.middle),
                  len
                );
                coinIndicators[`${baseKey}_lower`] = this.padIndicatorArray(
                  raw.map((r) => r.lower),
                  len
                );
                coinIndicators[`${baseKey}_pb`] = this.padIndicatorArray(
                  raw.map((r) => r.pb ?? NaN),
                  len
                );
                coinIndicators[`${baseKey}_bandwidth`] = this.padIndicatorArray(
                  raw.map((r) => (r.middle !== 0 ? (r.upper - r.lower) / r.middle : NaN)),
                  len
                );
              }
              break;
            }
            case 'ATR': {
              const periodKey = req.paramKeys[0];
              const period = resolveParam(periodKey);
              const key = `atr_${period}`;
              if (!coinIndicators[key] && avgPrices.length > period) {
                const raw = atrCalc.calculate({ high: highPrices, low: lowPrices, close: avgPrices, period });
                coinIndicators[key] = this.padIndicatorArray(raw, avgPrices.length);
              }
              break;
            }
          }
        } catch {
          // Skip indicators that fail to compute (e.g., insufficient data)
        }
      }

      if (Object.keys(coinIndicators).length > 0) {
        result[coin.id] = coinIndicators;
      }
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  /** Pad indicator results with NaN at the front to align with the full price series length. */
  private padIndicatorArray(values: number[], targetLength: number): Float64Array {
    const padded = new Float64Array(targetLength);
    const padding = targetLength - values.length;
    if (padding > 0) {
      padded.fill(NaN, 0, padding);
    }
    padded.set(padding > 0 ? values : values.slice(0, targetLength), Math.max(0, padding));
    return padded;
  }

  /**
   * Core optimization backtest logic shared by both public entry points.
   */
  private async runOptimizationBacktestCore(
    config: OptimizationBacktestConfig,
    coins: Coin[],
    historicalPrices: OHLCCandle[]
  ): Promise<OptimizationBacktestResult> {
    const initialCapital = config.initialCapital ?? 10000;
    const tradingFee = config.tradingFee ?? 0.001;
    const hardStopLossPercent = config.hardStopLossPercent ?? 0.05;
    const slippageConfig = config.slippage ?? DEFAULT_SLIPPAGE_CONFIG;
    const deterministicSeed = `optimization-${config.algorithmId}-${Date.now()}`;

    // Exit tracker for core optimization (lightweight — no signal/fill recording)
    const coreExitTracker = this.resolveExitTracker({
      exitConfig: config.exitConfig,
      enableHardStopLoss: true,
      hardStopLossPercent
    });

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

    const coinIds = coins.map((coin) => coin.id);
    const pricesByTimestamp = this.groupPricesByTimestamp(historicalPrices);
    const timestamps = Object.keys(pricesByTimestamp).sort();

    const priceCtx = this.initPriceTracking(historicalPrices, coinIds);

    // Precompute indicators once for the full price series (bypass Redis)
    const precomputedIndicators = await this.precomputeIndicatorsForOptimization(config, coins, priceCtx);

    // Precompute volume lookup: timestamp+coinId → volume (avoids .find() per signal)
    const volumeMap = new Map<string, number>();
    for (const tsKey of timestamps) {
      for (const candle of pricesByTimestamp[tsKey]) {
        if (candle.volume != null) {
          volumeMap.set(`${tsKey}:${candle.coinId}`, candle.volume);
        }
      }
    }

    // Position sizing for OPTIMIZE stage
    const optAllocLimits = getAllocationLimits(PipelineStage.OPTIMIZE, config.riskLevel, {
      maxAllocation: config.maxAllocation,
      minAllocation: config.minAllocation
    });
    let optMaxAllocation = optAllocLimits.maxAllocation;
    let optMinAllocation = optAllocLimits.minAllocation;

    // Regime gate + scaled sizing for optimization
    const { enableRegimeScaledSizing, riskLevel, regimeGateEnabled, btcCoin } = this.resolveRegimeConfigForOptimization(
      config,
      coins,
      priceCtx
    );

    let peakValue = initialCapital;
    let maxDrawdown = 0;

    // Signal throttle: resolve config from optimization parameters
    const throttleConfig = this.signalThrottle.resolveConfig(config.parameters);
    const throttleState = this.signalThrottle.createState();

    // Reusable price map to avoid new Map() allocation per iteration
    const currentPriceMap = new Map<string, number>();

    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = new Date(timestamps[i]);
      const currentPrices = pricesByTimestamp[timestamps[i]];

      // Reuse price map instead of allocating a new one each iteration
      currentPriceMap.clear();
      for (const price of currentPrices) {
        currentPriceMap.set(price.coinId, this.getPriceValue(price));
      }

      const marketData: MarketData = {
        timestamp,
        prices: currentPriceMap
      };

      portfolio = this.portfolioState.updateValues(portfolio, marketData.prices);

      const priceData = this.advancePriceWindows(priceCtx, coins, timestamp);

      // Lightweight exit tracker check for core optimization (no signal/fill recording)
      if (coreExitTracker) {
        await this.processExitSignals({
          exitTracker: coreExitTracker,
          currentPrices,
          marketData,
          portfolio,
          tradingFee,
          rng,
          timestamp,
          trades,
          slippageConfig
        });
      }

      // Compute regime for context + filtering
      const barRegimeResult = btcCoin ? this.computeCompositeRegime(btcCoin.id, priceCtx) : null;

      // Build algorithm context with optimization parameters
      // Lazy positions snapshot: only build when positions exist
      const positions =
        portfolio.positions.size > 0
          ? Object.fromEntries([...portfolio.positions.entries()].map(([id, position]) => [id, position.quantity]))
          : {};

      const context = {
        coins,
        priceData,
        timestamp,
        config: config.parameters,
        positions,
        availableBalance: portfolio.cashBalance,
        metadata: {
          isOptimization: true,
          algorithmId: config.algorithmId
        },
        precomputedIndicators,
        currentTimestampIndex: i,
        compositeRegime: barRegimeResult?.compositeRegime,
        volatilityRegime: barRegimeResult?.volatilityRegime
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

      // Regime gate + regime-scaled position sizing
      if (btcCoin) {
        const { filteredSignals, barMaxAllocation, barMinAllocation } = this.applyBarRegime(
          strategySignals,
          priceCtx,
          { btcCoin, regimeGateEnabled, enableRegimeScaledSizing, riskLevel },
          { maxAllocation: optAllocLimits.maxAllocation, minAllocation: optAllocLimits.minAllocation },
          barRegimeResult
        );
        strategySignals = filteredSignals;
        optMaxAllocation = barMaxAllocation;
        optMinAllocation = barMinAllocation;
      }

      for (const strategySignal of strategySignals) {
        // Use precomputed volume map instead of .find() per signal
        const dailyVolume = volumeMap.get(`${timestamps[i]}:${strategySignal.coinId}`);

        const tradeResult = await this.executeTrade(
          strategySignal,
          portfolio,
          marketData,
          tradingFee,
          rng,
          slippageConfig,
          dailyVolume,
          BacktestEngine.DEFAULT_MIN_HOLD_MS,
          optMaxAllocation,
          optMinAllocation
        );
        if (tradeResult) {
          trades.push({ ...tradeResult.trade, executedAt: timestamp });
          if (coreExitTracker && tradeResult.trade.price != null && tradeResult.trade.quantity != null) {
            if (strategySignal.action === 'BUY') {
              coreExitTracker.onBuy(strategySignal.coinId, tradeResult.trade.price, tradeResult.trade.quantity);
            } else if (strategySignal.action === 'SELL') {
              coreExitTracker.onSell(strategySignal.coinId, tradeResult.trade.quantity);
            }
          }
        }
      }

      // Track peak and drawdown
      if (portfolio.totalValue > peakValue) {
        peakValue = portfolio.totalValue;
      }
      const currentDrawdown = peakValue === 0 ? 0 : Math.max(0, (peakValue - portfolio.totalValue) / peakValue);
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

    return this.calculateOptimizationMetrics(
      trades,
      snapshots,
      portfolio.totalValue,
      maxDrawdown,
      initialCapital,
      config.startDate,
      config.endDate
    );
  }

  /**
   * Calculate final metrics for an optimization backtest run.
   * Shared between runOptimizationBacktestWithPrecomputed and runOptimizationBacktestCore.
   */
  private calculateOptimizationMetrics(
    trades: Partial<BacktestTrade>[],
    snapshots: { portfolioValue: number; timestamp: Date }[],
    finalPortfolioValue: number,
    maxDrawdown: number,
    initialCapital: number,
    startDate: Date,
    endDate: Date
  ): OptimizationBacktestResult {
    const finalValue = finalPortfolioValue;
    const totalReturn = (finalValue - initialCapital) / initialCapital;
    const totalTrades = trades.length;

    const sellTrades = trades.filter((t) => t.type === TradeType.SELL);
    const winningTrades = sellTrades.filter((t) => (t.realizedPnL ?? 0) > 0).length;
    const sellTradeCount = sellTrades.length;
    const winRate = sellTradeCount > 0 ? winningTrades / sellTradeCount : 0;

    const durationDays = dayjs(endDate).diff(dayjs(startDate), 'day');
    const annualizedReturn = durationDays > 0 ? Math.pow(1 + totalReturn, 365 / durationDays) - 1 : totalReturn;

    const returns: number[] = [];
    for (let i = 1; i < snapshots.length; i++) {
      const previous = snapshots[i - 1].portfolioValue;
      const current = snapshots[i].portfolioValue;
      returns.push(previous === 0 ? 0 : (current - previous) / previous);
    }

    const avgReturn = returns.length > 0 ? returns.reduce((sum, r) => sum + r, 0) / returns.length : 0;
    const variance =
      returns.length > 0 ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length : 0;
    const volatility = Math.sqrt(variance) * Math.sqrt(252);

    const periodRiskFreeRate = 0.02 / 252;
    const downsideReturns = returns.filter((r) => r < periodRiskFreeRate);
    const downsideVariance =
      returns.length > 0
        ? downsideReturns.reduce((sum, r) => sum + Math.pow(r - periodRiskFreeRate, 2), 0) / returns.length
        : 0;
    const downsideDeviation = Math.sqrt(downsideVariance) * Math.sqrt(252);

    const sharpeRatio = this.metricsCalculator.calculateSharpeRatio(returns, {
      timeframe: TimeframeType.DAILY,
      useCryptoCalendar: false,
      riskFreeRate: 0.02
    });

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
      profitFactor: Math.min(profitFactor, 10),
      tradeCount: totalTrades,
      annualizedReturn,
      finalValue,
      downsideDeviation
    };
  }
}
