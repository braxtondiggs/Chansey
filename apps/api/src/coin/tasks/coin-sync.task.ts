import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { Job, Queue } from 'bullmq';

import { CoinDetailSyncService } from './coin-detail-sync.service';

import { ExchangeService } from '../../exchange/exchange.service';
import { FailSafeWorkerHost } from '../../failed-jobs/fail-safe-worker-host';
import { FailedJobService } from '../../failed-jobs/failed-job.service';
import { CircuitBreakerService } from '../../shared/circuit-breaker.service';
import { CoinGeckoClientService } from '../../shared/coingecko-client.service';
import { LOCK_DEFAULTS, LOCK_KEYS } from '../../shared/distributed-lock.constants';
import { DistributedLockService } from '../../shared/distributed-lock.service';
import { toErrorInfo } from '../../shared/error.util';
import { withRateLimitRetry } from '../../shared/retry.util';
import { withTimeout } from '../../shared/with-timeout.util';
import { CoinDailySnapshotService } from '../coin-daily-snapshot.service';
import { CoinListingEventService } from '../coin-listing-event.service';
import { CoinMarketDataService } from '../coin-market-data.service';
import { CoinService } from '../coin.service';

// BullMQ auto-renews its internal worker lock every `lockDuration / 2` ms, so
// a short value here gives fast stall detection without affecting long-running
// jobs. Concurrency/exclusivity of coin-detail vs coin-sync is enforced by the
// distributed lock (see DistributedLockService), not by this setting. Soft
// timeouts in process() bound runtime independently.
@Processor('coin-queue', { lockDuration: 60_000, stalledInterval: 30_000 })
@Injectable()
export class CoinSyncTask extends FailSafeWorkerHost implements OnModuleInit {
  private readonly logger = new Logger(CoinSyncTask.name);
  private jobScheduled = false;
  private readonly API_RATE_LIMIT_DELAY = 3000;
  private static readonly COINGECKO_CHART_CIRCUIT_KEY = 'coingecko-chart';
  private static readonly POST_DETAIL_COOLDOWN_MS = 30_000;

  constructor(
    @InjectQueue('coin-queue') private readonly coinQueue: Queue,
    private readonly coin: CoinService,
    private readonly exchangeService: ExchangeService,
    private readonly listingEventService: CoinListingEventService,
    private readonly coinDetailSync: CoinDetailSyncService,
    private readonly snapshotService: CoinDailySnapshotService,
    private readonly coinMarketData: CoinMarketDataService,
    private readonly gecko: CoinGeckoClientService,
    private readonly lockService: DistributedLockService,
    private readonly circuitBreaker: CircuitBreakerService,
    failedJobService: FailedJobService
  ) {
    super(failedJobService);
  }

  async onModuleInit() {
    if (process.env.NODE_ENV === 'development' || process.env.DISABLE_BACKGROUND_TASKS === 'true') {
      this.logger.log('Coin sync jobs disabled for local development');
      return;
    }

    if (!this.jobScheduled) {
      await this.scheduleRepeatableJob('coin-sync', CronExpression.EVERY_WEEK);
      await this.scheduleRepeatableJob('coin-detail', CronExpression.EVERY_DAY_AT_11PM);
      this.jobScheduled = true;
    }
  }

  private async scheduleRepeatableJob(name: string, pattern: string): Promise<void> {
    const repeatedJobs = await this.coinQueue.getRepeatableJobs();
    const existingJob = repeatedJobs.find((job) => job.name === name);

    if (existingJob) {
      this.logger.log(`${name} job already scheduled with pattern: ${existingJob.pattern}`);
      return;
    }

    await this.coinQueue.add(
      name,
      {
        timestamp: new Date().toISOString(),
        description: `Scheduled ${name} job`
      },
      {
        repeat: { pattern },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 100,
        removeOnFail: 50
      }
    );

    this.logger.log(`${name} job scheduled with pattern: ${pattern}`);
  }

