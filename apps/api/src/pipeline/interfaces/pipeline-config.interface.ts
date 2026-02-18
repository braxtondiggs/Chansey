/**
 * Pipeline Status Enum
 * Tracks the overall state of the pipeline execution
 */
export enum PipelineStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

/**
 * Pipeline Stage Enum
 * Represents the current stage in the pipeline workflow
 */
export enum PipelineStage {
  OPTIMIZE = 'OPTIMIZE',
  HISTORICAL = 'HISTORICAL',
  LIVE_REPLAY = 'LIVE_REPLAY',
  PAPER_TRADE = 'PAPER_TRADE',
  COMPLETED = 'COMPLETED'
}

/**
 * Deployment Recommendation Enum
 * Final recommendation after all stages complete
 */
export enum DeploymentRecommendation {
  DEPLOY = 'DEPLOY',
  NEEDS_REVIEW = 'NEEDS_REVIEW',
  DO_NOT_DEPLOY = 'DO_NOT_DEPLOY'
}

/**
 * Optimization stage configuration
 */
export interface OptimizationStageConfig {
  /** Walk-forward training period in days */
  trainDays: number;
  /** Walk-forward testing period in days */
  testDays: number;
  /** Step size for rolling windows */
  stepDays: number;
  /** Optimization objective metric */
  objectiveMetric: 'sharpe_ratio' | 'total_return' | 'sortino_ratio' | 'composite';
  /** Maximum parameter combinations to test */
  maxCombinations?: number;
  /** Enable early stopping */
  earlyStop?: boolean;
  /** Patience for early stopping */
  patience?: number;
}

/**
 * Historical backtest stage configuration
 */
export interface HistoricalStageConfig {
  /** Start date for backtest (ISO string) */
  startDate: string;
  /** End date for backtest (ISO string) */
  endDate: string;
  /** Initial capital for backtest */
  initialCapital: number;
  /** Trading fee as decimal (e.g., 0.001 = 0.1%) */
  tradingFee?: number;
  /** Market data set ID (defaults to auto-generated dataset if not provided) */
  marketDataSetId?: string;
}

/**
 * Live replay stage configuration
 */
export interface LiveReplayStageConfig {
  /** Start date for replay (ISO string) */
  startDate: string;
  /** End date for replay (ISO string) */
  endDate: string;
  /** Initial capital for replay */
  initialCapital: number;
  /** Trading fee as decimal */
  tradingFee?: number;
  /** Market data set ID (defaults to auto-generated dataset if not provided) */
  marketDataSetId?: string;
  /** Enable real-time pacing */
  enablePacing?: boolean;
  /** Pacing speed multiplier (1 = real-time) */
  pacingSpeed?: number;
}

/**
 * Paper trading stage configuration
 */
export interface PaperTradingStageConfig {
  /** Initial capital for paper trading */
  initialCapital: number;
  /** Duration string (e.g., '7d', '30d', '3m') */
  duration: string;
  /** Trading fee as decimal */
  tradingFee?: number;
  /** Auto-stop conditions */
  stopConditions?: {
    /** Stop if drawdown exceeds this percentage (e.g., 0.25 = 25%) */
    maxDrawdown?: number;
    /** Stop if return reaches target (e.g., 0.20 = 20%) */
    targetReturn?: number;
  };
  /** Tick interval in milliseconds */
  tickIntervalMs?: number;
}

/**
 * Combined stage configuration
 */
export interface PipelineStageConfig {
  optimization: OptimizationStageConfig;
  historical: HistoricalStageConfig;
  liveReplay: LiveReplayStageConfig;
  paperTrading: PaperTradingStageConfig;
}

/**
 * Stage-specific progression thresholds
 */
export interface StageProgressionThresholds {
  /** Minimum Sharpe ratio to pass */
  minSharpeRatio?: number;
  /** Maximum drawdown allowed (e.g., 0.25 = 25%) */
  maxDrawdown?: number;
  /** Minimum win rate (e.g., 0.45 = 45%) */
  minWinRate?: number;
  /** Minimum total return */
  minTotalReturn?: number;
  /** Minimum improvement over previous stage (percentage) */
  minImprovement?: number;
  /** Maximum degradation from previous stage (percentage) */
  maxDegradation?: number;
  /** Minimum total trades required (opt-in) */
  minTotalTrades?: number;
}

/**
 * Progression rules for all stages
 */
export interface PipelineProgressionRules {
  optimization: {
    /** Minimum improvement over baseline (percentage) */
    minImprovement: number;
  };
  paperTrading: StageProgressionThresholds;
  /** Minimum composite score (0-100) to pass LIVE_REPLAY gate. Default: 30 */
  minimumPipelineScore?: number;
}

/**
 * Default progression rules
 */
export const DEFAULT_PROGRESSION_RULES: PipelineProgressionRules = {
  optimization: {
    minImprovement: 3 // 3% improvement over baseline
  },
  paperTrading: {
    minSharpeRatio: 0.3,
    maxDrawdown: 0.45,
    minTotalReturn: 0 // At least break even
  },
  minimumPipelineScore: 30 // Score-based gate at LIVE_REPLAY stage
};
