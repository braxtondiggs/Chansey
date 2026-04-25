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
import { PaperTradingSession, PaperTradingStatus } from '../order/paper-trading/entities';
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

/**
 * Paper-trade pipeline reconciliation thresholds.
 *
 * Session-level heartbeat watchdog lives in PaperTradingRecoveryService (5-min cron,
 * 10/20-min recovery/fail tiers). This watchdog only closes the pipeline-side loop
 * when the session's own watchdog has already terminated it or when a pipeline was
 * promoted to PAPER_TRADE without ever creating a session.
 */
const PAPER_TRADE_ORPHAN_THRESHOLD_MS = 30 * 60 * 1000;

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
    @InjectRepository(Pipeline) private readonly pipelineRepository: Repository<Pipeline>,
    @InjectRepository(PaperTradingSession)
    private readonly paperTradingSessionRepository: Repository<PaperTradingSession>
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
          ? `Stuck PENDING for ${Math.round(thresholdMs / 60000)} min without being picked up by worker (possible worker crash, job loss, or Redis state reset)`
          : `Stale: no heartbeat progress for ${Math.round(thresholdMs / 60000)} min. ` +
            `Last index: ${backtest.checkpointState?.lastProcessedIndex ?? 'unknown'}`;

        this.logger.warn(
          `Marking stale ${backtest.status} ${backtest.type} backtest ${backtest.id} as FAILED ` +
            (isPending
              ? `(updated: ${backtest.updatedAt?.toISOString()})`
              : `(last heartbeat: ${backtest.lastCheckpointAt?.toISOString()}, ` +
                `progress: ${backtest.processedTimestampCount}/${backtest.totalTimestampCount})`)
        );
        // markFailed() now emits PIPELINE_EVENTS.BACKTEST_FAILED internally so the parent
        // pipeline can transition to FAILED instead of orphaning.
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
   * Detects RUNNING pipelines in HISTORICAL or LIVE_REPLAY stage whose linked backtest
   * has already FAILED (or been deleted). This is the reconciliation safety net for cases
   * where the BACKTEST_FAILED event was never delivered (process kill between DB commit
   * and emit, listener exception, etc.) — mirrors detectFailedOptimizationPipelines.
   */
  async detectFailedBacktestPipelines(): Promise<void> {
    if (this.isWithinBootGrace()) return;

    const candidates = await this.pipelineRepository.find({
      select: ['id', 'status', 'currentStage', 'historicalBacktestId', 'liveReplayBacktestId'],
      where: [
        {
          status: PipelineStatus.RUNNING,
          currentStage: PipelineStage.HISTORICAL,
          historicalBacktestId: Not(IsNull())
        },
        {
          status: PipelineStatus.RUNNING,
          currentStage: PipelineStage.LIVE_REPLAY,
          liveReplayBacktestId: Not(IsNull())
        }
      ]
    });

    // Batch-fetch the linked backtests for all candidates
    const backtestIds = candidates
      .map((p) => (p.currentStage === PipelineStage.HISTORICAL ? p.historicalBacktestId : p.liveReplayBacktestId))
      .filter((id): id is string => id != null);
    const backtests =
      backtestIds.length > 0
        ? await this.backtestRepository.find({
            select: ['id', 'status', 'errorMessage'],
            where: { id: In(backtestIds) }
          })
        : [];
    const backtestsById = new Map(backtests.map((b) => [b.id, b]));

    let marked = 0;
    for (const pipeline of candidates) {
      try {
        const stage = pipeline.currentStage;
        const linkedId =
          stage === PipelineStage.HISTORICAL ? pipeline.historicalBacktestId : pipeline.liveReplayBacktestId;
        if (!linkedId) continue;

        const backtest = backtestsById.get(linkedId);

        // Pipeline is invalid if its backtest is FAILED or missing entirely
        if (backtest && backtest.status !== BacktestStatus.FAILED) {
          continue;
        }

        const reason = backtest
          ? `${stage} backtest ${backtest.id} FAILED: ${backtest.errorMessage || 'unknown error'}`
          : `${stage} backtest ${linkedId} no longer exists`;

        this.logger.warn(`Marking pipeline ${pipeline.id} as FAILED — ${reason}`);

        // Include currentStage in the predicate so we don't fail a pipeline that advanced
        // to a different stage between our find() and update().
        const result = await this.pipelineRepository.update(
          { id: pipeline.id, status: PipelineStatus.RUNNING, currentStage: stage },
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
        this.logger.error(`Failed to mark pipeline ${pipeline.id} with failed backtest as FAILED: ${err.message}`);
      }
    }

    if (marked > 0) {
      this.logger.log(`Failed-backtest pipeline watchdog marked ${marked} pipeline(s) as FAILED`);
    }
  }

  /**
   * Detects RUNNING pipelines in PAPER_TRADE stage whose linked paper trading session
   * has already reached a terminal failure state (FAILED, STOPPED) or been deleted.
   * Mirrors detectFailedBacktestPipelines — the reconciliation safety net for cases
   * where PaperTradingRecoveryService marked the session FAILED but the
   * paper-trading.failed event never reached the pipeline listener.
   *
   * COMPLETED sessions are intentionally skipped here — those belong to a recovery
   * path that re-emits paper-trading.completed so progression gates can run.
   */
  async detectFailedPaperTradingPipelines(): Promise<void> {
    if (this.isWithinBootGrace()) return;

    const candidates = await this.pipelineRepository.find({
      select: ['id', 'status', 'currentStage', 'paperTradingSessionId'],
      where: {
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.PAPER_TRADE,
        paperTradingSessionId: Not(IsNull())
      }
    });

    const sessionIds = candidates.map((p) => p.paperTradingSessionId).filter((id): id is string => id != null);
    const sessions =
      sessionIds.length > 0
        ? await this.paperTradingSessionRepository.find({
            select: ['id', 'status', 'stoppedReason'],
            where: { id: In(sessionIds) }
          })
        : [];
    const sessionsById = new Map(sessions.map((s) => [s.id, s]));

    let marked = 0;
    for (const pipeline of candidates) {
      try {
        if (!pipeline.paperTradingSessionId) continue;
        const session = sessionsById.get(pipeline.paperTradingSessionId);

        // Pipeline is invalid when the session failed, was stopped without advancing,
        // or no longer exists. ACTIVE/PAUSED/COMPLETED sessions are not our problem.
        const isBroken =
          !session || session.status === PaperTradingStatus.FAILED || session.status === PaperTradingStatus.STOPPED;
        if (!isBroken) continue;

        const reason = session
          ? `Paper trading session ${session.id} ${session.status}: ${session.stoppedReason ?? 'unknown reason'}`
          : `Paper trading session ${pipeline.paperTradingSessionId} no longer exists`;

        this.logger.warn(`Marking pipeline ${pipeline.id} as FAILED — ${reason}`);

        const result = await this.pipelineRepository.update(
          { id: pipeline.id, status: PipelineStatus.RUNNING, currentStage: PipelineStage.PAPER_TRADE },
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
        this.logger.error(
          `Failed to mark pipeline ${pipeline.id} with failed paper trading session as FAILED: ${err.message}`
        );
      }
    }

    if (marked > 0) {
      this.logger.log(`Failed paper-trade pipeline watchdog marked ${marked} pipeline(s) as FAILED`);
    }
  }

  /**
   * Detects orphaned pipelines that advanced to PAPER_TRADE but never got a
   * paper trading session attached (creation failed between stage transition and insert).
   * Mirrors detectOrphanedOptimizePipelines.
   */
  async detectOrphanedPaperTradePipelines(): Promise<void> {
    if (this.isWithinBootGrace()) return;

    const cutoff = new Date(Date.now() - PAPER_TRADE_ORPHAN_THRESHOLD_MS);

    const orphans = await this.pipelineRepository.find({
      where: {
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.PAPER_TRADE,
        paperTradingSessionId: IsNull(),
        updatedAt: LessThan(cutoff)
      }
    });

    let marked = 0;
    for (const pipeline of orphans) {
      try {
        this.logger.warn(`Marking orphaned pipeline ${pipeline.id} as FAILED (PAPER_TRADE stage, no session created)`);

        const result = await this.pipelineRepository.update(
          { id: pipeline.id, status: PipelineStatus.RUNNING, currentStage: PipelineStage.PAPER_TRADE },
          {
            status: PipelineStatus.FAILED,
            failureReason: 'Orphaned: paper trading session never started',
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
        this.logger.error(`Failed to mark orphaned paper-trade pipeline ${pipeline.id} as FAILED: ${err.message}`);
      }
    }

    if (marked > 0) {
      this.logger.log(`Orphaned paper-trade pipeline watchdog marked ${marked} pipeline(s) as FAILED`);
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