  async process(job: Job) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);

    const lockKey = job.name === 'coin-detail' ? LOCK_KEYS.COIN_DETAIL : LOCK_KEYS.COIN_SYNC;
    const lockTtl = job.name === 'coin-detail' ? LOCK_DEFAULTS.COIN_DETAIL_TTL_MS : LOCK_DEFAULTS.COIN_SYNC_TTL_MS;

    const lock = await this.lockService.acquire({ key: lockKey, ttlMs: lockTtl });
    if (!lock.acquired) {
      this.logger.warn(`Could not acquire lock for ${job.name}, skipping`);
      return { skipped: true, reason: 'lock_not_acquired' };
    }

    try {
      let result: Record<string, unknown>;

      // Timeouts must fire before the distributed-lock TTL expires so the
      // finally block can release the lock before another run claims it.
      // coin-sync TTL 45m → 40m timeout; coin-detail TTL 5h → 4h timeout.
      if (job.name === 'coin-sync') {
        result = await withTimeout(this.handleSyncCoins(job), 40 * 60 * 1000, 'coin-sync');
      } else if (job.name === 'coin-detail') {
        result = await withTimeout(this.handleCoinDetail(job), 4 * 60 * 60 * 1000, 'coin-detail');
      } else {
        throw new Error(`Unknown job name: ${job.name}`);
      }

      this.logger.log(`Job ${job.id} completed successfully`);
      return result;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to process job ${job.id}: ${err.message}`, err.stack);
      throw error;
    } finally {
      await this.lockService.release(lockKey, lock.token);
    }
  }

  /**
   * Helper method to get all coin slugs that are used in ticker pairs on supported exchanges
   */
  private async getUsedCoinSlugs(supportedExchanges: { slug: string; name: string }[]): Promise<Set<string>> {
    this.logger.log('Checking CoinGecko for coins used in ticker pairs');
    const usedCoinSlugs = new Set<string>();

    for (const exchange of supportedExchanges) {
      try {
        this.logger.log(`Checking exchange: ${exchange.name} (${exchange.slug}) for ticker pairs`);

        let page = 1;
        let totalProcessedTickers = 0;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const id = exchange.slug === 'coinbase' ? 'gdax' : exchange.slug.toLowerCase();
          const retryResult = await withRateLimitRetry(() => this.gecko.client.exchanges.tickers.get(id, { page }), {
            maxRetries: 2,
            logger: this.logger,
            operationName: `tickers(${id}, page=${page})`
          });

          if (!retryResult.success) {
            const err = toErrorInfo(retryResult.error);
            this.logger.error(`Failed to fetch page ${page} tickers for ${exchange.name}: ${err.message}`);
            if (page === 1) break;
            await new Promise((r) => setTimeout(r, this.API_RATE_LIMIT_DELAY));
            page++;
            continue;
          }

          const tickers = retryResult.result?.tickers || [];

          if (tickers.length === 0) {
            this.logger.log(
              `Completed loading ticker data for ${exchange.name}, total processed: ${totalProcessedTickers}`
            );
            break;
          }

          totalProcessedTickers += tickers.length;

          for (const ticker of tickers) {
            const baseId = ticker.coin_id?.toLowerCase();
            const quoteId = ticker.target_coin_id?.toLowerCase();

            if (baseId) usedCoinSlugs.add(baseId);
            if (quoteId) usedCoinSlugs.add(quoteId);
          }

          await new Promise((r) => setTimeout(r, this.API_RATE_LIMIT_DELAY));
          page++;
        }
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Error getting tickers for exchange ${exchange.name}: ${err.message}`);
        continue;
      }
    }

    return usedCoinSlugs;
  }

  /**
   * Handler for coin synchronization job.
   * Gets coins from CoinGecko and syncs them to DB.
   * Only coins that are used in ticker pairs (supported on exchanges) are added.
   * Removes coins that are either no longer in CoinGecko or not used in any ticker pairs.
   */
  async handleSyncCoins(job: Job) {
    try {
      this.logger.log('Starting Coin Sync');
      await job.updateProgress(5);

      this.logger.log('Fetching data from CoinGecko and database...');
      const [geckoCoins, existingCoins, supportedExchanges] = await Promise.all([
        this.gecko.client.coins.list.get({ include_platform: false }),
        this.coin.getCoins({ includeDelisted: true }),
        this.exchangeService.getExchanges({ supported: true })
      ]);
      await job.updateProgress(15);

      const existingCoinsMap = new Map(existingCoins.map((coin) => [coin.slug, coin]));
      await job.updateProgress(20);

      const usedCoinSlugs = await this.getUsedCoinSlugs(supportedExchanges);
      this.logger.log(`Found ${usedCoinSlugs.size} coins used in any ticker pairs`);

      const newCoins = geckoCoins
        .filter(
          (coin): coin is typeof coin & { id: string; symbol: string; name: string } =>
            !!coin.id && !!coin.symbol && !!coin.name && !existingCoinsMap.has(coin.id) && usedCoinSlugs.has(coin.id)
        )
        .map(({ id: slug, symbol, name }) => ({
          slug,
          symbol: symbol.toLowerCase(),
          name
        }));

      const coinsToUpdate = [];
      for (const geckoCoin of geckoCoins) {
        if (!geckoCoin.id) continue;
        const existingCoin = existingCoinsMap.get(geckoCoin.id);
        if (existingCoin) {
          const geckoSymbol = geckoCoin.symbol?.toLowerCase() ?? '';
          const geckoName = geckoCoin.name ?? '';
          if (existingCoin.symbol !== geckoSymbol || existingCoin.name !== geckoName) {
            coinsToUpdate.push({
              id: existingCoin.id,
              name: geckoName,
              symbol: geckoSymbol
            });
          }
        }
      }

      this.logger.log('Identifying coins for removal...');
      const geckoCoinsSet = new Set(geckoCoins.map((coin) => coin.id).filter((id): id is string => !!id));
      const missingFromGeckoCoins = existingCoins.filter((coin) => !geckoCoinsSet.has(coin.slug));
      const missingFromGeckoIds = missingFromGeckoCoins.map((coin) => coin.id);

      await job.updateProgress(30);

      const existingCoinsInGecko = existingCoins.filter((coin) => geckoCoinsSet.has(coin.slug));
      const unsupportedCoins = existingCoinsInGecko.filter((coin) => !usedCoinSlugs.has(coin.slug));
      const unsupportedCoinIds = unsupportedCoins.map((coin) => coin.id);

      this.logger.log(`Found ${unsupportedCoinIds.length} coins that are not used in any ticker pairs`);

      const coinsToRemove = [...missingFromGeckoIds, ...unsupportedCoinIds];
      const uniqueCoinsToRemove = Array.from(new Set(coinsToRemove));

      await job.updateProgress(45);

      if (newCoins.length > 0) {
        await this.coin.createMany(newCoins);
        this.logger.log(`Added ${newCoins.length} new coins from CoinGecko`);
      }

      if (coinsToUpdate.length > 0) {
        const updatedCount = await Promise.all(
          coinsToUpdate.map(async ({ id, ...updates }) => {
            try {
              await this.coin.update(id, updates);
              return { success: true };
            } catch (error: unknown) {
              const err = toErrorInfo(error);
              this.logger.error(`Failed to update coin ${id}: ${err.message}`);
              return { success: false };
            }
          })
        );

        const successCount = updatedCount.filter((result) => result.success).length;
        this.logger.log(`Updated ${successCount} of ${coinsToUpdate.length} coins`);
      }

      if (uniqueCoinsToRemove.length > 0) {
        if (missingFromGeckoIds.length > 0) {
          this.logger.log(`Soft-delisting ${missingFromGeckoIds.length} coins no longer found in CoinGecko`);
        }

        if (unsupportedCoinIds.length > 0) {
          this.logger.log(`Soft-delisting ${unsupportedCoinIds.length} coins not used in any ticker pairs`);
        }

        await this.coin.removeMany(uniqueCoinsToRemove);
        await this.listingEventService.recordBulkDelistings(uniqueCoinsToRemove, 'coin_sync');
        this.logger.log(`Soft-delisted ${uniqueCoinsToRemove.length} coins in total`);
      }

      // Check for previously delisted coins that should be re-listed
      const justDelistedSet = new Set(uniqueCoinsToRemove);
      const coinsToRelist = existingCoins
        .filter(
          (c) =>
            c.delistedAt != null && geckoCoinsSet.has(c.slug) && usedCoinSlugs.has(c.slug) && !justDelistedSet.has(c.id)
        )
        .map((c) => c.id);

      if (coinsToRelist.length > 0) {
        await this.coin.relistMany(coinsToRelist);
        await this.listingEventService.recordBulkRelistings(coinsToRelist, 'coin_sync');
        this.logger.log(`Re-listed ${coinsToRelist.length} previously delisted coins`);
      }

      // Return summary for job completion callback
      const activeCoins = existingCoins.filter((c) => c.delistedAt == null);
      return {
        added: newCoins.length,
        updated: coinsToUpdate.length,
        delisted: uniqueCoinsToRemove.length,
        relisted: coinsToRelist.length,
        total: activeCoins.length + newCoins.length - uniqueCoinsToRemove.length + coinsToRelist.length
      };
    } catch (e: unknown) {
      const errInfo = toErrorInfo(e);
      this.logger.error(`Coin sync failed: ${errInfo.message}`, errInfo.stack);
      throw e;
    } finally {
      await job.updateProgress(100);
      this.logger.log('Coin Sync Complete');
    }
  }

  /**
   * Handler for detailed coin information update job.
   * Delegates to CoinDetailSyncService.
   */
  async handleCoinDetail(job: Job) {
    try {
      const detailResult = await this.coinDetailSync.syncCoinDetails((percent) => job.updateProgress(percent));

      // Cooldown after detail sync to let CoinGecko rate limits recover before snapshot/backfill
      this.logger.log(`Cooling down ${CoinSyncTask.POST_DETAIL_COOLDOWN_MS / 1000}s before snapshot/backfill`);
      await new Promise((resolve) => setTimeout(resolve, CoinSyncTask.POST_DETAIL_COOLDOWN_MS));

      const freshCoins = await this.coin.getCoins();

      // Capture daily market data snapshots for all active coins
      let snapshotsCaptured = 0;
      try {
        snapshotsCaptured = await this.snapshotService.captureSnapshots(freshCoins);
        this.logger.log(`Captured ${snapshotsCaptured} daily market data snapshots`);
      } catch (snapshotError: unknown) {
        const { message } = toErrorInfo(snapshotError);
        this.logger.error(`Failed to capture daily snapshots (non-fatal): ${message}`);
      }

      // Backfill historical snapshots for coins with insufficient data
      try {
        if (this.circuitBreaker.isOpen(CoinSyncTask.COINGECKO_CHART_CIRCUIT_KEY)) {
          this.logger.warn('Circuit breaker OPEN for coingecko-chart, skipping backfill entirely');
        } else {
          const allCoinIds = freshCoins.map((c) => c.id);
          const coinsNeedingBackfill = await this.snapshotService.getCoinsNeedingBackfill(allCoinIds, 30);

          if (coinsNeedingBackfill.length > 0) {
            this.logger.log(`Backfilling historical snapshots for ${coinsNeedingBackfill.length} coins`);
            const batchSize = 1;

            for (let i = 0; i < coinsNeedingBackfill.length; i += batchSize) {
              if (this.circuitBreaker.isOpen(CoinSyncTask.COINGECKO_CHART_CIRCUIT_KEY)) {
                this.logger.warn('Circuit breaker opened mid-backfill, stopping');
                break;
              }

              const batch = coinsNeedingBackfill.slice(i, i + batchSize);

              await Promise.allSettled(
                batch.map(async (coinId) => {
                  try {
                    const historicalData = await this.coinMarketData.getCoinHistoricalData(coinId);
                    const inserted = await this.snapshotService.backfillFromHistoricalData(coinId, historicalData);
                    this.logger.debug(`Backfilled ${inserted} snapshots for coin ${coinId}`);
                  } catch (err: unknown) {
                    const { message } = toErrorInfo(err);
                    this.logger.warn(`Failed to backfill snapshots for coin ${coinId}: ${message}`);
                  }
                })
              );

              if (i + batchSize < coinsNeedingBackfill.length) {
                await new Promise((resolve) => setTimeout(resolve, this.API_RATE_LIMIT_DELAY));
              }
            }
          }
        }
      } catch (backfillError: unknown) {
        const { message } = toErrorInfo(backfillError);
        this.logger.error(`Failed to backfill historical snapshots (non-fatal): ${message}`);
      }

      return { ...detailResult, snapshotsCaptured };
    } catch (e: unknown) {
      const errInfo = toErrorInfo(e);
      this.logger.error(`Failed to process coin details: ${errInfo.message}`, errInfo.stack);
      throw e;
    }
  }
}
