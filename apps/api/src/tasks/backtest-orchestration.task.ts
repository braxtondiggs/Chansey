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
import { BacktestWatchdogService } from './backtest-watchdog.service';
import { BACKTEST_STAGGER_INTERVAL_MS, OrchestrationJobData } from './dto/backtest-orchestration.dto';

import { BacktestDatasetService } from '../order/backtest/backtest-dataset.service';
import { toErrorInfo } from '../shared/error.util';

@Injectable()
export class BacktestOrchestrationTask {
  private readonly logger = new Logger(BacktestOrchestrationTask.name);
  private watchdogRunning = false;

  constructor(
    @InjectQueue('backtest-orchestration')
    private readonly orchestrationQueue: Queue<OrchestrationJobData>,
    private readonly orchestrationService: BacktestOrchestrationService,
    private readonly backtestDatasetService: BacktestDatasetService,
    private readonly watchdog: BacktestWatchdogService
  ) {}

  /**
   * Daily cron job at 3 AM UTC.
   * Queries eligible users and adds staggered jobs to the queue.
   */
  @Cron('0 3 * * *')
  async scheduleOrchestration(): Promise<void> {
    this.logger.log('Starting daily backtest orchestration scheduling');

    try {
      // Ensure a database-backed dataset exists before orchestrating
      await this.backtestDatasetService.ensureDefaultDatasetExists();

      const eligibleUsers = await this.orchestrationService.getEligibleUsers();
      this.logger.log(`Found ${eligibleUsers.length} eligible users for orchestration`);

      if (eligibleUsers.length === 0) {
        this.logger.log('No eligible users found, skipping orchestration');
        return;
      }

      // Queue jobs with staggered delays
      for (let i = 0; i < eligibleUsers.length; i++) {
        const user = eligibleUsers[i];
        const delay = i * BACKTEST_STAGGER_INTERVAL_MS;

        const jobData: OrchestrationJobData = {
          userId: user.id,
          scheduledAt: new Date().toISOString(),
          riskLevel: user.effectiveCalculationRiskLevel
        };

        await this.orchestrationQueue.add('orchestrate-user', jobData, {
          delay,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 60000 // 1 minute base delay
          },
          removeOnComplete: true,
          removeOnFail: 50 // Keep last 50 failed jobs for inspection
        });

        this.logger.debug(`Queued orchestration for user ${user.id} with ${delay}ms delay`);
      }

      this.logger.log(`Successfully queued ${eligibleUsers.length} orchestration jobs`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to schedule orchestration: ${err.message}`, err.stack);
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
        scheduledAt: new Date().toISOString()
      };

      await this.orchestrationQueue.add('orchestrate-user', jobData, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 60000
        },
        removeOnComplete: true,
        removeOnFail: 50
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

  @Cron('*/15 * * * *')
  async runWatchdogChecks(): Promise<void> {
    if (this.watchdogRunning) {
      this.logger.debug('Watchdog checks already running, skipping');
      return;
    }

    this.watchdogRunning = true;
    try {
      await this.watchdog.detectStaleBacktests();
      await this.watchdog.detectStaleOptimizationRuns();
      await this.watchdog.detectOrphanedOptimizePipelines();
      await this.watchdog.detectFailedOptimizationPipelines();
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Watchdog checks failed: ${err.message}`, err.stack);
    } finally {
      this.watchdogRunning = false;
    }
  }
}
