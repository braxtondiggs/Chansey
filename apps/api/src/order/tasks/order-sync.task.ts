import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { Job, Queue } from 'bullmq';

import { OrderSyncService } from './../services/order-sync.service';

import { toErrorInfo } from '../../shared/error.util';
import { UsersService } from '../../users/users.service';

@Processor('order-queue')
@Injectable()
export class OrderSyncTask extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(OrderSyncTask.name);
  private jobScheduled = false;

  constructor(
    @InjectQueue('order-queue') private readonly orderQueue: Queue,
    private readonly orderSyncService: OrderSyncService,
    private readonly usersService: UsersService
  ) {
    super();
  }

  /**
   * Lifecycle hook that runs once when the module is initialized
   * This ensures the cron jobs are only scheduled once when the application starts
   */
  async onModuleInit() {
    // Skip scheduling jobs in local development
    if (process.env.NODE_ENV === 'development' || process.env.DISABLE_BACKGROUND_TASKS === 'true') {
      this.logger.log('Order queue jobs disabled for local development');
      return;
    }

    if (!this.jobScheduled) {
      await this.scheduleOrderSyncJob();
      await this.scheduleCleanupJob();
      this.jobScheduled = true;
    }
  }

  /**
   * Schedule the recurring job for order synchronization
   */
  private async scheduleOrderSyncJob() {
    // Check if there's already a scheduled job with the same name
    const repeatedJobs = await this.orderQueue.getRepeatableJobs();
    const existingJob = repeatedJobs.find((job) => job.name === 'sync-orders');

    if (existingJob) {
      this.logger.log(`Order sync job already scheduled with pattern: ${existingJob.pattern}`);
      return;
    }

    await this.orderQueue.add(
      'sync-orders',
      {
        timestamp: new Date().toISOString(),
        description: 'Scheduled order synchronization job'
      },
      {
        repeat: {
          pattern: process.env.NODE_ENV === 'production' ? CronExpression.EVERY_HOUR : CronExpression.EVERY_12_HOURS
        },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 100, // keep the last 100 completed jobs
        removeOnFail: 50 // keep the last 50 failed jobs
      }
    );

    this.logger.log('Order sync job scheduled with hourly cron pattern');
  }

  /**
   * Schedule the recurring job for cleaning up stale orders
   */
  private async scheduleCleanupJob() {
    // Check if there's already a scheduled job with the same name
    const repeatedJobs = await this.orderQueue.getRepeatableJobs();
    const existingJob = repeatedJobs.find((job) => job.name === 'cleanup-orders');

    if (existingJob) {
      this.logger.log(`Order cleanup job already scheduled with pattern: ${existingJob.pattern}`);
      return;
    }

    await this.orderQueue.add(
      'cleanup-orders',
      {
        timestamp: new Date().toISOString(),
        description: 'Scheduled order cleanup job'
      },
      {
        repeat: { pattern: CronExpression.EVERY_DAY_AT_MIDNIGHT },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 50, // keep the last 50 completed jobs
        removeOnFail: 20 // keep the last 20 failed jobs
      }
    );

    this.logger.log('Order cleanup job scheduled with daily midnight cron pattern');
  }

  /**
   * BullMQ worker process method that handles different job types
   */
  async process(job: Job) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);

    try {
      if (job.name === 'sync-orders') {
        return await this.handleSyncOrders(job);
      } else if (job.name === 'cleanup-orders') {
        return await this.handleCleanupOrders(job);
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
   * Handle cleanup of old/stale orders
   * @param job - The cleanup job
   */
  private async handleCleanupOrders(job: Job) {
    try {
      await job.updateProgress(10);
      this.logger.log('Starting order cleanup job');

      // TODO: Implement actual cleanup logic (e.g., remove old orders, cancelled orders, etc.)
      // For now, this is a placeholder that prevents the "Unknown job type" warning

      await job.updateProgress(100);
      this.logger.log('Order cleanup job completed');

      return {
        success: true,
        message: 'Cleanup job executed (placeholder implementation)',
        timestamp: new Date().toISOString()
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Order cleanup failed: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Handle order synchronization for a specific user or all users with active exchange keys
   * @param job - The job object, which may contain a userId in its data
   */
  private async handleSyncOrders(job: Job) {
    try {
      await job.updateProgress(10);
      let users = [];
      const { userId } = job.data;

      if (userId) {
        this.logger.log(`Starting order synchronization for user ${userId}`);
        const user = await this.usersService.getById(userId);
        if (user) users.push(user);
      } else {
        this.logger.log('Starting order synchronization for all users');
        users = await this.usersService.getUsersWithActiveExchangeKeys();
      }

      await job.updateProgress(20);

      let successCount = 0;
      let failCount = 0;

      const totalUsers = users.length;
      let processedUsers = 0;

      for (const user of users) {
        try {
          await this.orderSyncService.syncOrdersForUser(user);
          successCount++;
        } catch (error: unknown) {
          const err = toErrorInfo(error);
          this.logger.error(`Failed to sync orders for user ${user.id}: ${err.message}`, err.stack);
          failCount++;
          // Continue with next user even if one fails
        }

        processedUsers++;
        // Update progress as we process users
        const progressPercentage = Math.floor(20 + (processedUsers / totalUsers) * 70);
        await job.updateProgress(progressPercentage);
      }

      await job.updateProgress(100);
      this.logger.log(
        `Completed order synchronization for ${users.length} users (${successCount} successful, ${failCount} failed)`
      );

      return {
        totalUsers,
        successCount,
        failCount,
        timestamp: new Date().toISOString()
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Order synchronization failed: ${err.message}`, err.stack);
      throw error;
    }
  }
}
