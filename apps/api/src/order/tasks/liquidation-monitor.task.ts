import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { Job, Queue } from 'bullmq';

import { FailedJobService } from '../../failed-jobs/failed-job.service';
import { toErrorInfo } from '../../shared/error.util';
import { LiquidationMonitorService } from '../services/liquidation-monitor.service';

/**
 * LiquidationMonitorTask
 *
 * BullMQ processor for monitoring leveraged positions for liquidation risk.
 * Runs every 60 seconds to check positions approaching liquidation prices.
 */
@Processor('liquidation-monitor', {
  concurrency: 1,
  lockDuration: 120_000
})
@Injectable()
export class LiquidationMonitorTask extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(LiquidationMonitorTask.name);
  private jobScheduled = false;

  constructor(
    @InjectQueue('liquidation-monitor') private readonly liquidationQueue: Queue,
    private readonly liquidationMonitorService: LiquidationMonitorService,
    private readonly failedJobService: FailedJobService
  ) {
    super();
  }

  /**
   * Lifecycle hook that runs once when the module is initialized
   * Schedules the repeatable job for liquidation monitoring
   */
  async onModuleInit() {
    if (process.env.NODE_ENV === 'development' || process.env.DISABLE_BACKGROUND_TASKS === 'true') {
      this.logger.log('Liquidation monitor jobs disabled for local development');
      return;
    }

    if (!this.jobScheduled) {
      await this.scheduleLiquidationMonitorJob();
      this.jobScheduled = true;
    }
  }

  /**
   * Schedule the recurring job for liquidation monitoring
   */
  private async scheduleLiquidationMonitorJob() {
    const repeatedJobs = await this.liquidationQueue.getRepeatableJobs();
    const existingJob = repeatedJobs.find((job) => job.name === 'check-liquidation');

    if (existingJob) {
      this.logger.log(`Liquidation monitor job already scheduled with pattern: ${existingJob.pattern}`);
      return;
    }

    await this.liquidationQueue.add(
      'check-liquidation',
      {
        timestamp: new Date().toISOString(),
        description: 'Scheduled liquidation risk monitoring job'
      },
      {
        repeat: {
          pattern: '0 * * * * *' // Every 60 seconds (at the start of each minute)
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

    this.logger.log('Liquidation monitor job scheduled with 60-second interval');
  }

  /**
   * BullMQ worker process method
   */
  async process(job: Job) {
    this.logger.debug(`Processing job ${job.id} of type ${job.name}`);

    try {
      if (job.name === 'check-liquidation') {
        return await this.handleLiquidationCheck(job);
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

  @OnWorkerEvent('failed')
  async onFailed(job: Job, error: Error): Promise<void> {
    try {
      await this.failedJobService.recordFailure({
        queueName: 'liquidation-monitor',
        jobId: String(job.id),
        jobName: job.name,
        jobData: job.data,
        errorMessage: error.message,
        stackTrace: error.stack,
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts?.attempts ?? 0
      });
    } catch {
      // fail-safe
    }
  }

  /**
   * Check all leveraged positions for liquidation risk
   */
  private async handleLiquidationCheck(job: Job) {
    try {
      await job.updateProgress(10);

      const count = await this.liquidationMonitorService.countLeveragedPositions();
      if (count === 0) {
        await job.updateProgress(100);
        return { totalPositions: 0, critical: 0, warning: 0, safe: 0, timestamp: new Date().toISOString() };
      }

      const risks = await this.liquidationMonitorService.checkLiquidationRisk();

      await job.updateProgress(90);

      const criticalCount = risks.filter((r) => r.riskLevel === 'CRITICAL').length;
      const warningCount = risks.filter((r) => r.riskLevel === 'WARNING').length;

      if (criticalCount > 0 || warningCount > 0) {
        this.logger.log(
          `Liquidation monitor: ${risks.length} leveraged positions, ` +
            `${criticalCount} critical, ${warningCount} warning`
        );
      }

      await job.updateProgress(100);

      return {
        totalPositions: risks.length,
        critical: criticalCount,
        warning: warningCount,
        safe: risks.filter((r) => r.riskLevel === 'SAFE').length,
        timestamp: new Date().toISOString()
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Liquidation monitor failed: ${err.message}`, err.stack);
      throw error;
    }
  }
}
