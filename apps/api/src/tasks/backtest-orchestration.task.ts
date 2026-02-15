/**
 * Backtest Orchestration Task
 *
 * Scheduled task that runs twice daily at 3 AM and 3 PM UTC to orchestrate
 * automatic backtests for users with algo trading enabled.
 */

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { IsNull, LessThan, Repository } from 'typeorm';

import { BacktestOrchestrationService } from './backtest-orchestration.service';
import { OrchestrationJobData, STAGGER_INTERVAL_MS } from './dto/backtest-orchestration.dto';

import { BacktestResultService } from '../order/backtest/backtest-result.service';
import { Backtest, BacktestStatus, BacktestType } from '../order/backtest/backtest.entity';
import { BacktestService } from '../order/backtest/backtest.service';
import { toErrorInfo } from '../shared/error.util';

@Injectable()
export class BacktestOrchestrationTask {
  private static readonly HISTORICAL_THRESHOLD_MS = 90 * 60 * 1000;
  private static readonly LIVE_REPLAY_THRESHOLD_MS = 120 * 60 * 1000;

  private readonly logger = new Logger(BacktestOrchestrationTask.name);

  constructor(
    @InjectQueue('backtest-orchestration')
    private readonly orchestrationQueue: Queue<OrchestrationJobData>,
    private readonly orchestrationService: BacktestOrchestrationService,
    private readonly backtestService: BacktestService,
    private readonly backtestResultService: BacktestResultService,
    @InjectRepository(Backtest) private readonly backtestRepository: Repository<Backtest>
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
      await this.backtestService.ensureDefaultDatasetExists();

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

  /**
   * Watchdog that detects and fails stale RUNNING backtests.
   * Uses type-aware thresholds: 90 min for HISTORICAL, 120 min for LIVE_REPLAY.
   * The lastCheckpointAt column is updated by both heartbeats (~30s) and checkpoints,
   * so this effectively checks "no heartbeat progress" rather than just checkpoint saves.
   * PAPER_TRADING and STRATEGY_OPTIMIZATION are excluded entirely.
   * Errors on individual markFailed calls do not abort the loop.
   */
  @Cron('*/15 * * * *')
  async detectStaleBacktests(): Promise<void> {
    const historicalCutoff = new Date(Date.now() - BacktestOrchestrationTask.HISTORICAL_THRESHOLD_MS);
    const liveReplayCutoff = new Date(Date.now() - BacktestOrchestrationTask.LIVE_REPLAY_THRESHOLD_MS);

    // Query stale HISTORICAL backtests (90-min threshold)
    const staleHistorical = await this.backtestRepository.find({
      where: [
        { status: BacktestStatus.RUNNING, type: BacktestType.HISTORICAL, lastCheckpointAt: LessThan(historicalCutoff) },
        {
          status: BacktestStatus.RUNNING,
          type: BacktestType.HISTORICAL,
          lastCheckpointAt: IsNull(),
          updatedAt: LessThan(historicalCutoff)
        }
      ]
    });

    // Query stale LIVE_REPLAY backtests (120-min threshold)
    const staleLiveReplay = await this.backtestRepository.find({
      where: [
        {
          status: BacktestStatus.RUNNING,
          type: BacktestType.LIVE_REPLAY,
          lastCheckpointAt: LessThan(liveReplayCutoff)
        },
        {
          status: BacktestStatus.RUNNING,
          type: BacktestType.LIVE_REPLAY,
          lastCheckpointAt: IsNull(),
          updatedAt: LessThan(liveReplayCutoff)
        }
      ]
    });

    const staleBacktests = [
      ...staleHistorical.map((bt) => ({
        backtest: bt,
        thresholdMs: BacktestOrchestrationTask.HISTORICAL_THRESHOLD_MS
      })),
      ...staleLiveReplay.map((bt) => ({
        backtest: bt,
        thresholdMs: BacktestOrchestrationTask.LIVE_REPLAY_THRESHOLD_MS
      }))
    ];

    for (const { backtest, thresholdMs } of staleBacktests) {
      try {
        this.logger.warn(
          `Marking stale ${backtest.type} backtest ${backtest.id} as FAILED ` +
            `(last heartbeat: ${backtest.lastCheckpointAt?.toISOString()}, ` +
            `progress: ${backtest.processedTimestampCount}/${backtest.totalTimestampCount})`
        );
        await this.backtestResultService.markFailed(
          backtest.id,
          `Stale: no heartbeat progress for ${Math.round(thresholdMs / 60000)} min. ` +
            `Last index: ${backtest.checkpointState?.lastProcessedIndex ?? 'unknown'}`
        );
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Failed to mark stale backtest ${backtest.id} as FAILED: ${err.message}`);
      }
    }

    if (staleBacktests.length > 0) {
      this.logger.log(`Stale watchdog marked ${staleBacktests.length} backtest(s) as FAILED`);
    }
  }
}
