/**
 * Position state within a portfolio checkpoint.
 */
export interface CheckpointPosition {
  coinId: string;
  quantity: number;
  averagePrice: number;
}

/**
 * Portfolio state at the time of checkpoint.
 */
export interface CheckpointPortfolio {
  cashBalance: number;
  positions: CheckpointPosition[];
}

/**
 * Counts of persisted results at checkpoint time.
 * Used for reconciliation when resuming.
 */
export interface PersistedResultsCounts {
  trades: number;
  signals: number;
  fills: number;
  snapshots: number;
}

/**
 * Complete checkpoint state for a backtest execution.
 * Stored in the backtest entity's checkpointState JSONB column.
 */
export interface BacktestCheckpointState {
  /** Index in the timestamps array where execution was checkpointed */
  lastProcessedIndex: number;

  /** ISO timestamp string for verification against market data */
  lastProcessedTimestamp: string;

  /** Portfolio state: cash balance and positions */
  portfolio: CheckpointPortfolio;

  /** Peak portfolio value (for drawdown calculation) */
  peakValue: number;

  /** Maximum drawdown observed up to checkpoint */
  maxDrawdown: number;

  /** Internal RNG state for deterministic reproducibility */
  rngState: number;

  /** Counts of results persisted to database at checkpoint time */
  persistedCounts: PersistedResultsCounts;

  /** SHA256 checksum (first 16 chars) for data integrity verification */
  checksum: string;
}

/**
 * Configuration options for checkpoint behavior.
 */
export interface CheckpointConfig {
  /** Number of timestamps between checkpoints (default: 100) */
  checkpointInterval: number;

  /** Maximum age of checkpoint before forcing restart (milliseconds, default: 7 days) */
  maxCheckpointAge: number;
}

/**
 * Default checkpoint configuration values.
 */
export const DEFAULT_CHECKPOINT_CONFIG: CheckpointConfig = {
  checkpointInterval: 100,
  maxCheckpointAge: 7 * 24 * 60 * 60 * 1000 // 7 days
};
