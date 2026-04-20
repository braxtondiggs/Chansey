import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { DeploymentRecommendation, PipelineStage, PipelineStatus } from '@chansey/api-interfaces';

import { Pipeline } from '../../pipeline/entities/pipeline.entity';
import {
  PIPELINE_EVENTS,
  type PipelineStageTransitionEvent,
  type PipelineStatusChangeEvent
} from '../../pipeline/interfaces';
import { toErrorInfo } from '../../shared/error.util';
import {
  DigestBucket,
  DigestEntry,
  PipelineNotificationDigestService
} from '../services/pipeline-notification-digest.service';

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

interface PipelineRejectedPayload {
  pipelineId: string;
  reason: string;
  timestamp: string;
}

/**
 * Translates domain-level pipeline events into per-user digest buckets.
 * Events are buffered by `PipelineNotificationDigestService`, which emits
 * one aggregated notification per bucket after its debounce window elapses.
 */
@Injectable()
export class PipelineNotificationListener {
  private readonly logger = new Logger(PipelineNotificationListener.name);

  constructor(
    private readonly digest: PipelineNotificationDigestService,
    @InjectRepository(Pipeline) private readonly pipelineRepository: Repository<Pipeline>
  ) {}

  @OnEvent(PIPELINE_EVENTS.PIPELINE_STATUS_CHANGE, { async: true })
  async handleStatusChange(payload: PipelineStatusChangeEvent): Promise<void> {
    if (payload.newStatus !== PipelineStatus.RUNNING) return;
    if (payload.previousStatus !== PipelineStatus.PENDING) return;

    await this.enqueueForPipeline(payload.pipelineId, 'started', (pipeline, strategyName) => ({
      pipelineId: pipeline.id,
      userId: pipeline.user.id,
      strategyName,
      subType: 'started',
      at: payload.timestamp ?? new Date().toISOString()
    }));
  }

  @OnEvent(PIPELINE_EVENTS.PIPELINE_STAGE_TRANSITION, { async: true })
  async handleStageTransition(payload: PipelineStageTransitionEvent): Promise<void> {
    // Skip the transition into COMPLETED — handled by PIPELINE_COMPLETED instead.
    if (payload.newStage === PipelineStage.COMPLETED) return;

    await this.enqueueForPipeline(payload.pipelineId, 'stage', (pipeline, strategyName) => ({
      pipelineId: pipeline.id,
      userId: pipeline.user.id,
      strategyName,
      subType: 'stage',
      previousStage: payload.previousStage,
      newStage: payload.newStage,
      at: payload.timestamp ?? new Date().toISOString()
    }));
  }

  @OnEvent(PIPELINE_EVENTS.PIPELINE_COMPLETED, { async: true })
  async handleCompleted(payload: PipelineCompletedPayload): Promise<void> {
    await this.enqueueForPipeline(payload.pipelineId, 'terminal', (pipeline, strategyName) => ({
      pipelineId: pipeline.id,
      userId: pipeline.user.id,
      strategyName,
      subType: 'completed',
      recommendation: payload.recommendation,
      inconclusive: payload.inconclusive,
      reason: pipeline.failureReason ?? payload.reason,
      at: payload.timestamp ?? new Date().toISOString()
    }));
  }

  @OnEvent(PIPELINE_EVENTS.PIPELINE_FAILED, { async: true })
  async handleFailed(payload: PipelineFailedPayload): Promise<void> {
    await this.enqueueForPipeline(payload.pipelineId, 'terminal', (pipeline, strategyName) => ({
      pipelineId: pipeline.id,
      userId: pipeline.user.id,
      strategyName,
      subType: 'failed',
      reason: payload.reason,
      at: payload.timestamp ?? new Date().toISOString()
    }));
  }

  @OnEvent(PIPELINE_EVENTS.PIPELINE_REJECTED, { async: true })
  async handleRejected(payload: PipelineRejectedPayload): Promise<void> {
    await this.enqueueForPipeline(payload.pipelineId, 'terminal', (pipeline, strategyName) => ({
      pipelineId: pipeline.id,
      userId: pipeline.user.id,
      strategyName,
      subType: 'rejected',
      reason: payload.reason,
      at: payload.timestamp ?? new Date().toISOString()
    }));
  }

  private async enqueueForPipeline(
    pipelineId: string,
    bucket: DigestBucket,
    buildEntry: (pipeline: Pipeline, strategyName: string) => DigestEntry
  ): Promise<void> {
    try {
      const pipeline = await this.loadPipelineWithUser(pipelineId);
      if (!pipeline || !pipeline.user) return;

      const strategyName = pipeline.strategyConfig?.name ?? pipeline.name;
      const entry = buildEntry(pipeline, strategyName);
      await this.digest.enqueue(bucket, entry);
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to enqueue ${bucket} digest for pipeline ${pipelineId}: ${err.message}`, err.stack);
    }
  }

  private async loadPipelineWithUser(pipelineId: string): Promise<Pipeline | null> {
    return this.pipelineRepository.findOne({
      where: { id: pipelineId },
      relations: ['user', 'strategyConfig']
    });
  }
}
