import { Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';

import { Job } from 'bullmq';

import { DriftDetectionTask } from './drift-detection.task';

import { FailSafeWorkerHost } from '../failed-jobs/fail-safe-worker-host';
import { FailedJobService } from '../failed-jobs/failed-job.service';
import { toErrorInfo } from '../shared/error.util';

@Injectable()
@Processor('drift-detection-queue')
export class DriftDetectionProcessor extends FailSafeWorkerHost {
  private readonly logger = new Logger(DriftDetectionProcessor.name);

  constructor(
    private readonly driftDetectionTask: DriftDetectionTask,
    failedJobService: FailedJobService
  ) {
    super(failedJobService);
  }

  async process(job: Job<{ deploymentId: string }>): Promise<void> {
    const { deploymentId } = job.data;

    this.logger.log(`Processing drift detection job ${job.id} for deployment ${deploymentId}`);

    const startTime = Date.now();

    try {
      await this.driftDetectionTask.executeForDeployment(deploymentId);

      const duration = Date.now() - startTime;
      this.logger.log(`Drift detection job ${job.id} completed for deployment ${deploymentId} in ${duration}ms`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      const duration = Date.now() - startTime;
      this.logger.error(
        `Drift detection job ${job.id} failed for deployment ${deploymentId} after ${duration}ms: ${err.message}`,
        err.stack
      );
      throw error;
    }
  }
}
