import { type CompositeRegimeType, type MarketRegimeType } from '@chansey/api-interfaces';

import { type PipelineStage, type PipelineStatus } from './pipeline-config.interface';

import { type TradingStyle } from '../../algorithm/interfaces/trading-style.enum';

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
 * Event payload for optimization failure (stale watchdog or error)
 */
export interface OptimizationFailedEvent {
  runId: string;
  reason: string;
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
    winningTrades: number;
    losingTrades: number;
    profitFactor: number;
    volatility: number;
  };
}

/**
 * Event payload for backtest failure (stale watchdog or error)
 */
export interface BacktestFailedEvent {
  backtestId: string;
  type: 'HISTORICAL' | 'LIVE_REPLAY';
  reason: string;
}

/**
 * Event payload for paper trading failure (stale watchdog or error)
 */
export interface PaperTradingFailedEvent {
  sessionId: string;
  pipelineId: string;
  reason: string;
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
 * Event payload emitted when the regime fitness gate skips a strategy
 * before any pipeline is created.
 */
export interface PipelineRegimeSkippedEvent {
  userId: string;
  strategyConfigId: string;
  strategyId: string;
  strategyName: string;
  style?: TradingStyle;
  universeRegime: CompositeRegimeType;
  perCoin: Record<string, { composite: CompositeRegimeType; volatility: MarketRegimeType | null }>;
  reason: string;
}

/**
 * Event names used in the event emitter
 */
export const PIPELINE_EVENTS = {
  OPTIMIZATION_COMPLETED: 'optimization.completed',
  OPTIMIZATION_FAILED: 'optimization.failed',
  BACKTEST_COMPLETED: 'backtest.completed',
  BACKTEST_FAILED: 'backtest.failed',
  PAPER_TRADING_COMPLETED: 'paper-trading.completed',
  PAPER_TRADING_FAILED: 'paper-trading.failed',
  PIPELINE_STAGE_TRANSITION: 'pipeline.stage-transition',
  PIPELINE_STATUS_CHANGE: 'pipeline.status-change',
  PIPELINE_PROGRESS: 'pipeline.progress',
  PIPELINE_COMPLETED: 'pipeline.completed',
  PIPELINE_FAILED: 'pipeline.failed',
  PIPELINE_REJECTED: 'pipeline.rejected',
  PIPELINE_REGIME_SKIPPED: 'pipeline.regime-skipped'
} as const;
