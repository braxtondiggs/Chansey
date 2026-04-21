import { Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';

import { Job } from 'bullmq';

import { FailSafeWorkerHost } from '../../failed-jobs/fail-safe-worker-host';
import { FailedJobService } from '../../failed-jobs/failed-job.service';
import {
  FlushJobData,
  PIPELINE_DIGEST_QUEUE,
  PipelineNotificationDigestService
} from '../services/pipeline-notification-digest.service';

@Processor(PIPELINE_DIGEST_QUEUE)
@Injectable()
export class PipelineNotificationDigestProcessor extends FailSafeWorkerHost {
  private readonly logger = new Logger(PipelineNotificationDigestProcessor.name);

  constructor(
    private readonly digestService: PipelineNotificationDigestService,
    failedJobService: FailedJobService
  ) {
    super(failedJobService);
  }

  async process(job: Job<FlushJobData>): Promise<void> {
    const { userId, bucket } = job.data;
    this.logger.debug(`Flushing digest bucket ${bucket} for user ${userId} (job ${job.id})`);
    await this.digestService.flush(userId, bucket);
  }
}
