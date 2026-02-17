/**
 * Pipeline Orchestration Processor
 *
 * BullMQ processor that handles individual user pipeline orchestration jobs.
 * Each job processes one user's strategy configs and creates full validation pipelines.
 */

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';

import { Job } from 'bullmq';

import { PipelineOrchestrationJobData, PipelineOrchestrationResult } from './dto/pipeline-orchestration.dto';
import { PipelineOrchestrationService } from './pipeline-orchestration.service';

import { toErrorInfo } from '../shared/error.util';

@Injectable()
@Processor('pipeline-orchestration')
export class PipelineOrchestrationProcessor extends WorkerHost {
  private readonly logger = new Logger(PipelineOrchestrationProcessor.name);

  constructor(private readonly orchestrationService: PipelineOrchestrationService) {
    super();
  }

  /**
   * Process a single user pipeline orchestration job.
   */
  async process(job: Job<PipelineOrchestrationJobData>): Promise<PipelineOrchestrationResult> {
    const { userId, scheduledAt, riskLevel } = job.data;

    this.logger.log(
      `Processing pipeline orchestration job ${job.id} for user ${userId} ` +
        `(risk level: ${riskLevel}, scheduled: ${scheduledAt})`
    );

    const startTime = Date.now();

    try {
      const result = await this.orchestrationService.orchestrateForUser(userId);

      const duration = Date.now() - startTime;
      this.logger.log(
        `Pipeline orchestration job ${job.id} completed for user ${userId} in ${duration}ms: ` +
          `${result.pipelinesCreated} pipelines created, ` +
          `${result.skippedConfigs.length} skipped, ` +
          `${result.errors.length} errors`
      );

      return result;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      const duration = Date.now() - startTime;
      this.logger.error(
        `Pipeline orchestration job ${job.id} failed for user ${userId} after ${duration}ms: ${err.message}`,
        err.stack
      );
      throw error;
    }
  }
}
