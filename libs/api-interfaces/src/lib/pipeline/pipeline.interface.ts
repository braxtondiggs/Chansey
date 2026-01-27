/**
 * Pipeline Shared Interfaces
 * Used by both API and frontend for type consistency
 */

export enum PipelineStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

export enum PipelineStage {
  OPTIMIZE = 'OPTIMIZE',
  HISTORICAL = 'HISTORICAL',
  LIVE_REPLAY = 'LIVE_REPLAY',
  PAPER_TRADE = 'PAPER_TRADE',
  COMPLETED = 'COMPLETED'
}

export enum DeploymentRecommendation {
  DEPLOY = 'DEPLOY',
  NEEDS_REVIEW = 'NEEDS_REVIEW',
  DO_NOT_DEPLOY = 'DO_NOT_DEPLOY'
}

/**
 * Stage configuration types
 */
export interface OptimizationStageConfig {
  trainDays: number;
  testDays: number;
  stepDays: number;
  objectiveMetric: 'sharpe_ratio' | 'total_return' | 'sortino_ratio' | 'composite';
  maxCombinations?: number;
  earlyStop?: boolean;
  patience?: number;
}

export interface HistoricalStageConfig {
  startDate: string;
  endDate: string;
  initialCapital: number;
  tradingFee?: number;
  marketDataSetId?: string;
}

export interface LiveReplayStageConfig {
  startDate: string;
  endDate: string;
  initialCapital: number;
  tradingFee?: number;
  marketDataSetId?: string;
  enablePacing?: boolean;
  pacingSpeed?: number;
}

export interface PaperTradingStageConfig {
  initialCapital: number;
  duration: string;
  tradingFee?: number;
  stopConditions?: {
    maxDrawdown?: number;
    targetReturn?: number;
  };
  tickIntervalMs?: number;
}

export interface PipelineStageConfig {
  optimization: OptimizationStageConfig;
  historical: HistoricalStageConfig;
  liveReplay: LiveReplayStageConfig;
  paperTrading: PaperTradingStageConfig;
}

/**
 * Progression rules types
 */
export interface StageProgressionThresholds {
  minSharpeRatio?: number;
  maxDrawdown?: number;
  minWinRate?: number;
  minTotalReturn?: number;
  maxDegradation?: number;
}

export interface PipelineProgressionRules {
  optimization: { minImprovement: number };
  historical: StageProgressionThresholds;
  liveReplay: StageProgressionThresholds;
  paperTrading: StageProgressionThresholds;
}

/**
 * Stage results types
 */
export interface BaseStageMetrics {
  sharpeRatio: number;
  totalReturn: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
}

export interface OptimizationStageResult {
  runId: string;
  status: 'COMPLETED' | 'FAILED';
  bestParameters: Record<string, unknown>;
  bestScore: number;
  baselineScore: number;
  improvement: number;
  combinationsTested: number;
  totalCombinations: number;
  duration: number;
  completedAt: string;
}

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
  degradationFromHistorical?: number;
  duration: number;
  completedAt: string;
}

export interface PaperTradingStageResult extends BaseStageMetrics {
  sessionId: string;
  status: 'COMPLETED' | 'STOPPED' | 'FAILED';
  initialCapital: number;
  finalValue: number;
  totalFees: number;
  degradationFromLiveReplay?: number;
  stoppedReason?: string;
  durationHours: number;
  completedAt: string;
}

export interface PipelineStageResults {
  optimization?: OptimizationStageResult;
  historical?: HistoricalStageResult;
  liveReplay?: LiveReplayStageResult;
  paperTrading?: PaperTradingStageResult;
}

/**
 * Summary report types
 */
export type PipelineWarning =
  | 'HIGH_DEGRADATION'
  | 'INCONSISTENT_METRICS'
  | 'LOW_TRADE_COUNT'
  | 'HIGH_DRAWDOWN'
  | 'POOR_WIN_RATE'
  | 'NEGATIVE_RETURN'
  | 'OVERFITTING_SUSPECTED';

export interface StageComparison {
  stage: PipelineStage;
  sharpeRatio: number;
  totalReturn: number;
  maxDrawdown: number;
  winRate: number;
  degradationFromPrevious?: number;
}

export interface PipelineSummaryReport {
  pipelineId: string;
  strategyConfigId: string;
  strategyName: string;
  recommendation: DeploymentRecommendation;
  confidenceScore: number;
  deployableParameters: Record<string, unknown>;
  stageComparison: StageComparison[];
  averageMetrics: {
    sharpeRatio: number;
    totalReturn: number;
    maxDrawdown: number;
    winRate: number;
  };
  consistencyScore: number;
  warnings: PipelineWarning[];
  warningDetails: string[];
  totalDurationHours: number;
  generatedAt: string;
}

/**
 * API response types
 */
export interface PipelineSummary {
  id: string;
  name: string;
  description?: string;
  status: PipelineStatus;
  currentStage: PipelineStage;
  strategyConfigId: string;
  strategyName: string;
  recommendation?: DeploymentRecommendation;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PipelineDetail extends PipelineSummary {
  exchangeKeyId: string;
  exchangeName: string;
  optimizationRunId?: string;
  historicalBacktestId?: string;
  liveReplayBacktestId?: string;
  paperTradingSessionId?: string;
  stageConfig: PipelineStageConfig;
  progressionRules: PipelineProgressionRules;
  optimizedParameters?: Record<string, unknown>;
  stageResults?: PipelineStageResults;
  summaryReport?: PipelineSummaryReport;
  failureReason?: string;
  updatedAt: string;
}

export interface PipelineListResponse {
  data: PipelineSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface PipelineProgress {
  pipelineId: string;
  status: PipelineStatus;
  currentStage: PipelineStage;
  overallProgress: number;
  stageProgress?: {
    optimization?: { combinationsTested: number; totalCombinations: number; percentComplete: number };
    historical?: { processed: number; total: number; percentComplete: number };
    liveReplay?: { processed: number; total: number; percentComplete: number };
    paperTrading?: { tickCount: number; elapsedTime: number; remainingTime?: number };
  };
  lastUpdated: string;
}

/**
 * WebSocket event types
 */
export interface PipelineStatusEvent {
  pipelineId: string;
  status: string;
  stage?: PipelineStage;
  message?: string;
  timestamp: string;
}

export interface PipelineProgressEvent {
  pipelineId: string;
  stage: PipelineStage;
  progress: number;
  message?: string;
  timestamp: string;
}

export interface PipelineStageTransitionEvent {
  pipelineId: string;
  previousStage: PipelineStage;
  newStage: PipelineStage;
  timestamp: string;
}

export interface PipelineMetricsEvent {
  pipelineId: string;
  stage: PipelineStage;
  metrics: Record<string, unknown>;
  timestamp: string;
}

export interface PipelineRecommendationEvent {
  pipelineId: string;
  recommendation: DeploymentRecommendation;
  timestamp: string;
}
