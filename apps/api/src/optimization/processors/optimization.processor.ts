import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';

import { Job } from 'bullmq';

import { toErrorInfo } from '../../shared/error.util';
import { OptimizationOrchestratorService } from '../services';

interface OptimizationJobData {
  runId: string;
  combinations: Array<{
    index: number;
    values: Record<string, unknown>;
    isBaseline: boolean;
  }>;
}

/** Lock renewal interval: 30 minutes */
const LOCK_RENEWAL_MS = 30 * 60 * 1000;

/**
 * BullMQ processor for optimization jobs
 */
@Processor('optimization', {
  lockDuration: 14_400_000, // 4 hours
  stalledInterval: 14_400_000, // 4 hours
  maxStalledCount: 2
})
export class OptimizationProcessor extends WorkerHost {
  private readonly logger = new Logger(OptimizationProcessor.name);

  constructor(private readonly orchestratorService: OptimizationOrchestratorService) {
    super();
  }

  async process(job: Job<OptimizationJobData>): Promise<void> {
    const { runId, combinations } = job.data;

    this.logger.log(`Starting optimization job ${job.id} for run ${runId} with ${combinations.length} combinations`);

    // Periodically extend the lock so BullMQ doesn't mark this job as stalled
    const lockRenewal = setInterval(async () => {
      try {
        await job.extendLock(job.token!, 14_400_000);
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.warn(`Failed to extend lock for job ${job.id}: ${err.message}`);
      }
    }, LOCK_RENEWAL_MS);

    try {
      await this.orchestratorService.executeOptimization(runId, combinations);
      this.logger.log(`Optimization job ${job.id} completed successfully`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Optimization job ${job.id} failed: ${err.message}`, err.stack);
      throw error;
    } finally {
      clearInterval(lockRenewal);
    }
  }
}
