/**
 * Backtest Watchdog Service
 *
 * Detects and fails stale/orphaned backtests, optimization runs, and pipelines.
 * Called on a 15-minute cron by BacktestOrchestrationTask.
 */

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { In, IsNull, LessThan, Not, Repository } from 'typeorm';

import { OptimizationRun, OptimizationStatus } from '../optimization/entities/optimization-run.entity';
import { BacktestResultService } from '../order/backtest/backtest-result.service';
import { backtestConfig } from '../order/backtest/backtest.config';
import { Backtest, BacktestStatus, BacktestType } from '../order/backtest/backtest.entity';
import { Pipeline } from '../pipeline/entities/pipeline.entity';
import { PIPELINE_EVENTS, PipelineStage, PipelineStatus } from '../pipeline/interfaces';
import { toErrorInfo } from '../shared/error.util';

const BACKTEST_QUEUE_NAMES = backtestConfig();

/** How long after boot before watchdog kicks in */
const BOOT_GRACE_PERIOD_MS = 10 * 60 * 1000; // 10 min

/** Stale thresholds by entity type */
const HISTORICAL_THRESHOLD_MS = 90 * 60 * 1000;
const LIVE_REPLAY_THRESHOLD_MS = 120 * 60 * 1000;
const PENDING_BACKTEST_THRESHOLD_MS = 30 * 60 * 1000;
const OPTIMIZATION_THRESHOLD_MS = 360 * 60 * 1000; // 6 hours
const PENDING_OPTIMIZATION_THRESHOLD_MS = 360 * 60 * 1000; // 6 hours

@Injectable()
export class BacktestWatchdogService {
  private readonly bootedAt = Date.now();
  private readonly logger = new Logger(BacktestWatchdogService.name);

  constructor(
    @InjectQueue(BACKTEST_QUEUE_NAMES.historicalQueue)
    private readonly historicalQueue: Queue,
    @InjectQueue(BACKTEST_QUEUE_NAMES.replayQueue)
    private readonly replayQueue: Queue,
    @InjectQueue('optimization')
    private readonly optimizationQueue: Queue,
    private readonly backtestResultService: BacktestResultService,
    private readonly eventEmitter: EventEmitter2,
    @InjectRepository(Backtest) private readonly backtestRepository: Repository<Backtest>,
    @InjectRepository(OptimizationRun) private readonly optimizationRunRepository: Repository<OptimizationRun>,
    @InjectRepository(Pipeline) private readonly pipelineRepository: Repository<Pipeline>
  ) {}

