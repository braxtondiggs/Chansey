import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { In, Repository } from 'typeorm';

import { DEFAULT_CHECKPOINT_CONFIG } from './backtest-checkpoint.interface';
import { backtestConfig } from './backtest.config';
import { Backtest, BacktestStatus, BacktestType } from './backtest.entity';
import { BacktestJobData } from './backtest.job-data';

import { toErrorInfo } from '../../shared/error.util';

const BACKTEST_QUEUE_NAMES = backtestConfig();

/** Maximum number of automatic recovery attempts before permanently failing a backtest */
const MAX_AUTO_RESUME_COUNT = 3;

@Injectable()
export class BacktestRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BacktestRecoveryService.name);

  constructor(
    @InjectRepository(Backtest) private readonly backtestRepository: Repository<Backtest>,
    @InjectQueue(BACKTEST_QUEUE_NAMES.historicalQueue) private readonly historicalQueue: Queue,
    @InjectQueue(BACKTEST_QUEUE_NAMES.replayQueue) private readonly replayQueue: Queue
  ) {}

  onApplicationBootstrap(): void {
    this.recoverOrphanedBacktests().catch((error: unknown) => {
      const err = toErrorInfo(error);
      this.logger.error(`Background backtest recovery failed: ${err.message}`, err.stack);
    });
  }

  /**
   * Find orphaned RUNNING backtests after a restart and re-queue them as PENDING
   * so the existing checkpoint-resume logic can kick in.
   */
  private async recoverOrphanedBacktests(): Promise<void> {
    this.logger.log('Checking for orphaned backtests to recover...');

    try {
      const orphaned = await this.backtestRepository.find({
        where: {
          status: In([BacktestStatus.RUNNING, BacktestStatus.PAUSED, BacktestStatus.PENDING]),
          type: In([BacktestType.HISTORICAL, BacktestType.LIVE_REPLAY])
        },
        relations: ['user', 'algorithm', 'marketDataSet']
      });

      if (orphaned.length === 0) {
        this.logger.log('No orphaned backtests found');
        return;
      }

      this.logger.log(`Found ${orphaned.length} orphaned backtest(s) to recover`);

      await Promise.allSettled(
        orphaned.map(async (backtest) => {
          try {
            await this.recoverSingleBacktest(backtest);
          } catch (error: unknown) {
            const err = toErrorInfo(error);
            this.logger.error(`Failed to recover backtest ${backtest.id}: ${err.message}`, err.stack);
            // Mark as permanently failed if recovery itself errors
            try {
              await this.backtestRepository.update(backtest.id, {
                status: BacktestStatus.FAILED,
                errorMessage: `Recovery failed: ${err.message}`
              });
            } catch (markError: unknown) {
              const err = toErrorInfo(markError);
              this.logger.error(`Failed to mark backtest ${backtest.id} as failed: ${err.message}`);
            }
          }
        })
      );

      this.logger.log('Backtest recovery check complete');
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Backtest recovery check failed: ${err.message}`, err.stack);
    }
  }

  private async recoverSingleBacktest(backtest: Backtest): Promise<void> {
    // PENDING backtests may still have a valid job in the queue — skip if so.
    // However, an "active" job after a restart is stale (the old worker is dead),
    // so only skip for genuinely queued states (waiting/delayed).
    if (backtest.status === BacktestStatus.PENDING) {
      const queue = this.getQueueForType(backtest.type);
      const existingJob = await queue.getJob(backtest.id);
      if (existingJob) {
        const jobState = await existingJob.getState();
        if (jobState === 'waiting' || jobState === 'delayed') {
          this.logger.log(`Skipping PENDING backtest ${backtest.id} — valid job exists (state: ${jobState})`);
          return;
        }
      }
    }

    const rawResumeCount = backtest.configSnapshot?.autoResumeCount;
    const autoResumeCount = typeof rawResumeCount === 'number' ? rawResumeCount : 0;

    // Guard against infinite recovery loops
    if (autoResumeCount >= MAX_AUTO_RESUME_COUNT) {
      this.logger.warn(
        `Backtest ${backtest.id} has reached max auto-resume count (${autoResumeCount}/${MAX_AUTO_RESUME_COUNT}), marking FAILED`
      );
      await this.backtestRepository.update(backtest.id, {
        status: BacktestStatus.FAILED,
        errorMessage: `Exceeded maximum automatic recovery attempts (${MAX_AUTO_RESUME_COUNT})`
      });
      return;
    }

    // Check checkpoint age — clear stale checkpoints
    if (backtest.checkpointState && backtest.lastCheckpointAt) {
      const checkpointAge = Date.now() - new Date(backtest.lastCheckpointAt).getTime();
      if (checkpointAge > DEFAULT_CHECKPOINT_CONFIG.maxCheckpointAge) {
        this.logger.warn(
          `Clearing stale checkpoint for backtest ${backtest.id} (age: ${Math.round(checkpointAge / 1000 / 60 / 60)}h)`
        );
        backtest.checkpointState = null;
        backtest.lastCheckpointAt = null;
        backtest.processedTimestampCount = 0;
      }
    }

    // Increment autoResumeCount in configSnapshot
    const updatedConfigSnapshot = {
      ...(backtest.configSnapshot ?? {}),
      autoResumeCount: autoResumeCount + 1
    };

    // Validate required relations before updating status to avoid orphaned PENDING backtests
    const userId = backtest.user?.id;
    const datasetId = backtest.marketDataSet?.id ?? (backtest.configSnapshot?.dataset?.id as string);
    const algorithmId = backtest.algorithm?.id ?? (backtest.configSnapshot?.algorithm?.id as string);

    if (!backtest.marketDataSet?.id || !backtest.algorithm?.id) {
      this.logger.warn(`Backtest ${backtest.id} missing eager relations, falling back to configSnapshot`);
    }

    if (!userId || !datasetId || !algorithmId) {
      throw new Error(
        `Missing required relations for backtest ${backtest.id} recovery: ` +
          `userId=${userId ?? 'missing'}, datasetId=${datasetId ?? 'missing'}, algorithmId=${algorithmId ?? 'missing'}`
      );
    }

    const payload: BacktestJobData = {
      backtestId: backtest.id,
      userId,
      datasetId,
      algorithmId,
      deterministicSeed: backtest.deterministicSeed ?? backtest.id,
      mode: backtest.type
    };

    const queue = this.getQueueForType(backtest.type);

    // Remove any existing job with the same ID to prevent BullMQ jobId collision
    await this.forceRemoveJob(queue, backtest.id);

    // Update DB to PENDING BEFORE enqueuing the job.
    // BullMQ workers are already active (started in onModuleInit, before onApplicationBootstrap),
    // so if we enqueue first, the worker can pick up the job before the DB update executes,
    // see the old RUNNING status, skip the job, and leave the backtest stuck in PENDING.
    // If a crash occurs between the DB update and queue.add(), the PENDING backtest will have
    // no job — this is safe because the recovery service already detects orphaned PENDING
    // backtests with no valid queue job (lines 84-93) and re-queues them on the next restart.
    await this.backtestRepository.update(backtest.id, {
      status: BacktestStatus.PENDING,
      configSnapshot: updatedConfigSnapshot as Record<string, any>,
      checkpointState: backtest.checkpointState,
      lastCheckpointAt: backtest.lastCheckpointAt,
      processedTimestampCount: backtest.processedTimestampCount
    });

    await queue.add('execute-backtest', payload, {
      jobId: backtest.id,
      removeOnComplete: true,
      removeOnFail: 50
    });

    const hasCheckpoint = !!backtest.checkpointState;
    this.logger.log(
      `Re-queued backtest ${backtest.id} for recovery (attempt ${autoResumeCount + 1}/${MAX_AUTO_RESUME_COUNT}, checkpoint=${hasCheckpoint})`
    );
  }

  /**
   * Force-remove a job from the queue, clearing stale locks from dead workers if needed.
   * After a deployment, the old worker process is gone but its Redis lock on active jobs
   * persists until lockDuration expires. job.remove() fails on locked jobs, so we delete
   * the lock key directly and retry.
   */
  private async forceRemoveJob(queue: Queue, jobId: string): Promise<void> {
    const existingJob = await queue.getJob(jobId);
    if (!existingJob) return;

    try {
      await existingJob.remove();
      this.logger.log(`Removed existing job ${jobId} from queue before re-queuing`);
      return;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.log(`Initial remove for job ${jobId} failed (${err.message}), attempting force-remove`);
    }

    // Force-remove the stale lock via Redis and retry
    try {
      const client = await queue.client;
      const prefix = queue.opts?.prefix ?? 'bull';
      const lockKey = `${prefix}:${queue.name}:${jobId}:lock`;
      const deleted = await client.del(lockKey);
      this.logger.log(`Force-deleted stale lock for job ${jobId} (keys removed: ${deleted})`);

      await existingJob.remove();
      this.logger.log(`Removed previously-locked job ${jobId} after clearing stale lock`);
    } catch (forceError: unknown) {
      const err = toErrorInfo(forceError);
      this.logger.warn(`Could not force-remove job ${jobId}: ${err.message}`);
    }
  }

  private getQueueForType(type: BacktestType): Queue {
    switch (type) {
      case BacktestType.HISTORICAL:
        return this.historicalQueue;
      case BacktestType.LIVE_REPLAY:
        return this.replayQueue;
      default:
        throw new Error(`Unsupported backtest type for recovery: ${type}`);
    }
  }
}
