import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { Job, Queue } from 'bullmq';
import { CoinGeckoClient } from 'coingecko-api-v3';

import { CoinDetailSyncService } from './coin-detail-sync.service';

import { ExchangeService } from '../../exchange/exchange.service';
import { toErrorInfo } from '../../shared/error.util';
import { CoinListingEventService } from '../coin-listing-event.service';
import { CoinService } from '../coin.service';

@Processor('coin-queue')
@Injectable()
export class CoinSyncTask extends WorkerHost implements OnModuleInit {
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });
  private readonly logger = new Logger(CoinSyncTask.name);
  private jobScheduled = false;
  private readonly API_RATE_LIMIT_DELAY = 2500;

  constructor(
    @InjectQueue('coin-queue') private readonly coinQueue: Queue,
    private readonly coin: CoinService,
    private readonly exchangeService: ExchangeService,
    private readonly listingEventService: CoinListingEventService,
    private readonly coinDetailSync: CoinDetailSyncService
  ) {
    super();
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
    try {
      let result: Record<string, unknown>;

      if (job.name === 'coin-sync') {
        result = await this.handleSyncCoins(job);
      } else if (job.name === 'coin-detail') {
        result = await this.handleCoinDetail(job);
      } else {
        throw new Error(`Unknown job name: ${job.name}`);
      }

      this.logger.log(`Job ${job.id} completed successfully`);
      return result;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to process job ${job.id}: ${err.message}`, err.stack);
      throw error;
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
          let tickers = [];

          try {
            const id = exchange.slug === 'coinbase' ? 'gdax' : exchange.slug.toLowerCase();
            const response = await this.gecko.exchangeIdTickers({ id, page });

            tickers = response.tickers || [];

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
          } catch (tickerError: unknown) {
            const err = toErrorInfo(tickerError);
            this.logger.error(`Failed to fetch page ${page} tickers for ${exchange.name}: ${err.message}`);
            if (page === 1) break;
            page++;
            continue;
          }
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
        this.gecko.coinList({ include_platform: false }),
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
      return await this.coinDetailSync.syncCoinDetails((percent) => job.updateProgress(percent));
    } catch (e: unknown) {
      const errInfo = toErrorInfo(e);
      this.logger.error(`Failed to process coin details: ${errInfo.message}`, errInfo.stack);
      throw e;
    }
  }
}
