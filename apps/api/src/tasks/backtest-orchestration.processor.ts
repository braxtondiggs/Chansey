/**
 * Backtest Orchestration Processor
 *
 * BullMQ processor that handles individual user orchestration jobs.
 * Each job processes one user's algorithm activations and creates backtests.
 */

import { Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';

import { Job } from 'bullmq';

import { BacktestOrchestrationService } from './backtest-orchestration.service';
import { OrchestrationJobData, OrchestrationResult } from './dto/backtest-orchestration.dto';

import { FailSafeWorkerHost } from '../failed-jobs/fail-safe-worker-host';
import { FailedJobService } from '../failed-jobs/failed-job.service';
import { toErrorInfo } from '../shared/error.util';

@Injectable()
@Processor('backtest-orchestration')
export class BacktestOrchestrationProcessor extends FailSafeWorkerHost {
  private readonly logger = new Logger(BacktestOrchestrationProcessor.name);

  constructor(
    private readonly orchestrationService: BacktestOrchestrationService,
    failedJobService: FailedJobService
  ) {
    super(failedJobService);
  }

  /**
   * Process a single user orchestration job.
   */
  async process(job: Job<OrchestrationJobData>): Promise<OrchestrationResult> {
    const { userId, scheduledAt, riskLevel } = job.data;

    this.logger.log(
      `Processing orchestration job ${job.id} for user ${userId} ` +
        `(risk level: ${riskLevel ?? 'user-default'}, scheduled: ${scheduledAt})`
    );

    const startTime = Date.now();

    try {
      const result = await this.orchestrationService.orchestrateForUser(userId);

      const duration = Date.now() - startTime;
      this.logger.log(
        `Orchestration job ${job.id} completed for user ${userId} in ${duration}ms: ` +
          `${result.backtestsCreated} backtests created, ` +
          `${result.skippedAlgorithms.length} skipped, ` +
          `${result.errors.length} errors`
      );

      return result;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      const duration = Date.now() - startTime;
      this.logger.error(
        `Orchestration job ${job.id} failed for user ${userId} after ${duration}ms: ${err.message}`,
        err.stack
      );
      throw error;
    }
  }
}
