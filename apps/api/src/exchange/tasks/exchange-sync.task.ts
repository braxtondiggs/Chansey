import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { Job, Queue } from 'bullmq';

import { FailSafeWorkerHost } from '../../failed-jobs/fail-safe-worker-host';
import { FailedJobService } from '../../failed-jobs/failed-job.service';
import { CoinGeckoClientService } from '../../shared/coingecko-client.service';
import { LOCK_DEFAULTS, LOCK_KEYS } from '../../shared/distributed-lock.constants';
import { DistributedLockService } from '../../shared/distributed-lock.service';
import { toErrorInfo } from '../../shared/error.util';
import { withRateLimitRetryThrow } from '../../shared/retry.util';
import { withTimeout } from '../../shared/with-timeout.util';
import { Exchange } from '../exchange.entity';
import { ExchangeService } from '../exchange.service';

/**
 * Local interface for the paginated exchange list response.
 * The SDK's `ExchangeGetResponse` models a single object, but `exchanges.get()`
 * actually returns an array at runtime. The SDK lacks a dedicated list-item type,
 * so we keep this interface until upstream adds one.
 */
interface CoinGeckoExchangeItem {
  id: string;
  name: string;
  url: string;
  image: string;
  country: string | null;
  year_established: number | null;
  trust_score: number | null;
  trust_score_rank: number | null;
  trade_volume_24h_btc: number;
  trade_volume_24h_btc_normalized: number;
  facebook_url: string | null;
  reddit_url: string | null;
  telegram_url: string | null;
  twitter_handle: string | null;
  other_url_1: string | null;
  other_url_2: string | null;
  centralized: boolean;
}

