import { type LoopRunnerOptions } from './backtest-loop-runner.types';

import { type Coin } from '../../../../coin/coin.entity';
import { type OHLCCandle } from '../../../../ohlc/ohlc-candle.entity';
import { type OpportunitySellingUserConfig } from '../../../interfaces/opportunity-selling.interface';
import { type AlgorithmWatchdog } from '../../algorithm-watchdog';
import { type LiveReplayExecuteOptions, type ReplaySpeed } from '../../backtest-pacing.interface';
import { type BacktestPerformanceSnapshot } from '../../backtest-performance-snapshot.entity';
import { type BacktestSignal } from '../../backtest-signal.entity';
import { type BacktestTrade } from '../../backtest-trade.entity';
import { type Backtest } from '../../backtest.entity';
import { type SeededRandom } from '../../seeded-random';
import { type SimulatedOrderFill } from '../../simulated-order-fill.entity';
import { type BacktestExitTracker } from '../exits';
import { type MetricsAccumulator } from '../metrics-accumulator';
import { type Portfolio } from '../portfolio';
import { type PriceTrackingContext } from '../price-window';
import { type SlippageConfig } from '../slippage';
import { type SignalThrottleConfig, type ThrottleState } from '../throttle';
import { type TradingSignal } from '../types';

/** Persisted counts across checkpoints for incremental persistence */
export interface PersistedCounts {
  trades: number;
  signals: number;
  fills: number;
  snapshots: number;
  sells?: number;
  winningSells?: number;
  grossProfit?: number;
  grossLoss?: number;
}

/**
 * All required fields for constructing a LoopContext.
 * Used by the factory method to ensure compile-time completeness.
 */
export interface LoopContextInit {
  // Mode & config
  isLiveReplay: boolean;
  liveReplayOpts: (LiveReplayExecuteOptions & { mode: 'live-replay' }) | null;
  checkpointInterval: number;
  delayMs: number;
  slippageConfig: SlippageConfig;
  minHoldMs: number;
  maxAllocation: number;
  minAllocation: number;
  oppSellingEnabled: boolean;
  oppSellingConfig: OpportunitySellingUserConfig;
  algoMetadata: Record<string, unknown>;
  replaySpeed: ReplaySpeed;
  // Regime
  enableRegimeScaledSizing: boolean;
  riskLevel: number;
  regimeGateEnabled: boolean;
  btcCoin: Coin | undefined;
  // Mutable state
  rng: SeededRandom;
  portfolio: Portfolio;
  peakValue: number;
  maxDrawdown: number;
  exitTracker: BacktestExitTracker | null;
  throttleState: ThrottleState;
  throttleConfig: SignalThrottleConfig;
  // Accumulators
  totalPersistedCounts: PersistedCounts;
  metricsAcc: MetricsAccumulator;
  lastCheckpointCounts: PersistedCounts;
  // Iteration tracking
  lastCheckpointIndex: number;
  watchdog: AlgorithmWatchdog;
  // Data references
  backtest: Backtest;
  coins: Coin[];
  coinMap: Map<string, Coin>;
  quoteCoin: Coin;
  priceCtx: PriceTrackingContext;
  pricesByTimestamp: Record<string, OHLCCandle[]>;
  timestamps: string[];
  delistingDates: Map<string, Date>;
  // Boundaries
  effectiveTradingStartIndex: number;
  effectiveTimestampCount: number;
  tradingTimestampCount: number;
  options: LoopRunnerOptions;
  // Precomputed indicators (optional)
  precomputedIndicators?: Record<string, Record<string, Float64Array>>;
}

/**
 * Bundles all loop-scoped mutable state for a backtest run.
 * Eliminates 15+ parameter method signatures by grouping
 * initialization state, accumulators, and data references.
 */
export class LoopContext {
  // Mode & config
  isLiveReplay: boolean;
  liveReplayOpts: (LiveReplayExecuteOptions & { mode: 'live-replay' }) | null;
  checkpointInterval: number;
  delayMs: number;
  slippageConfig: SlippageConfig;
  minHoldMs: number;
  maxAllocation: number;
  minAllocation: number;
  oppSellingEnabled: boolean;
  oppSellingConfig: OpportunitySellingUserConfig;
  algoMetadata: Record<string, unknown>;
  replaySpeed: ReplaySpeed;

