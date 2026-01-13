import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Job, Queue } from 'bullmq';

import { OHLCService } from '../ohlc.service';

@Processor('ohlc-queue')
@Injectable()
export class OHLCPruneTask extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(OHLCPruneTask.name);
  private jobScheduled = false;
  private readonly DEFAULT_RETENTION_DAYS = 365; // 1 year

  constructor(
    @InjectQueue('ohlc-queue') private readonly ohlcQueue: Queue,
    private readonly ohlcService: OHLCService,
    private readonly configService: ConfigService
  ) {
    super();
  }

  /**
   * Lifecycle hook that runs once when the module is initialized
   */
  async onModuleInit() {
    // Skip scheduling jobs in local development or when disabled
    if (
      process.env.NODE_ENV === 'development' ||
      process.env.DISABLE_BACKGROUND_TASKS === 'true' ||
      this.configService.get('OHLC_SYNC_ENABLED') === 'false'
    ) {
      this.logger.log('OHLC prune jobs disabled');
      return;
    }

    if (!this.jobScheduled) {
      await this.schedulePruneJob();
      this.jobScheduled = true;
    }
  }

  /**
   * Schedule the recurring job for data pruning
   * Runs daily at 3:00 AM
   */
  private async schedulePruneJob() {
    // Check if there's already a scheduled job with the same name
    const repeatedJobs = await this.ohlcQueue.getRepeatableJobs();
    const existingJob = repeatedJobs.find((job) => job.name === 'ohlc-prune');

    if (existingJob) {
      this.logger.log(`OHLC prune job already scheduled with pattern: ${existingJob.pattern}`);
      return;
    }

    // Run at 3:00 AM every day
    const cronPattern = '0 3 * * *';

    await this.ohlcQueue.add(
      'ohlc-prune',
      {
        timestamp: new Date().toISOString(),
        description: 'Scheduled OHLC data pruning job'
      },
      {
        repeat: { pattern: cronPattern },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 30, // Keep fewer completed jobs for prune task
        removeOnFail: 20
      }
    );

    this.logger.log(`OHLC prune job scheduled to run daily at 3:00 AM`);
  }

  // BullMQ: process and route incoming jobs
  async process(job: Job) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);
    try {
      if (job.name === 'ohlc-prune') {
        return await this.handlePrune(job);
      }
      // If job name doesn't match, let other processors handle it
      return null;
    } catch (error) {
      this.logger.error(`Failed to process job ${job.id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Handler for data pruning job
   */
  async handlePrune(job: Job) {
    try {
      this.logger.log('Starting OHLC data pruning');
      await job.updateProgress(10);

      // Get retention days from config or use default (365 days = 1 year)
      const retentionDays = parseInt(
        this.configService.get('OHLC_RETENTION_DAYS') || String(this.DEFAULT_RETENTION_DAYS),
        10
      );

      this.logger.log(`Pruning candles older than ${retentionDays} days`);
      await job.updateProgress(30);

      // Get count before pruning for logging
      const countBefore = await this.ohlcService.getCandleCount();
      await job.updateProgress(50);

      // Perform the pruning
      const deletedCount = await this.ohlcService.pruneOldCandles(retentionDays);
      await job.updateProgress(90);

      // Get count after pruning
      const countAfter = await this.ohlcService.getCandleCount();
      await job.updateProgress(100);

      const summary = {
        retentionDays,
        candlesBefore: countBefore,
        candlesAfter: countAfter,
        candlesDeleted: deletedCount,
        prunedAt: new Date().toISOString()
      };

      this.logger.log(
        `OHLC prune complete: Deleted ${deletedCount} candles. Before: ${countBefore}, After: ${countAfter}`
      );

      return summary;
    } catch (error) {
      this.logger.error('OHLC prune failed:', error);
      throw error;
    }
  }
}
