import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import {
  type PipelineStage as SharedPipelineStage,
  type PipelineStatus as SharedPipelineStatus,
  type UserPipelineStatus,
  DeploymentRecommendation,
  PipelineStage,
  PipelineStatus
} from '@chansey/api-interfaces';

import { PaperTradingSession } from '../../order/paper-trading/entities/paper-trading-session.entity';
import { DEFAULT_RISK_LEVEL } from '../../risk/risk.constants';
import { getPaperTradingMinTrades } from '../../tasks/dto/pipeline-orchestration.dto';
import { Pipeline } from '../entities/pipeline.entity';

/**
 * Minimum / maximum day estimates for stages that have a deterministic range.
 * These are empirical — tuned to match observed pipeline runtimes.
 */
interface StageEstimate {
  min: number;
  max: number;
}

const STAGE_ESTIMATES: Record<Exclude<SharedPipelineStage, 'COMPLETED'>, StageEstimate> = {
  OPTIMIZE: { min: 2, max: 4 },
  HISTORICAL: { min: 1, max: 1 },
  LIVE_REPLAY: { min: 1, max: 1 },
  PAPER_TRADE: { min: 1, max: 30 }
};

/** Post-PAPER_TRADE promotion review + activation window */
const PROMOTION_WINDOW_DAYS: StageEstimate = { min: 1, max: 2 };

/** Paper trading is capped at this many days even if min-trade target not yet hit */
const PAPER_TRADE_MAX_DAYS = 30;

/** A pipeline is considered stalled when no update has happened within this threshold */
const STALL_THRESHOLD_MS = 48 * 60 * 60 * 1000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const DISPLAY_STAGE_ORDER: SharedPipelineStage[] = [
  PipelineStage.OPTIMIZE,
  PipelineStage.HISTORICAL,
  PipelineStage.LIVE_REPLAY,
  PipelineStage.PAPER_TRADE,
  PipelineStage.COMPLETED
];

/**
 * Provides user-facing pipeline status summaries with timeline estimates.
 *
 * Timeline is reported as a range (min–max days) rather than a single date
 * because paper-trade duration is driven by trade frequency × risk level,
 * not a fixed calendar.
 */
@Injectable()
export class PipelineEtaService {
  constructor(
    @InjectRepository(Pipeline)
    private readonly pipelineRepository: Repository<Pipeline>,
    @InjectRepository(PaperTradingSession)
    private readonly paperTradingSessionRepository: Repository<PaperTradingSession>
  ) {}

  /**
   * Returns the user's most recent pipeline status, or null if:
   * - the user has never had a pipeline, or
   * - the user has an active live deployment (in which case the status card is hidden)
   */
  async getStatusForUser(userId: string): Promise<UserPipelineStatus | null> {
    const pipeline = await this.pipelineRepository.findOne({
      where: { user: { id: userId } },
      relations: ['strategyConfig', 'user', 'user.coinRisk'],
      order: { createdAt: 'DESC' }
    });

    if (!pipeline) return null;

    if (pipeline.status === PipelineStatus.CANCELLED) return null;

    // If the pipeline completed successfully and a deployment should be live,
    // hide the card to avoid showing stale "almost ready" state.
    if (
      pipeline.status === PipelineStatus.COMPLETED &&
      pipeline.recommendation === DeploymentRecommendation.DEPLOY &&
      pipeline.completedAt !== undefined &&
      pipeline.completedAt !== null
    ) {
      const daysSinceCompleted = (Date.now() - new Date(pipeline.completedAt).getTime()) / MS_PER_DAY;
      if (daysSinceCompleted > PROMOTION_WINDOW_DAYS.max) return null;
    }

    const riskLevel = pipeline.user?.coinRisk?.level ?? DEFAULT_RISK_LEVEL;

    let currentStageProgress: UserPipelineStatus['currentStageProgress'] | undefined;
    let paperTradeSession: PaperTradingSession | null = null;

    if (pipeline.paperTradingSessionId) {
      paperTradeSession = await this.paperTradingSessionRepository.findOne({
        where: { id: pipeline.paperTradingSessionId }
      });

      if (paperTradeSession) {
        const tradesRequired = paperTradeSession.minTrades ?? getPaperTradingMinTrades(riskLevel);
        currentStageProgress = {
          tradesCompleted: paperTradeSession.totalTrades,
          tradesRequired
        };
      }
    }

    const { minDaysRemaining, maxDaysRemaining } = this.computeRemaining(pipeline, riskLevel, paperTradeSession);

    const wasRejected = this.isRejected(pipeline);
    const rejectionReason = wasRejected ? this.buildRejectionReason(pipeline) : undefined;

    const isRetrying = this.isRetrying(pipeline);
    const retryReason = isRetrying ? this.buildRetryReason(pipeline) : undefined;

    const isStalled = this.isStalled(pipeline);

    const stageIndex = DISPLAY_STAGE_ORDER.indexOf(pipeline.currentStage);

    return {
      pipelineId: pipeline.id,
      strategyName: pipeline.strategyConfig?.name ?? pipeline.name,
      currentStage: pipeline.currentStage,
      status: pipeline.status as SharedPipelineStatus,
      stageIndex: stageIndex === -1 ? 0 : stageIndex,
      totalStages: 5,
      createdAt: pipeline.createdAt.toISOString(),
      minDaysRemaining,
      maxDaysRemaining,
      currentStageProgress,
      isStalled,
      wasRejected,
      isRetrying,
      retryReason,
      rejectionReason
    };
  }

