/**
 * Backtest Orchestration Task
 *
 * Scheduled task that runs daily at 3 AM UTC to orchestrate
 * automatic backtests for users with algo trading enabled.
 */

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { Queue } from 'bullmq';

import { BacktestOrchestrationService } from './backtest-orchestration.service';
import { OrchestrationJobData, STAGGER_INTERVAL_MS } from './dto/backtest-orchestration.dto';

@Injectable()
export class BacktestOrchestrationTask {
  private readonly logger = new Logger(BacktestOrchestrationTask.name);

  constructor(
    @InjectQueue('backtest-orchestration')
    private readonly orchestrationQueue: Queue<OrchestrationJobData>,
    private readonly orchestrationService: BacktestOrchestrationService
  ) {}

  /**
   * Daily cron job at 3 AM UTC.
   * Queries eligible users and adds staggered jobs to the queue.
   */
  @Cron('0 3 * * *')
  async scheduleOrchestration(): Promise<void> {
    this.logger.log('Starting daily backtest orchestration scheduling');

    try {
      const eligibleUsers = await this.orchestrationService.getEligibleUsers();
      this.logger.log(`Found ${eligibleUsers.length} eligible users for orchestration`);

      if (eligibleUsers.length === 0) {
        this.logger.log('No eligible users found, skipping orchestration');
        return;
      }

      // Queue jobs with staggered delays
      for (let i = 0; i < eligibleUsers.length; i++) {
        const user = eligibleUsers[i];
        const delay = i * STAGGER_INTERVAL_MS;

        const jobData: OrchestrationJobData = {
          userId: user.id,
          scheduledAt: new Date().toISOString(),
          riskLevel: user.risk?.level ?? 3
        };

        await this.orchestrationQueue.add('orchestrate-user', jobData, {
          delay,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 60000 // 1 minute base delay
          },
          removeOnComplete: true,
          removeOnFail: false // Keep failed jobs for inspection
        });

        this.logger.debug(`Queued orchestration for user ${user.id} with ${delay}ms delay`);
      }

      this.logger.log(`Successfully queued ${eligibleUsers.length} orchestration jobs`);
    } catch (error) {
      this.logger.error(`Failed to schedule orchestration: ${error.message}`, error.stack);
    }
  }

  /**
   * Manually trigger orchestration for a specific user or all eligible users.
   * Useful for admin operations and testing.
   */
  async triggerManualOrchestration(userId?: string): Promise<{ queued: number }> {
    this.logger.log(`Manual orchestration triggered${userId ? ` for user ${userId}` : ' for all eligible users'}`);

    if (userId) {
      // Queue single user
      const jobData: OrchestrationJobData = {
        userId,
        scheduledAt: new Date().toISOString(),
        riskLevel: 3 // Will be resolved from user in processor
      };

      await this.orchestrationQueue.add('orchestrate-user', jobData, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 60000
        },
        removeOnComplete: true,
        removeOnFail: false
      });

      return { queued: 1 };
    }

    // Trigger full orchestration
    await this.scheduleOrchestration();
    const eligibleCount = (await this.orchestrationService.getEligibleUsers()).length;
    return { queued: eligibleCount };
  }

  /**
   * Get queue statistics for monitoring.
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.orchestrationQueue.getWaitingCount(),
      this.orchestrationQueue.getActiveCount(),
      this.orchestrationQueue.getCompletedCount(),
      this.orchestrationQueue.getFailedCount(),
      this.orchestrationQueue.getDelayedCount()
    ]);

    return { waiting, active, completed, failed, delayed };
  }
}
