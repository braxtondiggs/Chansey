import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Job, Queue } from 'bullmq';

import { toErrorInfo } from '../../shared/error.util';
import { CoinDailySnapshotService } from '../coin-daily-snapshot.service';

@Processor('coin-snapshot-prune-queue')
@Injectable()
export class CoinSnapshotPruneTask extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(CoinSnapshotPruneTask.name);
  private jobScheduled = false;
  private readonly DEFAULT_RETENTION_DAYS = 730; // 2 years

  constructor(
    @InjectQueue('coin-snapshot-prune-queue') private readonly pruneQueue: Queue,
    private readonly snapshotService: CoinDailySnapshotService,
    private readonly configService: ConfigService
  ) {
    super();
  }

  async onModuleInit() {
    if (process.env.NODE_ENV === 'development' || process.env.DISABLE_BACKGROUND_TASKS === 'true') {
      this.logger.log('Coin snapshot prune jobs disabled');
      return;
    }

    if (!this.jobScheduled) {
      await this.schedulePruneJob();
      this.jobScheduled = true;
    }
  }

  private async schedulePruneJob() {
    const repeatedJobs = await this.pruneQueue.getRepeatableJobs();
    const existingJob = repeatedJobs.find((job) => job.name === 'coin-snapshot-prune');

    if (existingJob) {
      this.logger.log(`Coin snapshot prune job already scheduled with pattern: ${existingJob.pattern}`);
      return;
    }

    // Run at 3:30 AM every day (30 min after OHLC prune)
    const cronPattern = '30 3 * * *';

    await this.pruneQueue.add(
      'coin-snapshot-prune',
      {
        timestamp: new Date().toISOString(),
        description: 'Scheduled coin snapshot pruning job'
      },
      {
        repeat: { pattern: cronPattern },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 30,
        removeOnFail: 20
      }
    );

    this.logger.log('Coin snapshot prune job scheduled to run daily at 3:30 AM');
  }

  async process(job: Job) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);
    try {
      return await this.handlePrune(job);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to process job ${job.id}: ${err.message}`, err.stack);
      throw error;
    }
  }

  async handlePrune(job: Job) {
    try {
      this.logger.log('Starting coin snapshot pruning');
      await job.updateProgress(10);

      const retentionDays = parseInt(
        this.configService.get('COIN_SNAPSHOT_RETENTION_DAYS') || String(this.DEFAULT_RETENTION_DAYS),
        10
      );

      this.logger.log(`Pruning snapshots older than ${retentionDays} days`);
      await job.updateProgress(30);

      const countBefore = await this.snapshotService.getSnapshotCount();
      await job.updateProgress(50);

      const deletedCount = await this.snapshotService.pruneOldSnapshots(retentionDays);
      await job.updateProgress(90);

      const countAfter = await this.snapshotService.getSnapshotCount();
      await job.updateProgress(100);

      const summary = {
        retentionDays,
        snapshotsBefore: countBefore,
        snapshotsAfter: countAfter,
        snapshotsDeleted: deletedCount,
        prunedAt: new Date().toISOString()
      };

      this.logger.log(
        `Coin snapshot prune complete: Deleted ${deletedCount} snapshots. Before: ${countBefore}, After: ${countAfter}`
      );

      return summary;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Coin snapshot prune failed: ${err.message}`, err.stack);
      throw error;
    }
  }
}