  /**
   * Compute lower/upper bound of days until the pipeline completes and a live
   * deployment could start trading.
   *
   * If the pipeline is in PAPER_TRADE with an active session, we project from
   * the observed trade rate (trades so far / elapsed days) → remaining trades.
   * Otherwise we use the static stage estimates.
   */
  private computeRemaining(
    pipeline: Pipeline,
    riskLevel: number,
    paperTradeSession: PaperTradingSession | null
  ): { minDaysRemaining: number; maxDaysRemaining: number } {
    // Terminal states: nothing left
    if (
      pipeline.status === PipelineStatus.COMPLETED ||
      pipeline.status === PipelineStatus.FAILED ||
      pipeline.status === PipelineStatus.REJECTED ||
      pipeline.status === PipelineStatus.CANCELLED
    ) {
      return { minDaysRemaining: 0, maxDaysRemaining: 0 };
    }

    const stagesLeft = this.stagesAfter(pipeline.currentStage);

    let min = 0;
    let max = 0;

    // Current stage's remaining time
    if (pipeline.currentStage === PipelineStage.PAPER_TRADE && paperTradeSession) {
      const { min: pMin, max: pMax } = this.estimatePaperTradeRemaining(paperTradeSession, riskLevel);
      min += pMin;
      max += pMax;
    } else if (pipeline.currentStage !== PipelineStage.COMPLETED) {
      const estimate = STAGE_ESTIMATES[pipeline.currentStage as Exclude<SharedPipelineStage, 'COMPLETED'>];
      min += estimate.min;
      max += estimate.max;
    }

    // Add estimates for remaining stages
    for (const stage of stagesLeft) {
      if (stage === PipelineStage.COMPLETED) continue;
      const estimate = STAGE_ESTIMATES[stage as Exclude<SharedPipelineStage, 'COMPLETED'>];
      min += estimate.min;
      max += estimate.max;
    }

    // Promotion review + activation
    min += PROMOTION_WINDOW_DAYS.min;
    max += PROMOTION_WINDOW_DAYS.max;

    return {
      minDaysRemaining: Math.max(0, Math.floor(min)),
      maxDaysRemaining: Math.max(0, Math.ceil(max))
    };
  }

  /**
   * Estimate days remaining in PAPER_TRADE.
   *
   * Uses observed trade rate to project: remainingDays = remainingTrades / tradesPerDay.
   * Floored at 1 day and capped at the 30-day safety net.
   * If we don't have enough data yet (e.g., 0 trades in first day), returns a
   * wide range to reflect genuine uncertainty.
   */
  private estimatePaperTradeRemaining(session: PaperTradingSession, riskLevel: number): { min: number; max: number } {
    const minTrades = session.minTrades ?? getPaperTradingMinTrades(riskLevel);
    const tradesDone = session.totalTrades;

    const startedAt = session.startedAt ?? session.createdAt;
    const elapsedMs = Date.now() - new Date(startedAt).getTime();
    const elapsedDays = Math.max(0.25, elapsedMs / MS_PER_DAY);

    if (tradesDone >= minTrades) {
      // Target hit — waiting for next tick to finalize.
      return { min: 0, max: 1 };
    }

    const remainingTrades = minTrades - tradesDone;
    const elapsedDaysSoFar = Math.min(elapsedDays, PAPER_TRADE_MAX_DAYS);

    // Not enough data to project yet — show a wide range bounded by the hard cap.
    if (tradesDone === 0 || elapsedDays < 1) {
      const remainingToCapDays = Math.max(1, PAPER_TRADE_MAX_DAYS - elapsedDaysSoFar);
      return { min: 1, max: remainingToCapDays };
    }

    const tradesPerDay = tradesDone / elapsedDays;
    const projectedRemainingDays = remainingTrades / tradesPerDay;

    const min = Math.max(1, Math.floor(projectedRemainingDays * 0.8));
    const maxCandidate = Math.ceil(projectedRemainingDays * 1.2);
    const max = Math.min(PAPER_TRADE_MAX_DAYS - Math.floor(elapsedDaysSoFar), maxCandidate);

    return { min, max: Math.max(min, max) };
  }

  private stagesAfter(stage: SharedPipelineStage): SharedPipelineStage[] {
    const idx = DISPLAY_STAGE_ORDER.indexOf(stage);
    if (idx === -1) return [];
    return DISPLAY_STAGE_ORDER.slice(idx + 1);
  }

  private isStalled(pipeline: Pipeline): boolean {
    if (pipeline.status !== PipelineStatus.RUNNING) return false;
    const lastTransition = pipeline.stageTransitionedAt ?? pipeline.startedAt ?? pipeline.createdAt;
    return Date.now() - new Date(lastTransition).getTime() > STALL_THRESHOLD_MS;
  }

  private isRejected(pipeline: Pipeline): boolean {
    return (
      pipeline.status === PipelineStatus.REJECTED ||
      pipeline.status === PipelineStatus.FAILED ||
      (pipeline.status === PipelineStatus.COMPLETED &&
        pipeline.recommendation === DeploymentRecommendation.DO_NOT_DEPLOY)
    );
  }

  private isRetrying(pipeline: Pipeline): boolean {
    return (
      pipeline.status === PipelineStatus.COMPLETED &&
      pipeline.recommendation === DeploymentRecommendation.INCONCLUSIVE_RETRY
    );
  }

  private buildRejectionReason(pipeline: Pipeline): string {
    if (pipeline.failureReason) return pipeline.failureReason;
    if (pipeline.recommendation === DeploymentRecommendation.DO_NOT_DEPLOY) {
      return 'Your strategy did not pass the final safety review.';
    }
    return 'The strategy build could not finish.';
  }

  private buildRetryReason(_pipeline: Pipeline): string {
    return "The strategy couldn't find enough opportunities in the current market — we'll retry with fresh parameters.";
  }
}
