import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { Job, Queue } from 'bullmq';

import { FailSafeWorkerHost } from '../../../failed-jobs/fail-safe-worker-host';
import { FailedJobService } from '../../../failed-jobs/failed-job.service';
import { toErrorInfo } from '../../../shared/error.util';
import { ExchangeKeyHealthService } from '../exchange-key-health.service';

@Processor('exchange-health-queue', { lockDuration: 30 * 60 * 1000 })
@Injectable()
export class ExchangeKeyHealthTask extends FailSafeWorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ExchangeKeyHealthTask.name);
  private jobScheduled = false;

  constructor(
    @InjectQueue('exchange-health-queue') private readonly healthQueue: Queue,
    private readonly healthService: ExchangeKeyHealthService,
    failedJobService: FailedJobService
  ) {
    super(failedJobService);
  }

  async onModuleInit() {
    if (process.env.NODE_ENV === 'development' || process.env.DISABLE_BACKGROUND_TASKS === 'true') {
      this.logger.log('Exchange health queue jobs disabled for local development');
      return;
    }

    if (!this.jobScheduled) {
      await this.scheduleHealthCheckJob();
      await this.scheduleCleanupJob();
      this.jobScheduled = true;
    }
  }

  private async scheduleHealthCheckJob() {
    const repeatedJobs = await this.healthQueue.getRepeatableJobs();
    const existingJob = repeatedJobs.find((job) => job.name === 'check-health');

    if (existingJob) {
      this.logger.log(`Health check job already scheduled with pattern: ${existingJob.pattern}`);
      return;
    }

    await this.healthQueue.add(
      'check-health',
      {
        timestamp: new Date().toISOString(),
        description: 'Scheduled exchange key health check'
      },
      {
        repeat: { pattern: CronExpression.EVERY_4_HOURS },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 100,
        removeOnFail: 50
      }
    );

    this.logger.log('Exchange key health check job scheduled every 4 hours');
  }

  private async scheduleCleanupJob() {
    const repeatedJobs = await this.healthQueue.getRepeatableJobs();
    const existingJob = repeatedJobs.find((job) => job.name === 'cleanup-health-logs');

    if (existingJob) {
      this.logger.log(`Health log cleanup job already scheduled with pattern: ${existingJob.pattern}`);
      return;
    }

    await this.healthQueue.add(
      'cleanup-health-logs',
      {
        timestamp: new Date().toISOString(),
        description: 'Scheduled health log cleanup'
      },
      {
        repeat: { pattern: CronExpression.EVERY_DAY_AT_3AM },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 50,
        removeOnFail: 20
      }
    );

    this.logger.log('Health log cleanup job scheduled daily at 3 AM');
  }

  async process(job: Job) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);

    try {
      if (job.name === 'check-health') {
        return await this.handleHealthCheck(job);
      } else if (job.name === 'cleanup-health-logs') {
        return await this.handleCleanup(job);
      } else {
        this.logger.warn(`Unknown job type: ${job.name}`);
        return { success: false, message: `Unknown job type: ${job.name}` };
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to process job ${job.id}: ${err.message}`, err.stack);
      throw error;
    }
  }

  private async handleHealthCheck(job: Job) {
    await job.updateProgress(10);
    this.logger.log('Starting exchange key health checks');

    const result = await this.healthService.checkAllKeys();
    await job.updateProgress(100);

    this.logger.log(
      `Health checks completed: ${result.total} keys checked ` +
        `(${result.healthy} healthy, ${result.unhealthy} unhealthy, ${result.deactivated} deactivated)`
    );

    return { success: true, ...result, timestamp: new Date().toISOString() };
  }

  private async handleCleanup(job: Job) {
    await job.updateProgress(10);
    this.logger.log('Starting health log cleanup');

    const deleted = await this.healthService.cleanupOldLogs();
    await job.updateProgress(100);

    this.logger.log(`Health log cleanup completed: ${deleted} entries removed`);

    return { success: true, deleted, timestamp: new Date().toISOString() };
  }
}
