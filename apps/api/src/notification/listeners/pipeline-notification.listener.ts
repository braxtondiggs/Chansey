import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import {
  DeploymentRecommendation,
  NotificationEventType,
  PipelineStage,
  PipelineStatus
} from '@chansey/api-interfaces';

import { Pipeline } from '../../pipeline/entities/pipeline.entity';
import {
  PIPELINE_EVENTS,
  type PipelineStageTransitionEvent,
  type PipelineStatusChangeEvent
} from '../../pipeline/interfaces';
import { toErrorInfo } from '../../shared/error.util';
import { NotificationService } from '../notification.service';

/** Maps a newly-entered pipeline stage to a user-facing label */
const STAGE_FRIENDLY_LABEL: Record<string, string> = {
  [PipelineStage.OPTIMIZE]: 'Training your strategy',
  [PipelineStage.HISTORICAL]: 'Testing against history',
  [PipelineStage.LIVE_REPLAY]: 'Replaying recent market data',
  [PipelineStage.PAPER_TRADE]: 'Practicing with pretend money',
  [PipelineStage.COMPLETED]: 'Final safety review'
};

/** Maps the stage a pipeline just left into a "just finished" label */
const STAGE_COMPLETED_LABEL: Record<string, string> = {
  [PipelineStage.OPTIMIZE]: 'training complete',
  [PipelineStage.HISTORICAL]: 'historical testing complete',
  [PipelineStage.LIVE_REPLAY]: 'recent market replay complete',
  [PipelineStage.PAPER_TRADE]: 'paper trading complete'
};

interface PipelineCompletedPayload {
  pipelineId: string;
  recommendation: DeploymentRecommendation;
  inconclusive?: boolean;
  reason?: string;
  timestamp: string;
}

interface PipelineFailedPayload {
  pipelineId: string;
  reason: string;
  timestamp: string;
}

/**
 * Translates domain-level pipeline events into user-facing notifications.
 * Each pipeline event maps to exactly one notification enqueue via the shared
 * NotificationService (which applies preferences + rate-limit + quiet hours).
 */
@Injectable()
export class PipelineNotificationListener {
  private readonly logger = new Logger(PipelineNotificationListener.name);

  constructor(
    private readonly notificationService: NotificationService,
    @InjectRepository(Pipeline) private readonly pipelineRepository: Repository<Pipeline>
  ) {}

  @OnEvent(PIPELINE_EVENTS.PIPELINE_STATUS_CHANGE, { async: true })
  async handleStatusChange(payload: PipelineStatusChangeEvent): Promise<void> {
    if (payload.newStatus !== PipelineStatus.RUNNING) return;
    if (payload.previousStatus !== PipelineStatus.PENDING) return;

    try {
      const pipeline = await this.loadPipelineWithUser(payload.pipelineId);
      if (!pipeline) return;

      const strategyName = pipeline.strategyConfig?.name ?? pipeline.name;

      await this.notificationService.send(
        pipeline.user.id,
        NotificationEventType.PIPELINE_STARTED,
        'We started building your strategy',
        `${strategyName} is being trained and tested — you'll get an update as it progresses.`,
        'info',
        {
          userId: pipeline.user.id,
          pipelineId: pipeline.id,
          strategyName
        }
      );
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.error(
        `Failed to send PIPELINE_STARTED notification for ${payload.pipelineId}: ${err.message}`,
        err.stack
      );
    }
  }

