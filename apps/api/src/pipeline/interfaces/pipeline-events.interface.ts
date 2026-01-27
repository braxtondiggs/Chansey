import { PipelineStage, PipelineStatus } from './pipeline-config.interface';

/**
 * Event payload for optimization completion
 */
export interface OptimizationCompletedEvent {
  runId: string;
  strategyConfigId: string;
  bestParameters: Record<string, unknown>;
  bestScore: number;
  improvement: number;
}

/**
 * Event payload for backtest completion
 */
export interface BacktestCompletedEvent {
  backtestId: string;
  type: 'HISTORICAL' | 'LIVE_REPLAY';
  metrics: {
    sharpeRatio: number;
    totalReturn: number;
    maxDrawdown: number;
    winRate: number;
    totalTrades: number;
  };
}

/**
 * Event payload for paper trading completion
 */
export interface PaperTradingCompletedEvent {
  sessionId: string;
  pipelineId: string;
  metrics: {
    initialCapital: number;
    currentPortfolioValue: number;
    totalReturn: number;
    totalReturnPercent: number;
    maxDrawdown: number;
    sharpeRatio?: number;
    winRate: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    totalFees: number;
    durationHours: number;
  };
  stoppedReason?: string;
}

/**
 * Pipeline stage transition event
 */
export interface PipelineStageTransitionEvent {
  pipelineId: string;
  previousStage: PipelineStage;
  newStage: PipelineStage;
  timestamp: string;
}

/**
 * Pipeline status change event
 */
export interface PipelineStatusChangeEvent {
  pipelineId: string;
  previousStatus: PipelineStatus;
  newStatus: PipelineStatus;
  reason?: string;
  timestamp: string;
}

/**
 * Pipeline progress update event
 */
export interface PipelineProgressEvent {
  pipelineId: string;
  stage: PipelineStage;
  progress: number; // 0-100
  message?: string;
  timestamp: string;
}

/**
 * WebSocket event types
 */
export type PipelineWebSocketEvent =
  | 'stage_transition'
  | 'progress'
  | 'status'
  | 'metrics'
  | 'recommendation'
  | 'error';

/**
 * WebSocket payload structure
 */
export interface PipelineWebSocketPayload {
  event: PipelineWebSocketEvent;
  pipelineId: string;
  data: unknown;
  timestamp: string;
}

/**
 * Event names used in the event emitter
 */
export const PIPELINE_EVENTS = {
  OPTIMIZATION_COMPLETED: 'optimization.completed',
  BACKTEST_COMPLETED: 'backtest.completed',
  PAPER_TRADING_COMPLETED: 'paper-trading.completed',
  PIPELINE_STAGE_TRANSITION: 'pipeline.stage-transition',
  PIPELINE_STATUS_CHANGE: 'pipeline.status-change',
  PIPELINE_PROGRESS: 'pipeline.progress',
  PIPELINE_COMPLETED: 'pipeline.completed',
  PIPELINE_FAILED: 'pipeline.failed'
} as const;
