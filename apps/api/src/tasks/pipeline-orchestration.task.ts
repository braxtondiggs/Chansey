/**
 * Pipeline Orchestration Task
 *
 * Scheduled task that runs daily at 2 AM UTC to orchestrate
 * automatic full validation pipelines for users with algo trading enabled.
 *
 * Creates pipelines that run through:
 * Optimization → Historical → Live Replay → Paper Trading
 */

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { Queue } from 'bullmq';

import {
  DEFAULT_RISK_LEVEL,
  PipelineOrchestrationJobData,
  STAGGER_INTERVAL_MS
} from './dto/pipeline-orchestration.dto';
import { PipelineOrchestrationService } from './pipeline-orchestration.service';

import { BacktestService } from '../order/backtest/backtest.service';
import { toErrorInfo } from '../shared/error.util';

@Injectable()
export class PipelineOrchestrationTask {
  private readonly logger = new Logger(PipelineOrchestrationTask.name);

  constructor(
    @InjectQueue('pipeline-orchestration')
    private readonly orchestrationQueue: Queue<PipelineOrchestrationJobData>,
    private readonly orchestrationService: PipelineOrchestrationService,
    private readonly backtestService: BacktestService
  ) {}

  /**
   * Daily cron job at 2 AM UTC (before backtest orchestration at 3 AM).
   * Queries eligible users and adds staggered jobs to the queue.
   */
  @Cron('0 2 * * *')
  async scheduleOrchestration(): Promise<void> {
    this.logger.log('Starting daily pipeline orchestration scheduling');

    try {
      // Ensure default dataset exists before creating pipelines
      await this.backtestService.ensureDefaultDatasetExists();

      // Seed strategy configs from active algorithms (global, not user-scoped)
      await this.orchestrationService.seedStrategyConfigsFromAlgorithms();

      const eligibleUsers = await this.orchestrationService.getEligibleUsers();
      this.logger.log(`Found ${eligibleUsers.length} eligible users for pipeline orchestration`);

      if (eligibleUsers.length === 0) {
        this.logger.log('No eligible users found, skipping pipeline orchestration');
        return;
      }

      // Queue jobs with staggered delays (1 minute apart)
      for (let i = 0; i < eligibleUsers.length; i++) {
        const user = eligibleUsers[i];
        const delay = i * STAGGER_INTERVAL_MS;

        const jobData: PipelineOrchestrationJobData = {
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
          removeOnFail: 50 // Keep last 50 failed jobs for inspection
        });

        this.logger.debug(`Queued pipeline orchestration for user ${user.id} with ${delay}ms delay`);
      }

      this.logger.log(`Successfully queued ${eligibleUsers.length} pipeline orchestration jobs`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to schedule pipeline orchestration: ${err.message}`, err.stack);
    }
  }

  /**
   * Manually trigger orchestration for a specific user or all eligible users.
   * Useful for admin operations and testing.
   */
  async triggerManualOrchestration(userId?: string): Promise<{ queued: number }> {
    this.logger.log(
      `Manual pipeline orchestration triggered${userId ? ` for user ${userId}` : ' for all eligible users'}`
    );

    if (userId) {
      // Queue single user - riskLevel is a placeholder for logging only
      // The actual risk level is always fetched fresh from the database during processing
      const jobData: PipelineOrchestrationJobData = {
        userId,
        scheduledAt: new Date().toISOString(),
        riskLevel: DEFAULT_RISK_LEVEL
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
}
