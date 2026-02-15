import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { Job, Queue } from 'bullmq';

import { toErrorInfo } from '../../shared/error.util';
import { BalanceService } from '../balance.service';

@Processor('balance-queue')
@Injectable()
export class BalanceSyncTask extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(BalanceSyncTask.name);
  private jobScheduled = false;

  constructor(
    @InjectQueue('balance-queue') private readonly balanceQueue: Queue,
    private readonly balanceService: BalanceService
  ) {
    super();
  }

  /**
   * Lifecycle hook that runs once when the module is initialized
   * This ensures the cron job is only scheduled once when the application starts
   */
  async onModuleInit() {
    // Skip scheduling jobs in local development
    if (process.env.NODE_ENV === 'development' || process.env.DISABLE_BACKGROUND_TASKS === 'true') {
      this.logger.log('Balance sync jobs disabled for local development');
      return;
    }

    if (!this.jobScheduled) {
      await this.scheduleCronJob();
      this.jobScheduled = true;
    }
  }

  /**
   * Schedule the recurring job for historical balance storage
   */
  private async scheduleCronJob() {
    // Check if there's already a scheduled job with the same name
    const repeatedJobs = await this.balanceQueue.getRepeatableJobs();
    const existingJob = repeatedJobs.find((job) => job.name === 'store-historical-balances');

    if (existingJob) {
      this.logger.log(`Historical balance storage job already scheduled with pattern: ${existingJob.pattern}`);
      return;
    }

    await this.balanceQueue.add(
      'store-historical-balances',
      {
        timestamp: new Date().toISOString(),
        description: 'Scheduled historical balance storage job'
      },
      {
        repeat: { pattern: CronExpression.EVERY_HOUR },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 100, // keep the last 100 completed jobs
        removeOnFail: 50 // keep the last 50 failed jobs
      }
    );

    this.logger.log('Historical balance storage job scheduled with daily midnight cron pattern');
  }

  // BullMQ: log job start, completion, and errors inside process/handler
  async process(job: Job) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);
    try {
      if (job.name === 'store-historical-balances') {
        const result = await this.handleStoreHistoricalBalances(job);
        this.logger.log(`Job ${job.id} completed with result: ${JSON.stringify(result)}`);
        return result;
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to process job ${job.id}: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Handler for storing historical balances
   */
  async handleStoreHistoricalBalances(job: Job) {
    try {
      this.logger.log('Starting Historical Balance Storage');
      await job.updateProgress(10);

      // Call the existing method from BalanceService
      await this.balanceService.storeHistoricalBalances();

      await job.updateProgress(100);
      this.logger.log('Historical Balance Storage Complete');

      return {
        timestamp: new Date().toISOString(),
        status: 'completed',
        message: 'Historical balances stored successfully'
      };
    } catch (error: unknown) {
      this.logger.error('Historical balance storage failed:', error);
      throw error;
    }
  }
}
