/**
 * Backtest Orchestration Task
 *
 * Scheduled task that runs daily at 3 AM UTC to orchestrate
 * automatic backtests for users with algo trading enabled.
 */

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { In, IsNull, LessThan, Repository } from 'typeorm';

import { BacktestOrchestrationService } from './backtest-orchestration.service';
import { OrchestrationJobData, STAGGER_INTERVAL_MS } from './dto/backtest-orchestration.dto';

import { OptimizationRun, OptimizationStatus } from '../optimization/entities/optimization-run.entity';
import { BacktestResultService } from '../order/backtest/backtest-result.service';
import { Backtest, BacktestStatus, BacktestType } from '../order/backtest/backtest.entity';
import { BacktestService } from '../order/backtest/backtest.service';
import { Pipeline } from '../pipeline/entities/pipeline.entity';
import { PIPELINE_EVENTS, PipelineStage, PipelineStatus } from '../pipeline/interfaces';
import { toErrorInfo } from '../shared/error.util';

@Injectable()
export class BacktestOrchestrationTask {
  private static readonly BOOT_GRACE_PERIOD_MS = 10 * 60 * 1000; // 10 min
  private static readonly HISTORICAL_THRESHOLD_MS = 90 * 60 * 1000;
  private static readonly LIVE_REPLAY_THRESHOLD_MS = 120 * 60 * 1000;
  private static readonly OPTIMIZATION_THRESHOLD_MS = 360 * 60 * 1000; // 6 hours

  private readonly bootedAt = Date.now();
  private readonly logger = new Logger(BacktestOrchestrationTask.name);

  constructor(
    @InjectQueue('backtest-orchestration')
    private readonly orchestrationQueue: Queue<OrchestrationJobData>,
    private readonly orchestrationService: BacktestOrchestrationService,
    private readonly backtestService: BacktestService,
    private readonly backtestResultService: BacktestResultService,
    private readonly eventEmitter: EventEmitter2,
    @InjectRepository(Backtest) private readonly backtestRepository: Repository<Backtest>,
    @InjectRepository(OptimizationRun) private readonly optimizationRunRepository: Repository<OptimizationRun>,
    @InjectRepository(Pipeline) private readonly pipelineRepository: Repository<Pipeline>
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
    const timeSinceBoot = Date.now() - this.bootedAt;
    if (timeSinceBoot < BacktestOrchestrationTask.BOOT_GRACE_PERIOD_MS) {
      this.logger.debug(
        `Skipping stale detection — server booted ${Math.round(timeSinceBoot / 1000)}s ago ` +
          `(grace period: ${BacktestOrchestrationTask.BOOT_GRACE_PERIOD_MS / 60000} min)`
      );
      return;
    }

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

  /**
   * Watchdog that detects stale RUNNING optimization runs.
   * Uses lastHeartbeatAt (updated every ~10 windows and on batch progress).
   * Falls back to startedAt when no heartbeat has ever been recorded.
   */
  @Cron('*/15 * * * *')
  async detectStaleOptimizationRuns(): Promise<void> {
    const timeSinceBoot = Date.now() - this.bootedAt;
    if (timeSinceBoot < BacktestOrchestrationTask.BOOT_GRACE_PERIOD_MS) {
      return;
    }

    const cutoff = new Date(Date.now() - BacktestOrchestrationTask.OPTIMIZATION_THRESHOLD_MS);

    const staleRuns = await this.optimizationRunRepository.find({
      where: [
        { status: OptimizationStatus.RUNNING, lastHeartbeatAt: LessThan(cutoff) },
        { status: OptimizationStatus.RUNNING, lastHeartbeatAt: IsNull(), startedAt: LessThan(cutoff) }
      ]
    });

    for (const run of staleRuns) {
      try {
        const reason =
          `Stale: no heartbeat for ${Math.round(BacktestOrchestrationTask.OPTIMIZATION_THRESHOLD_MS / 60000)} min. ` +
          `Progress: ${run.combinationsTested}/${run.totalCombinations}`;

        this.logger.warn(`Marking stale optimization run ${run.id} as FAILED: ${reason}`);

        const result = await this.optimizationRunRepository.update(
          { id: run.id, status: In([OptimizationStatus.RUNNING, OptimizationStatus.PENDING]) },
          {
            status: OptimizationStatus.FAILED,
            errorMessage: reason,
            completedAt: new Date()
          }
        );

        if (result.affected === 0) {
          this.logger.log(`Optimization run ${run.id} already transitioned — skipping event emission`);
          continue;
        }

        this.eventEmitter.emit(PIPELINE_EVENTS.OPTIMIZATION_FAILED, {
          runId: run.id,
          reason
        });
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Failed to mark stale optimization run ${run.id} as FAILED: ${err.message}`);
      }
    }

    if (staleRuns.length > 0) {
      this.logger.log(`Stale optimization watchdog marked ${staleRuns.length} run(s) as FAILED`);
    }
  }

  /**
   * Watchdog that detects orphaned pipelines stuck in OPTIMIZE stage
   * with no optimization run ever started.
   */
  @Cron('*/15 * * * *')
  async detectOrphanedOptimizePipelines(): Promise<void> {
    const timeSinceBoot = Date.now() - this.bootedAt;
    if (timeSinceBoot < BacktestOrchestrationTask.BOOT_GRACE_PERIOD_MS) {
      return;
    }

    const cutoff = new Date(Date.now() - BacktestOrchestrationTask.OPTIMIZATION_THRESHOLD_MS);

    const orphanedPipelines = await this.pipelineRepository.find({
      where: {
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.OPTIMIZE,
        optimizationRunId: IsNull(),
        updatedAt: LessThan(cutoff)
      }
    });

    for (const pipeline of orphanedPipelines) {
      try {
        this.logger.warn(
          `Marking orphaned pipeline ${pipeline.id} as FAILED (OPTIMIZE stage, no optimization run started)`
        );

        const result = await this.pipelineRepository.update(
          { id: pipeline.id, status: PipelineStatus.RUNNING },
          {
            status: PipelineStatus.FAILED,
            failureReason: 'Orphaned: optimization never started',
            completedAt: new Date()
          }
        );

        if (result.affected === 0) {
          this.logger.log(`Pipeline ${pipeline.id} already transitioned — skipping`);
          continue;
        }
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Failed to mark orphaned pipeline ${pipeline.id} as FAILED: ${err.message}`);
      }
    }

    if (orphanedPipelines.length > 0) {
      this.logger.log(`Orphaned pipeline watchdog marked ${orphanedPipelines.length} pipeline(s) as FAILED`);
    }
  }
}
