import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { Job, Queue } from 'bullmq';

import { FailSafeWorkerHost } from '../../failed-jobs/fail-safe-worker-host';
import { FailedJobService } from '../../failed-jobs/failed-job.service';
import { toErrorInfo } from '../../shared/error.util';
import { PositionMonitorService } from '../services/position-monitor.service';

/**
 * PositionMonitorTask
 *
 * BullMQ processor for monitoring positions with trailing stops.
 * Runs every 60 seconds to update trailing stop prices as market moves.
 */
@Processor('position-monitor', {
  concurrency: 1,
  lockDuration: 120_000
})
@Injectable()
export class PositionMonitorTask extends FailSafeWorkerHost implements OnModuleInit {
  private readonly logger = new Logger(PositionMonitorTask.name);
  private jobScheduled = false;

  constructor(
    @InjectQueue('position-monitor') private readonly positionMonitorQueue: Queue,
    private readonly positionMonitorService: PositionMonitorService,
    failedJobService: FailedJobService
  ) {
    super(failedJobService);
  }

  /**
   * Lifecycle hook that runs once when the module is initialized
   * Schedules the repeatable job for position monitoring
   */
  async onModuleInit() {
    if (process.env.NODE_ENV === 'development' || process.env.DISABLE_POSITION_MONITOR === 'true') {
      this.logger.log('Position monitor jobs disabled for local development');
      return;
    }

    if (!this.jobScheduled) {
      await this.schedulePositionMonitorJob();
      this.jobScheduled = true;
    }
  }

  /**
   * Schedule the recurring job for position monitoring
   */
  private async schedulePositionMonitorJob() {
    const repeatedJobs = await this.positionMonitorQueue.getRepeatableJobs();
    const existingJob = repeatedJobs.find((job) => job.name === 'monitor-positions');

    if (existingJob) {
      this.logger.log(`Position monitor job already scheduled with pattern: ${existingJob.pattern}`);
      return;
    }

    await this.positionMonitorQueue.add(
      'monitor-positions',
      {
        timestamp: new Date().toISOString(),
        description: 'Scheduled position monitoring job'
      },
      {
        repeat: {
          pattern: '0 * * * * *'
        },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 3000
        },
        removeOnComplete: 100,
        removeOnFail: 50
      }
    );

    this.logger.log('Position monitor job scheduled with 60-second interval');
  }

  /**
   * BullMQ worker process method
   */
  async process(job: Job) {
    this.logger.debug(`Processing job ${job.id} of type ${job.name}`);

    try {
      if (job.name === 'monitor-positions') {
        return await this.handleMonitorPositions(job);
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

  /**
   * Thin wrapper: updates job progress and delegates to service
   */
  private async handleMonitorPositions(job: Job) {
    await job.updateProgress(10);
    const result = await this.positionMonitorService.monitorPositions();
    await job.updateProgress(100);
    return result;
  }
}
