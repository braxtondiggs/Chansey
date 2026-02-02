import { DeploymentRecommendation, PipelineStage } from './pipeline-config.interface';

/**
 * Common metrics across all trading stages
 */
export interface BaseStageMetrics {
  sharpeRatio: number;
  totalReturn: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
}

/**
 * Optimization stage result
 */
export interface OptimizationStageResult {
  runId: string;
  status: 'COMPLETED' | 'FAILED';
  bestParameters: Record<string, unknown>;
  bestScore: number;
  baselineScore: number;
  improvement: number;
  combinationsTested: number;
  totalCombinations: number;
  duration: number; // in seconds
  completedAt: string;
}

/**
 * Historical backtest stage result
 */
export interface HistoricalStageResult extends BaseStageMetrics {
  backtestId: string;
  status: 'COMPLETED' | 'FAILED';
  initialCapital: number;
  finalValue: number;
  annualizedReturn: number;
  volatility?: number;
  profitFactor?: number;
  winningTrades: number;
  losingTrades: number;
  duration: number;
  completedAt: string;
}

/**
 * Live replay stage result
 */
export interface LiveReplayStageResult extends BaseStageMetrics {
  backtestId: string;
  status: 'COMPLETED' | 'FAILED';
  initialCapital: number;
  finalValue: number;
  annualizedReturn: number;
  volatility?: number;
  profitFactor?: number;
  winningTrades: number;
  losingTrades: number;
  /** Degradation from historical stage (percentage) */
  degradationFromHistorical?: number;
  duration: number;
  completedAt: string;
}

/**
 * Paper trading stage result
 */
export interface PaperTradingStageResult extends BaseStageMetrics {
  sessionId: string;
  status: 'COMPLETED' | 'STOPPED' | 'FAILED';
  initialCapital: number;
  finalValue: number;
  totalFees: number;
  /** Degradation from live replay stage (percentage) */
  degradationFromLiveReplay?: number;
  stoppedReason?: string;
  durationHours: number;
  completedAt: string;
}

/**
 * Combined stage results
 */
export interface PipelineStageResults {
  optimization?: OptimizationStageResult;
  historical?: HistoricalStageResult;
  liveReplay?: LiveReplayStageResult;
  paperTrading?: PaperTradingStageResult;
}

/**
 * Stage comparison metrics for consistency analysis
 */
export interface StageComparison {
  stage: PipelineStage;
  sharpeRatio: number;
  totalReturn: number;
  maxDrawdown: number;
  winRate: number;
  degradationFromPrevious?: number;
}

/**
 * Warning types in summary report
 */
export type PipelineWarning =
  | 'HIGH_DEGRADATION'
  | 'INCONSISTENT_METRICS'
  | 'LOW_TRADE_COUNT'
  | 'HIGH_DRAWDOWN'
  | 'POOR_WIN_RATE'
  | 'NEGATIVE_RETURN'
  | 'OVERFITTING_SUSPECTED';

/**
 * Summary report generated after all stages complete
 */
export interface PipelineSummaryReport {
  pipelineId: string;
  strategyConfigId: string;
  strategyName: string;
  recommendation: DeploymentRecommendation;
  confidenceScore: number; // 0-100

  /** Optimized parameters that should be deployed */
  deployableParameters: Record<string, unknown>;

  /** Comparison of key metrics across all stages */
  stageComparison: StageComparison[];

  /** Average metrics across all execution stages (excl. optimization) */
  averageMetrics: {
    sharpeRatio: number;
    totalReturn: number;
    maxDrawdown: number;
    winRate: number;
  };

  /** Consistency score measuring variance across stages (0-100, higher = more consistent) */
  consistencyScore: number;

  /** Any warnings or anomalies detected */
  warnings: PipelineWarning[];

  /** Detailed warning messages */
  warningDetails: string[];

  /** Total time from start to completion */
  totalDurationHours: number;

  /** Generation timestamp */
  generatedAt: string;
}