// BullMQ auto-renews its internal worker lock every `lockDuration / 2` ms, so
// a short value here gives fast stall detection. Exclusivity is enforced by
// the distributed lock, not by this setting.
@Processor('exchange-queue', { lockDuration: 60_000, stalledInterval: 30_000 })
@Injectable()
export class ExchangeSyncTask extends FailSafeWorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ExchangeSyncTask.name);
  private readonly API_RATE_LIMIT_DELAY = 2500;
  private jobScheduled = false;

  constructor(
    @InjectQueue('exchange-queue') private readonly exchangeQueue: Queue,
    private readonly exchange: ExchangeService,
    private readonly gecko: CoinGeckoClientService,
    private readonly lockService: DistributedLockService,
    failedJobService: FailedJobService
  ) {
    super(failedJobService);
  }

  async onModuleInit() {
    if (process.env.NODE_ENV === 'development' || process.env.DISABLE_BACKGROUND_TASKS === 'true') {
      this.logger.log('Exchange sync jobs disabled for local development');
      return;
    }

    if (!this.jobScheduled) {
      await this.scheduleCronJob();
      this.jobScheduled = true;
    }
  }

  private async scheduleCronJob() {
    const repeatedJobs = await this.exchangeQueue.getRepeatableJobs();
    const existingJob = repeatedJobs.find((job) => job.name === 'exchange-sync');
    if (existingJob) {
      this.logger.log(`Exchange sync job already scheduled with pattern: ${existingJob.pattern}`);
      return;
    }
    await this.exchangeQueue.add(
      'exchange-sync',
      {
        timestamp: new Date().toISOString(),
        description: 'Scheduled exchange sync job'
      },
      {
        repeat: { pattern: CronExpression.EVERY_WEEK },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 100,
        removeOnFail: 50
      }
    );
    this.logger.log('Exchange sync job scheduled with weekly cron pattern');
  }

  async process(job: Job) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);

    const lock = await this.lockService.acquire({
      key: LOCK_KEYS.EXCHANGE_SYNC,
      ttlMs: LOCK_DEFAULTS.EXCHANGE_SYNC_TTL_MS
    });
    if (!lock.acquired) {
      this.logger.warn(`Could not acquire lock for ${job.name}, skipping`);
      return { skipped: true, reason: 'lock_not_acquired' };
    }

    try {
      if (job.name === 'exchange-sync') {
        // Timeout must fire before EXCHANGE_SYNC_TTL_MS (10m) expires so the
        // lock is released by the finally block before another run can claim it.
        const result = await withTimeout(this.handleSyncExchanges(job), 8 * 60 * 1000, 'exchange-sync');
        this.logger.log(`Job ${job.id} completed with result: ${JSON.stringify(result)}`);
        return result;
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to process job ${job.id}: ${err.message}`, err.stack);
      throw error;
    } finally {
      await this.lockService.release(LOCK_KEYS.EXCHANGE_SYNC, lock.token);
    }
  }

  private async fetchAllExchanges(): Promise<CoinGeckoExchangeItem[]> {
    const allExchanges: CoinGeckoExchangeItem[] = [];
    const PER_PAGE = 250;
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const apiExchanges = await withRateLimitRetryThrow(
        async () => {
          const response = await this.gecko.client.exchanges.get({
            per_page: PER_PAGE,
            page
          });
          // SDK types exchanges.get() as a single ExchangeGetResponse, but the
          // paginated list endpoint returns an array — cast required until SDK fix
          return response as unknown as CoinGeckoExchangeItem[];
        },
        { operationName: 'fetchExchanges' }
      );

      if (apiExchanges.length === 0) {
        hasMore = false;
        break;
      }
      allExchanges.push(...apiExchanges);

      if (apiExchanges.length < PER_PAGE) {
        hasMore = false;
        break;
      }

      await new Promise((r) => setTimeout(r, this.API_RATE_LIMIT_DELAY));
      page++;
    }

    return allExchanges;
  }

  private deduplicateExchanges(exchanges: CoinGeckoExchangeItem[]): CoinGeckoExchangeItem[] {
    const seenSlugs = new Set<string>();
    const seenNames = new Set<string>();

    return exchanges
      .filter((ex) => {
        if (!ex.id) {
          this.logger.warn(`Skipping exchange with missing ID: ${ex.name || 'Unknown'}`);
          return false;
        }
        if (seenSlugs.has(ex.id)) {
          this.logger.warn(`Skipping duplicate exchange with ID: ${ex.id}`);
          return false;
        }
        seenSlugs.add(ex.id);
        return true;
      })
      .map((ex) => {
        const normalizedName = ex.name?.trim() || '';

        if (!normalizedName) {
          this.logger.warn(`Exchange with ID ${ex.id} has no name, using ID as name`);
          return { ...ex, name: ex.id };
        }

        if (seenNames.has(normalizedName)) {
          const uniqueName = `${normalizedName} (${ex.id})`;
          this.logger.log(`Handling duplicate exchange name: "${normalizedName}" -> "${uniqueName}"`);
          seenNames.add(uniqueName);
          return { ...ex, name: uniqueName };
        }

        seenNames.add(normalizedName);
        return ex;
      });
  }

  private mapToExchange(apiExchange: CoinGeckoExchangeItem, existing?: Exchange): Exchange {
    return new Exchange({
      ...existing,
      name: apiExchange.name,
      slug: apiExchange.id,
      url: apiExchange.url,
      image: apiExchange.image,
      country: apiExchange.country ?? undefined,
      yearEstablished: apiExchange.year_established ?? undefined,
      trustScore: apiExchange.trust_score ?? undefined,
      trustScoreRank: apiExchange.trust_score_rank ?? undefined,
      tradeVolume24HBtc: apiExchange.trade_volume_24h_btc,
      tradeVolume24HNormalized: apiExchange.trade_volume_24h_btc_normalized,
      facebook: apiExchange.facebook_url ?? undefined,
      reddit: apiExchange.reddit_url ?? undefined,
      telegram: apiExchange.telegram_url ?? undefined,
      twitter: apiExchange.twitter_handle ?? undefined,
      otherUrl1: apiExchange.other_url_1 ?? undefined,
      otherUrl2: apiExchange.other_url_2 ?? undefined,
      centralized: apiExchange.centralized,
      isScraped: true
    });
  }

  async handleSyncExchanges(job: Job) {
    try {
      this.logger.log('Starting Exchange Sync');
      await job.updateProgress(10);

      const [allApiExchanges, existingExchanges] = await Promise.all([
        this.fetchAllExchanges(),
        this.exchange.getExchanges()
      ]);
      await job.updateProgress(30);

      const dedupedExchanges = this.deduplicateExchanges(allApiExchanges);
      this.logger.log(`Processing ${dedupedExchanges.length} exchanges after deduplication`);
      await job.updateProgress(50);

      const existingBySlug = new Map(existingExchanges.map((e) => [e.slug, e]));
      const apiSlugSet = new Set(dedupedExchanges.map((e) => e.id));

      const newExchanges: Exchange[] = [];
      const updatedExchanges: Exchange[] = [];
      const seenNewNames = new Set<string>();

      for (const apiEx of dedupedExchanges) {
        const existing = existingBySlug.get(apiEx.id);
        const mapped = this.mapToExchange(apiEx, existing);

        if (existing) {
          updatedExchanges.push(mapped);
        } else if (!seenNewNames.has(mapped.name)) {
          seenNewNames.add(mapped.name);
          newExchanges.push(mapped);
        }
      }

      const missingExchangeIds = existingExchanges.filter((e) => !apiSlugSet.has(e.slug)).map((e) => e.id);
      await job.updateProgress(70);

      if (newExchanges.length > 0) {
        try {
          const insertedExchanges = await this.exchange.createMany(newExchanges);
          this.logger.log(
            `Added ${insertedExchanges.length} exchanges: ${insertedExchanges.map(({ name }) => name).join(', ')}`
          );
        } catch (insertError: unknown) {
          const err = toErrorInfo(insertError);
          this.logger.error(`Error inserting new exchanges: ${err.message}`);
        }
      }
      if (updatedExchanges.length > 0) {
        try {
          await this.exchange.updateMany(updatedExchanges);
          this.logger.log(`Updated ${updatedExchanges.length} exchanges`);
        } catch (updateError: unknown) {
          const err = toErrorInfo(updateError);
          this.logger.error(`Error updating exchanges: ${err.message}`);
        }
      }
      if (missingExchangeIds.length > 0) {
        try {
          await this.exchange.removeMany(missingExchangeIds);
          this.logger.log(`Removed ${missingExchangeIds.length} obsolete exchanges`);
        } catch (removeError: unknown) {
          const err = toErrorInfo(removeError);
          this.logger.error(`Error removing exchanges: ${err.message}`);
        }
      }
      await job.updateProgress(100);
      return {
        added: newExchanges.length,
        updated: updatedExchanges.length,
        removed: missingExchangeIds.length,
        total: dedupedExchanges.length
      };
    } catch (e: unknown) {
      const errInfo = toErrorInfo(e);
      this.logger.error(`Exchange sync failed: ${errInfo.message}`, errInfo.stack);
      throw e;
    } finally {
      this.logger.log('Exchange Sync Complete');
    }
  }
}
