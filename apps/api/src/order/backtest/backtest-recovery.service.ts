import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { In, Repository } from 'typeorm';

import { DEFAULT_CHECKPOINT_CONFIG } from './backtest-checkpoint.interface';
import { backtestConfig } from './backtest.config';
import { Backtest, BacktestStatus, BacktestType } from './backtest.entity';
import { BacktestJobData } from './backtest.job-data';

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

  async onApplicationBootstrap(): Promise<void> {
    await this.recoverOrphanedBacktests();
  }

  /**
   * Find orphaned RUNNING backtests after a restart and re-queue them as PENDING
   * so the existing checkpoint-resume logic can kick in.
   */
  private async recoverOrphanedBacktests(): Promise<void> {
    this.logger.log('Checking for orphaned RUNNING/PAUSED backtests to recover...');

    try {
      const orphaned = await this.backtestRepository.find({
        where: {
          status: In([BacktestStatus.RUNNING, BacktestStatus.PAUSED]),
          type: In([BacktestType.HISTORICAL, BacktestType.LIVE_REPLAY])
        },
        relations: ['user', 'algorithm', 'marketDataSet']
      });

      if (orphaned.length === 0) {
        this.logger.log('No orphaned RUNNING/PAUSED backtests found');
        return;
      }

      this.logger.log(`Found ${orphaned.length} orphaned RUNNING/PAUSED backtest(s) to recover`);

      for (const backtest of orphaned) {
        try {
          await this.recoverSingleBacktest(backtest);
        } catch (error) {
          this.logger.error(`Failed to recover backtest ${backtest.id}: ${error.message}`, error.stack);
          // Mark as permanently failed if recovery itself errors
          try {
            await this.backtestRepository.update(backtest.id, {
              status: BacktestStatus.FAILED,
              errorMessage: `Recovery failed: ${error.message}`
            });
          } catch (markError) {
            this.logger.error(`Failed to mark backtest ${backtest.id} as failed: ${markError.message}`);
          }
        }
      }

      this.logger.log('Backtest recovery check complete');
    } catch (error) {
      this.logger.error(`Backtest recovery check failed: ${error.message}`, error.stack);
    }
  }

  private async recoverSingleBacktest(backtest: Backtest): Promise<void> {
    const autoResumeCount = (backtest.configSnapshot?.autoResumeCount as number) ?? 0;

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

    // Reset to PENDING so the processor picks it up
    await this.backtestRepository.update(backtest.id, {
      status: BacktestStatus.PENDING,
      configSnapshot: updatedConfigSnapshot as Record<string, any>,
      checkpointState: backtest.checkpointState,
      lastCheckpointAt: backtest.lastCheckpointAt,
      processedTimestampCount: backtest.processedTimestampCount
    });

    // Build job payload and re-queue
    const userId = backtest.user?.id;
    const datasetId = backtest.marketDataSet?.id ?? (backtest.configSnapshot?.dataset?.id as string);
    const algorithmId = backtest.algorithm?.id ?? (backtest.configSnapshot?.algorithm?.id as string);

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
    const existingJob = await queue.getJob(backtest.id);
    if (existingJob) {
      try {
        await existingJob.remove();
        this.logger.log(`Removed existing job ${backtest.id} from queue before re-queuing`);
      } catch (removeError) {
        this.logger.warn(`Could not remove existing job ${backtest.id}: ${removeError.message}`);
      }
    }

    await queue.add('execute-backtest', payload, {
      jobId: backtest.id,
      removeOnComplete: true,
      removeOnFail: false
    });

    const hasCheckpoint = !!backtest.checkpointState;
    this.logger.log(
      `Re-queued backtest ${backtest.id} for recovery (attempt ${autoResumeCount + 1}/${MAX_AUTO_RESUME_COUNT}, checkpoint=${hasCheckpoint})`
    );
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