  /**
   * Detects and fails stale RUNNING backtests.
   * Uses type-aware thresholds: 90 min for HISTORICAL, 120 min for LIVE_REPLAY.
   * The lastCheckpointAt column is updated by both heartbeats (~30s) and checkpoints,
   * so this effectively checks "no heartbeat progress" rather than just checkpoint saves.
   * PAPER_TRADING and STRATEGY_OPTIMIZATION are excluded entirely.
   * Errors on individual markFailed calls do not abort the loop.
   */
  async detectStaleBacktests(): Promise<void> {
    if (this.isWithinBootGrace()) return;

    const historicalCutoff = new Date(Date.now() - HISTORICAL_THRESHOLD_MS);
    const liveReplayCutoff = new Date(Date.now() - LIVE_REPLAY_THRESHOLD_MS);
    const pendingCutoff = new Date(Date.now() - PENDING_BACKTEST_THRESHOLD_MS);

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

    // Query PENDING backtests stuck too long (30-min threshold).
    // A backtest should transition from PENDING to RUNNING within seconds of being
    // picked up by a worker. Being PENDING for 30+ min means the BullMQ job was
    // likely lost (e.g., stale jobId collision after deployment).
    const stalePending = await this.backtestRepository.find({
      where: [
        { status: BacktestStatus.PENDING, type: BacktestType.HISTORICAL, updatedAt: LessThan(pendingCutoff) },
        { status: BacktestStatus.PENDING, type: BacktestType.LIVE_REPLAY, updatedAt: LessThan(pendingCutoff) }
      ]
    });

    const staleBacktests = [
      ...staleHistorical.map((bt) => ({ backtest: bt, thresholdMs: HISTORICAL_THRESHOLD_MS })),
      ...staleLiveReplay.map((bt) => ({ backtest: bt, thresholdMs: LIVE_REPLAY_THRESHOLD_MS })),
      ...stalePending.map((bt) => ({ backtest: bt, thresholdMs: PENDING_BACKTEST_THRESHOLD_MS }))
    ];

    let marked = 0;
    for (const { backtest, thresholdMs } of staleBacktests) {
      try {
        const isPending = backtest.status === BacktestStatus.PENDING;

        // For PENDING backtests, check if the BullMQ job is legitimately queued
        if (isPending) {
          const queue = this.getQueueForBacktestType(backtest.type);
          if (queue && (await this.isJobLegitimatelyQueued(queue, backtest.id))) {
            this.logger.debug(`Skipping PENDING backtest ${backtest.id} — BullMQ job still legitimately queued`);
            continue;
          }
        }

        const reason = isPending
          ? `Stuck PENDING for ${Math.round(thresholdMs / 60000)} min — BullMQ job likely lost`
          : `Stale: no heartbeat progress for ${Math.round(thresholdMs / 60000)} min. ` +
            `Last index: ${backtest.checkpointState?.lastProcessedIndex ?? 'unknown'}`;

        this.logger.warn(
          `Marking stale ${backtest.status} ${backtest.type} backtest ${backtest.id} as FAILED ` +
            (isPending
              ? `(updated: ${backtest.updatedAt?.toISOString()})`
              : `(last heartbeat: ${backtest.lastCheckpointAt?.toISOString()}, ` +
                `progress: ${backtest.processedTimestampCount}/${backtest.totalTimestampCount})`)
        );
        await this.backtestResultService.markFailed(backtest.id, reason);
        marked++;
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Failed to mark stale backtest ${backtest.id} as FAILED: ${err.message}`);
      }
    }

    if (marked > 0) {
      this.logger.log(`Stale watchdog marked ${marked} backtest(s) as FAILED`);
    }
  }

  /**
   * Detects stale RUNNING optimization runs.
   * Uses lastHeartbeatAt (updated every ~10 windows and on batch progress).
   * Falls back to startedAt when no heartbeat has ever been recorded.
   */
  async detectStaleOptimizationRuns(): Promise<void> {
    if (this.isWithinBootGrace()) return;

    const runningCutoff = new Date(Date.now() - OPTIMIZATION_THRESHOLD_MS);
    const pendingCutoff = new Date(Date.now() - PENDING_OPTIMIZATION_THRESHOLD_MS);

    const staleRuns = await this.optimizationRunRepository.find({
      where: [
        { status: OptimizationStatus.RUNNING, lastHeartbeatAt: LessThan(runningCutoff) },
        { status: OptimizationStatus.RUNNING, lastHeartbeatAt: IsNull(), startedAt: LessThan(runningCutoff) },
        { status: OptimizationStatus.PENDING, createdAt: LessThan(pendingCutoff) }
      ]
    });

    let marked = 0;
    for (const run of staleRuns) {
      try {
        const isPending = run.status === OptimizationStatus.PENDING;

        // For PENDING optimization runs, check if the BullMQ job is legitimately queued
        if (isPending && (await this.isJobLegitimatelyQueued(this.optimizationQueue, run.id))) {
          this.logger.debug(`Skipping PENDING optimization run ${run.id} — BullMQ job still legitimately queued`);
          continue;
        }

        const thresholdMin = Math.round(
          (isPending ? PENDING_OPTIMIZATION_THRESHOLD_MS : OPTIMIZATION_THRESHOLD_MS) / 60000
        );
        const reason = isPending
          ? `Stale: PENDING for ${thresholdMin} min without being picked up by worker. ` +
            `Created: ${run.createdAt.toISOString()}`
          : `Stale: no heartbeat for ${thresholdMin} min. ` +
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

        marked++;
        this.eventEmitter.emit(PIPELINE_EVENTS.OPTIMIZATION_FAILED, {
          runId: run.id,
          reason
        });
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Failed to mark stale optimization run ${run.id} as FAILED: ${err.message}`);
      }
    }

