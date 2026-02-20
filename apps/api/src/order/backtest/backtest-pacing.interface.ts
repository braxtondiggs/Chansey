import { ReplaySpeed } from '@chansey/api-interfaces';

import { BacktestCheckpointState } from './backtest-checkpoint.interface';
import { BacktestFinalMetrics } from './backtest-result.service';
import { BacktestPerformanceSnapshot, BacktestSignal, BacktestTrade, SimulatedOrderFill } from './backtest.entity';
import { MarketDataSet } from './market-data-set.entity';

// Re-export ReplaySpeed for convenience
export { ReplaySpeed };

/**
 * Default replay speed for live replay backtests.
 */
export const DEFAULT_REPLAY_SPEED = ReplaySpeed.FAST_5X;

/**
 * Default base interval in milliseconds (1 second).
 * The actual delay is calculated as: baseIntervalMs / replaySpeed
 */
export const DEFAULT_BASE_INTERVAL_MS = 1000;

/**
 * Default checkpoint interval for live replay (more frequent than historical).
 */
export const DEFAULT_LIVE_REPLAY_CHECKPOINT_INTERVAL = 100;

/**
 * Results accumulated during checkpoint intervals.
 * Contains incremental data since the last checkpoint for persistence.
 */
export interface CheckpointResults {
  /** Trades executed since last checkpoint */
  trades: Partial<BacktestTrade>[];
  /** Signals generated since last checkpoint */
  signals: Partial<BacktestSignal>[];
  /** Simulated order fills since last checkpoint */
  simulatedFills: Partial<SimulatedOrderFill>[];
  /** Performance snapshots since last checkpoint */
  snapshots: Partial<BacktestPerformanceSnapshot>[];
}

/**
 * Callback invoked at each checkpoint interval during live replay execution.
 * Use this to persist incremental results and checkpoint state for resume capability.
 *
 * @param state - Current checkpoint state containing portfolio, RNG state, and progress info
 * @param results - Incremental results (trades, signals, fills, snapshots) since last checkpoint
 * @param totalTimestamps - Total number of timestamps in the backtest (for progress calculation)
 */
export type CheckpointCallback = (
  state: BacktestCheckpointState,
  results: CheckpointResults,
  totalTimestamps: number
) => Promise<void>;

/**
 * Callback invoked when the backtest is paused (user-requested or error).
 * Use this to persist the final checkpoint state before the processor exits.
 *
 * @param state - Checkpoint state at the point of pause, can be used for resume
 */
export type PauseCallback = (state: BacktestCheckpointState) => Promise<void>;

/**
 * Options for executing a live replay backtest with real-time pacing.
 */
export interface LiveReplayExecuteOptions {
  /** Market data set containing historical price data */
  dataset: MarketDataSet;

  /** Deterministic seed for reproducible random number generation */
  deterministicSeed: string;

  /** Whether to publish telemetry metrics during execution */
  telemetryEnabled?: boolean;

  /** Replay speed multiplier (default: FAST_5X) */
  replaySpeed: ReplaySpeed;

  /** Base interval in milliseconds before speed multiplier (default: 1000ms) */
  baseIntervalMs?: number;

  /** Minimum time a position must be held before selling (ms). Default: 24h.
   *  Risk-control signals (STOP_LOSS, TAKE_PROFIT) always bypass this. */
  minHoldMs?: number;

  /** Maximum allocation per trade as fraction of portfolio (0-1). Default: 0.12 (12%) */
  maxAllocation?: number;
  /** Minimum allocation per trade as fraction of portfolio (0-1). Default: 0.03 (3%) */
  minAllocation?: number;

  /** Enable mandatory hard stop-loss for all positions (default: true) */
  enableHardStopLoss?: boolean;
  /** Hard stop-loss threshold as a fraction (0-1). Default: 0.05 (5% loss triggers exit) */
  hardStopLossPercent?: number;

  /** Number of timestamps between checkpoints (default: 100 for live replay) */
  checkpointInterval?: number;

  /** Callback invoked at each checkpoint */
  onCheckpoint?: CheckpointCallback;

  /** Lightweight callback for progress updates (called at most every ~30 seconds) */
  onHeartbeat?: (index: number, totalTimestamps: number) => Promise<void>;

  /** Checkpoint state to resume from (if resuming a previous run) */
  resumeFrom?: BacktestCheckpointState;

  /** Function to check if backtest should pause (returns true to pause) */
  shouldPause?: () => Promise<boolean>;

  /** Callback invoked when backtest is paused (for state persistence) */
  onPaused?: PauseCallback;
}

/**
 * Result from a live replay backtest execution.
 */
export interface LiveReplayExecuteResult {
  trades: Partial<BacktestTrade>[];
  signals: Partial<BacktestSignal>[];
  simulatedFills: Partial<SimulatedOrderFill>[];
  snapshots: Partial<BacktestPerformanceSnapshot>[];
  finalMetrics: BacktestFinalMetrics;
  /** True if the backtest was paused (not completed) */
  paused?: boolean;
  /** Checkpoint state at the point of pause (if paused) */
  pausedCheckpoint?: BacktestCheckpointState;
}

/**
 * Calculates the delay in milliseconds based on replay speed.
 *
 * @param speed - The replay speed multiplier
 * @param baseIntervalMs - Base interval in milliseconds (default: 1000)
 * @returns Delay in milliseconds, or 0 for MAX_SPEED
 */
export function calculateReplayDelay(speed: ReplaySpeed, baseIntervalMs: number = DEFAULT_BASE_INTERVAL_MS): number {
  if (speed === ReplaySpeed.MAX_SPEED) {
    return 0;
  }
  return Math.round(baseIntervalMs / speed);
}

/**
 * Live replay state stored in the backtest entity for pause/resume.
 */
export interface LiveReplayState {
  /** Current replay speed setting */
  replaySpeed: ReplaySpeed;

  /** Whether the backtest is currently paused */
  isPaused: boolean;

  /** Timestamp when paused (if paused) */
  pausedAt?: string;

  /** Reason for pause (if paused) */
  pauseReason?: 'user_requested' | 'error' | 'checkpoint';
}