  @OnEvent(PIPELINE_EVENTS.PIPELINE_STAGE_TRANSITION, { async: true })
  async handleStageTransition(payload: PipelineStageTransitionEvent): Promise<void> {
    // Skip the transition into COMPLETED — handled by PIPELINE_COMPLETED instead.
    if (payload.newStage === PipelineStage.COMPLETED) return;

    try {
      const pipeline = await this.loadPipelineWithUser(payload.pipelineId);
      if (!pipeline) return;

      const strategyName = pipeline.strategyConfig?.name ?? pipeline.name;
      const completedLabel = STAGE_COMPLETED_LABEL[payload.previousStage] ?? 'stage complete';
      const nextLabel = STAGE_FRIENDLY_LABEL[payload.newStage] ?? 'next stage';

      await this.notificationService.send(
        pipeline.user.id,
        NotificationEventType.PIPELINE_STAGE_COMPLETED,
        `${strategyName}: ${completedLabel}`,
        `Moving on to: ${nextLabel}.`,
        'info',
        {
          userId: pipeline.user.id,
          pipelineId: pipeline.id,
          strategyName,
          completedStage: payload.previousStage,
          nextStage: payload.newStage
        }
      );
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.error(
        `Failed to send PIPELINE_STAGE_COMPLETED notification for ${payload.pipelineId}: ${err.message}`,
        err.stack
      );
    }
  }

  @OnEvent(PIPELINE_EVENTS.PIPELINE_COMPLETED, { async: true })
  async handleCompleted(payload: PipelineCompletedPayload): Promise<void> {
    try {
      const pipeline = await this.loadPipelineWithUser(payload.pipelineId);
      if (!pipeline) return;

      const strategyName = pipeline.strategyConfig?.name ?? pipeline.name;

      if (payload.recommendation === DeploymentRecommendation.DO_NOT_DEPLOY) {
        await this.notificationService.send(
          pipeline.user.id,
          NotificationEventType.PIPELINE_REJECTED,
          `${strategyName} didn't pass the safety review`,
          `We'll try a different strategy on your next cycle.`,
          'medium',
          {
            userId: pipeline.user.id,
            pipelineId: pipeline.id,
            strategyName,
            reason: pipeline.failureReason ?? payload.reason ?? 'Failed final review'
          }
        );
        return;
      }

      if (payload.recommendation === DeploymentRecommendation.INCONCLUSIVE_RETRY) {
        await this.notificationService.send(
          pipeline.user.id,
          NotificationEventType.PIPELINE_REJECTED,
          `${strategyName} couldn't find enough opportunities`,
          `We'll retry with fresh parameters — no action needed from you.`,
          'low',
          {
            userId: pipeline.user.id,
            pipelineId: pipeline.id,
            strategyName,
            reason: payload.reason ?? 'Insufficient trading signals'
          }
        );
        return;
      }

      await this.notificationService.send(
        pipeline.user.id,
        NotificationEventType.PIPELINE_COMPLETED,
        `${strategyName} is ready for live trading`,
        `Your strategy passed every check and is being activated.`,
        'info',
        {
          userId: pipeline.user.id,
          pipelineId: pipeline.id,
          strategyName
        }
      );
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.error(
        `Failed to send PIPELINE_COMPLETED notification for ${payload.pipelineId}: ${err.message}`,
        err.stack
      );
    }
  }

  @OnEvent(PIPELINE_EVENTS.PIPELINE_FAILED, { async: true })
  async handleFailed(payload: PipelineFailedPayload): Promise<void> {
    try {
      const pipeline = await this.loadPipelineWithUser(payload.pipelineId);
      if (!pipeline) return;

      const strategyName = pipeline.strategyConfig?.name ?? pipeline.name;

      await this.notificationService.send(
        pipeline.user.id,
        NotificationEventType.PIPELINE_REJECTED,
        `${strategyName} couldn't finish building`,
        `We'll try again on the next cycle.`,
        'medium',
        {
          userId: pipeline.user.id,
          pipelineId: pipeline.id,
          strategyName,
          reason: payload.reason
        }
      );
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.error(
        `Failed to send PIPELINE_REJECTED notification for ${payload.pipelineId}: ${err.message}`,
        err.stack
      );
    }
  }

  private async loadPipelineWithUser(pipelineId: string): Promise<Pipeline | null> {
    return this.pipelineRepository.findOne({
      where: { id: pipelineId },
      relations: ['user', 'strategyConfig']
    });
  }
}
