import { type PipelineStage, type PipelineStatus } from './pipeline.interface';

/**
 * User-facing pipeline status summary.
 * Returned from GET /pipelines/status — describes where the user's
 * most recent active pipeline sits and gives a human-readable timeline range.
 */
export interface UserPipelineStatus {
  pipelineId: string;
  strategyName: string;
  currentStage: PipelineStage;
  status: PipelineStatus;
  /** 0-based index of the current stage (0-4 for the five displayed dots) */
  stageIndex: number;
  /** Total displayed stages (always 5: OPTIMIZE → HISTORICAL → LIVE_REPLAY → PAPER_TRADE → COMPLETED) */
  totalStages: 5;
  createdAt: string;
  /** Lower bound of estimated days remaining until live trading */
  minDaysRemaining: number;
  /** Upper bound of estimated days remaining until live trading */
  maxDaysRemaining: number;
  /**
   * Progress within the current stage. Present during PAPER_TRADE and
   * used to render "X of Y simulated trades completed".
   */
  currentStageProgress?: {
    tradesCompleted: number;
    tradesRequired: number;
  };
  /** True if the pipeline has not transitioned stages in more than 48 hours */
  isStalled: boolean;
  /** True if a gate failed and the pipeline ended without going live */
  wasRejected: boolean;
  /**
   * True if the pipeline completed with INCONCLUSIVE_RETRY — the strategy
   * couldn't find enough opportunities, and a new pipeline will auto-start
   * on the next orchestration cycle. Distinct from wasRejected (hard failure).
   */
  isRetrying: boolean;
  /** Human-readable reason surfaced to the user when isRetrying is true */
  retryReason?: string;
  /** Human-readable reason surfaced to the user when wasRejected is true */
  rejectionReason?: string;
}
