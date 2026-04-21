import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Job, Queue } from 'bullmq';

import { FailSafeWorkerHost } from '../../failed-jobs/fail-safe-worker-host';
import { FailedJobService } from '../../failed-jobs/failed-job.service';
import { LOCK_DEFAULTS, LOCK_KEYS } from '../../shared/distributed-lock.constants';
import { DistributedLockService } from '../../shared/distributed-lock.service';
import { toErrorInfo } from '../../shared/error.util';
import { CrossListingTickerSeedService } from '../services/cross-listing-ticker-seed.service';

export const LISTING_CROSS_LISTING_SEED_QUEUE = 'listing-cross-listing-seed';
const SEED_JOB_NAME = 'listing-cross-listing-seed-run';
const SEED_CRON = '0 3 * * 0';

/**
 * Schedules the weekly cross-listing ticker seed so scorer has up-to-date
 * `ticker_pairs` rows for kucoin/gate/okx. Runs Sunday 03:00 UTC — 1h after
 * `TickerPairSyncTask` (Sunday 02:00) so the primary sync completes first.
 */
@Processor(LISTING_CROSS_LISTING_SEED_QUEUE)
@Injectable()
export class CrossListingTickerSeedTask extends FailSafeWorkerHost implements OnModuleInit {
  private readonly logger = new Logger(CrossListingTickerSeedTask.name);
  private jobScheduled = false;

  constructor(
    @InjectQueue(LISTING_CROSS_LISTING_SEED_QUEUE) private readonly queue: Queue,
    private readonly seedService: CrossListingTickerSeedService,
    private readonly lockService: DistributedLockService,
    private readonly config: ConfigService,
    failedJobService: FailedJobService
  ) {
    super(failedJobService);
  }

  async onModuleInit() {
    if (this.isDisabled()) {
      this.logger.log('Cross-listing ticker seed task disabled');
      return;
    }
    if (!this.jobScheduled) {
      await this.schedule();
      this.jobScheduled = true;
    }
  }

  private isDisabled(): boolean {
    if (process.env.DISABLE_BACKGROUND_TASKS === 'true') return true;
    if (process.env.NODE_ENV === 'development') return true;
    return this.config.get<string>('LISTING_TRACKER_ENABLED') !== 'true';
  }

  private async schedule(): Promise<void> {
    const existing = await this.queue.getRepeatableJobs();
    const already = existing.find((job) => job.name === SEED_JOB_NAME);
    if (already) {
      this.logger.log(`Cross-listing seed job already scheduled (${already.pattern})`);
      return;
    }

    await this.queue.add(
      SEED_JOB_NAME,
      { scheduledAt: new Date().toISOString() },
      {
        repeat: { pattern: SEED_CRON },
        attempts: 2,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 10,
        removeOnFail: 20
      }
    );
    this.logger.log(`Cross-listing seed scheduled with cron '${SEED_CRON}'`);
  }

  async process(job: Job) {
    if (job.name !== SEED_JOB_NAME && job.name !== 'run-once') return;

    const lock = await this.lockService.acquire({
      key: LOCK_KEYS.LISTING_CROSS_LISTING_SEED,
      ttlMs: LOCK_DEFAULTS.LISTING_CROSS_LISTING_SEED_TTL_MS
    });
    if (!lock.acquired) {
      this.logger.warn('Could not acquire cross-listing seed lock, skipping');
      return { skipped: true, reason: 'lock_not_acquired' };
    }

    try {
      const result = await this.seedService.seedFromCachedExchangeTickers();
      return result;
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.error(`Cross-listing seed failed: ${err.message}`, err.stack);
      throw error;
    } finally {
      await this.lockService.release(LOCK_KEYS.LISTING_CROSS_LISTING_SEED, lock.token);
    }
  }

  /** Admin hook to force an immediate seed run. */
  async runNow(): Promise<void> {
    await this.queue.add('run-once', { scheduledAt: new Date().toISOString() });
  }
}