  // Regime
  enableRegimeScaledSizing: boolean;
  riskLevel: number;
  regimeGateEnabled: boolean;
  btcCoin: Coin | undefined;

  // Mutable state
  rng: SeededRandom;
  portfolio: Portfolio;
  peakValue: number;
  maxDrawdown: number;
  exitTracker: BacktestExitTracker | null;
  throttleState: ThrottleState;
  throttleConfig: SignalThrottleConfig;

  // Accumulators
  trades: Partial<BacktestTrade>[] = [];
  signals: Partial<BacktestSignal>[] = [];
  simulatedFills: Partial<SimulatedOrderFill>[] = [];
  snapshots: Partial<BacktestPerformanceSnapshot>[] = [];
  totalPersistedCounts: PersistedCounts;
  metricsAcc: MetricsAccumulator;
  lastCheckpointCounts: PersistedCounts;

  // Iteration tracking
  lastCheckpointIndex: number;
  consecutiveErrors = 0;
  watchdog: AlgorithmWatchdog;
  lastHeartbeatTime = Date.now();
  consecutivePauseFailures = 0;
  prevCandleMap = new Map<string, OHLCCandle>();

  /**
   * Strategy signals that passed filtering on bar i and are queued to fill
   * at bar (i+1)'s open price. Eliminates same-bar close lookahead bias.
   * Hard stop-loss signals bypass this buffer and execute in-bar.
   */
  pendingSignals: TradingSignal[] = [];

  // Data references
  backtest: Backtest;
  coins: Coin[];
  coinMap: Map<string, Coin>;
  quoteCoin: Coin;
  priceCtx: PriceTrackingContext;
  pricesByTimestamp: Record<string, OHLCCandle[]>;
  timestamps: string[];
  delistingDates: Map<string, Date>;
  lastKnownPrices = new Map<string, number>();

  // Boundaries
  effectiveTradingStartIndex: number;
  effectiveTimestampCount: number;
  tradingTimestampCount: number;
  options: LoopRunnerOptions;

  // Precomputed indicators (passed into AlgorithmContext per bar)
  precomputedIndicators?: Record<string, Record<string, Float64Array>>;

  private constructor(init: LoopContextInit) {
    this.isLiveReplay = init.isLiveReplay;
    this.liveReplayOpts = init.liveReplayOpts;
    this.checkpointInterval = init.checkpointInterval;
    this.delayMs = init.delayMs;
    this.slippageConfig = init.slippageConfig;
    this.minHoldMs = init.minHoldMs;
    this.maxAllocation = init.maxAllocation;
    this.minAllocation = init.minAllocation;
    this.oppSellingEnabled = init.oppSellingEnabled;
    this.oppSellingConfig = init.oppSellingConfig;
    this.algoMetadata = init.algoMetadata;
    this.replaySpeed = init.replaySpeed;
    this.enableRegimeScaledSizing = init.enableRegimeScaledSizing;
    this.riskLevel = init.riskLevel;
    this.regimeGateEnabled = init.regimeGateEnabled;
    this.btcCoin = init.btcCoin;
    this.rng = init.rng;
    this.portfolio = init.portfolio;
    this.peakValue = init.peakValue;
    this.maxDrawdown = init.maxDrawdown;
    this.exitTracker = init.exitTracker;
    this.throttleState = init.throttleState;
    this.throttleConfig = init.throttleConfig;
    this.totalPersistedCounts = init.totalPersistedCounts;
    this.metricsAcc = init.metricsAcc;
    this.lastCheckpointCounts = init.lastCheckpointCounts;
    this.lastCheckpointIndex = init.lastCheckpointIndex;
    this.watchdog = init.watchdog;
    this.backtest = init.backtest;
    this.coins = init.coins;
    this.coinMap = init.coinMap;
    this.quoteCoin = init.quoteCoin;
    this.priceCtx = init.priceCtx;
    this.pricesByTimestamp = init.pricesByTimestamp;
    this.timestamps = init.timestamps;
    this.delistingDates = init.delistingDates;
    this.effectiveTradingStartIndex = init.effectiveTradingStartIndex;
    this.effectiveTimestampCount = init.effectiveTimestampCount;
    this.tradingTimestampCount = init.tradingTimestampCount;
    this.options = init.options;
    this.precomputedIndicators = init.precomputedIndicators;
  }

  static create(init: LoopContextInit): LoopContext {
    return new LoopContext(init);
  }
}