    if (marked > 0) {
      this.logger.log(`Stale optimization watchdog marked ${marked} run(s) as FAILED`);
    }
  }

  /**
   * Detects orphaned pipelines stuck in OPTIMIZE stage
   * with no optimization run ever started.
   */
  async detectOrphanedOptimizePipelines(): Promise<void> {
    if (this.isWithinBootGrace()) return;

    const cutoff = new Date(Date.now() - OPTIMIZATION_THRESHOLD_MS);

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

  /**
   * Detects RUNNING pipelines in OPTIMIZE stage whose
   * linked optimization run has already FAILED (or been deleted).
   * No time-based cutoff — a RUNNING pipeline with a FAILED optimization run is always invalid.
   */
  async detectFailedOptimizationPipelines(): Promise<void> {
    if (this.isWithinBootGrace()) return;

    const candidates = await this.pipelineRepository.find({
      where: {
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.OPTIMIZE,
        optimizationRunId: Not(IsNull())
      }
    });

    const runIds = candidates.map((p) => p.optimizationRunId).filter((id): id is string => id != null);
    const runs = runIds.length > 0 ? await this.optimizationRunRepository.find({ where: { id: In(runIds) } }) : [];
    const runsById = new Map(runs.map((r) => [r.id, r]));

    let marked = 0;
    for (const pipeline of candidates) {
      try {
        const run = pipeline.optimizationRunId ? runsById.get(pipeline.optimizationRunId) : undefined;

        // Pipeline is invalid if its optimization run is FAILED or missing entirely
        if (run && run.status !== OptimizationStatus.FAILED) {
          continue;
        }

        const reason = run
          ? `Optimization run ${run.id} FAILED: ${run.errorMessage || 'unknown error'}`
          : `Optimization run ${pipeline.optimizationRunId} no longer exists`;

        this.logger.warn(`Marking pipeline ${pipeline.id} as FAILED — ${reason}`);

        const result = await this.pipelineRepository.update(
          { id: pipeline.id, status: PipelineStatus.RUNNING },
          {
            status: PipelineStatus.FAILED,
            failureReason: reason,
            completedAt: new Date()
          }
        );

        if (result.affected === 0) {
          this.logger.log(`Pipeline ${pipeline.id} already transitioned — skipping`);
          continue;
        }

        marked++;
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Failed to mark pipeline ${pipeline.id} with failed optimization as FAILED: ${err.message}`);
      }
    }

    if (marked > 0) {
      this.logger.log(`Failed-optimization pipeline watchdog marked ${marked} pipeline(s) as FAILED`);
    }
  }

  /**
   * Check if a BullMQ job is legitimately queued (waiting or delayed).
   * Returns false on missing job or any error (lets watchdog proceed on failure).
   */
  private async isJobLegitimatelyQueued(queue: Queue, jobId: string): Promise<boolean> {
    try {
      const job = await queue.getJob(jobId);
      if (!job) return false;
      const state = await job.getState();
      return state === 'waiting' || state === 'delayed' || state === 'active';
    } catch (error: unknown) {
      this.logger.warn(`Failed to check queue status for job ${jobId}: ${toErrorInfo(error).message}`);
      return false;
    }
  }

  /**
   * Map a backtest type to its corresponding BullMQ queue.
   */
  private getQueueForBacktestType(type: BacktestType): Queue | null {
    switch (type) {
      case BacktestType.HISTORICAL:
        return this.historicalQueue;
      case BacktestType.LIVE_REPLAY:
        return this.replayQueue;
      default:
        return null;
    }
  }

  private isWithinBootGrace(): boolean {
    const timeSinceBoot = Date.now() - this.bootedAt;
    if (timeSinceBoot < BOOT_GRACE_PERIOD_MS) {
      this.logger.debug(
        `Skipping stale detection — server booted ${Math.round(timeSinceBoot / 1000)}s ago ` +
          `(grace period: ${BOOT_GRACE_PERIOD_MS / 60000} min)`
      );
      return true;
    }
    return false;
  }
}
