import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { Job, Queue } from 'bullmq';
import { CoinGeckoClient } from 'coingecko-api-v3';

import { ExchangeService } from '../../exchange/exchange.service';
import { sanitizeNumericValue } from '../../utils/validators/numeric-sanitizer';
import { CoinService } from '../coin.service';

@Processor('coin-queue')
@Injectable()
export class CoinSyncTask extends WorkerHost implements OnModuleInit {
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });
  private readonly logger = new Logger(CoinSyncTask.name);
  private jobScheduled = false;
  private readonly API_RATE_LIMIT_DELAY = 1000; // 1 second delay between API calls

  constructor(
    @InjectQueue('coin-queue') private readonly coinQueue: Queue,
    private readonly coin: CoinService,
    private readonly exchangeService: ExchangeService
  ) {
    super();
  }

  /**
   * Lifecycle hook that runs once when the module is initialized
   * This ensures the cron jobs are only scheduled once when the application starts
   */
  async onModuleInit() {
    // Skip scheduling jobs in local development
    if (process.env.NODE_ENV === 'development' || process.env.DISABLE_BACKGROUND_TASKS === 'true') {
      this.logger.log('Coin sync jobs disabled for local development');
      return;
    }

    if (!this.jobScheduled) {
      await this.scheduleSyncJob();
      await this.scheduleDetailJob();
      this.jobScheduled = true;
    }
  }

  /**
   * Schedule the recurring job for coin list synchronization
   */
  private async scheduleSyncJob() {
    // Check if there's already a scheduled job with the same name
    const repeatedJobs = await this.coinQueue.getRepeatableJobs();
    const existingJob = repeatedJobs.find((job) => job.name === 'coin-sync');

    if (existingJob) {
      this.logger.log(`Coin sync job already scheduled with pattern: ${existingJob.pattern}`);
      return;
    }

    await this.coinQueue.add(
      'coin-sync',
      {
        timestamp: new Date().toISOString(),
        description: 'Scheduled coin sync job'
      },
      {
        repeat: { pattern: CronExpression.EVERY_WEEK },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 100, // keep the last 100 completed jobs
        removeOnFail: 50 // keep the last 50 failed jobs
      }
    );

    this.logger.log('Coin sync job scheduled with weekly cron pattern');
  }

  /**
   * Schedule the recurring job for detailed coin information updates
   */
  private async scheduleDetailJob() {
    // Check if there's already a scheduled job with the same name
    const repeatedJobs = await this.coinQueue.getRepeatableJobs();
    const existingJob = repeatedJobs.find((job) => job.name === 'coin-detail');

    if (existingJob) {
      this.logger.log(`Coin detail job already scheduled with pattern: ${existingJob.pattern}`);
      return;
    }

    await this.coinQueue.add(
      'coin-detail',
      {
        timestamp: new Date().toISOString(),
        description: 'Scheduled coin detail job'
      },
      {
        repeat: { pattern: CronExpression.EVERY_DAY_AT_11PM },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 100,
        removeOnFail: 50
      }
    );

    this.logger.log('Coin detail job scheduled with daily cron pattern at 11 PM');
  }

  // BullMQ: process and route incoming jobs
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
    } catch (error) {
      this.logger.error(`Failed to process job ${job.id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Helper method to get all coin slugs that are used in ticker pairs on supported exchanges
   * @param supportedExchanges List of supported exchanges to check
   * @returns Set of coin slugs that are used in ticker pairs
   */
  private async getUsedCoinSlugs(supportedExchanges: { slug: string; name: string }[]): Promise<Set<string>> {
    this.logger.log('Checking CoinGecko for coins used in ticker pairs');
    const usedCoinSlugs = new Set<string>();

    // Get supported exchanges from our database
    for (const exchange of supportedExchanges) {
      try {
        this.logger.log(`Checking exchange: ${exchange.name} (${exchange.slug}) for ticker pairs`);

        let page = 1;
        let totalProcessedTickers = 0;

        // Paginate through all tickers for this exchange
        // eslint-disable-next-line no-constant-condition
        while (true) {
          let tickers = [];

          try {
            const id = exchange.slug === 'coinbase' ? 'gdax' : exchange.slug.toLowerCase();

            // Get tickers from CoinGecko for this exchange
            const response = await this.gecko.exchangeIdTickers({
              id,
              page
            });

            tickers = response.tickers || [];

            if (tickers.length === 0) {
              this.logger.log(
                `Completed loading ticker data for ${exchange.name}, total processed: ${totalProcessedTickers}`
              );
              break;
            }

            totalProcessedTickers += tickers.length;

            // Collect coin IDs used in ticker pairs
            for (const ticker of tickers) {
              const baseId = ticker.coin_id?.toLowerCase();
              const quoteId = ticker.target_coin_id?.toLowerCase();

              if (baseId) usedCoinSlugs.add(baseId);
              if (quoteId) usedCoinSlugs.add(quoteId);
            }

            // Apply standard rate limiting to avoid CoinGecko API issues
            await new Promise((r) => setTimeout(r, this.API_RATE_LIMIT_DELAY));
            page++;
          } catch (tickerError) {
            this.logger.error(`Failed to fetch page ${page} tickers for ${exchange.name}: ${tickerError.message}`);
            // If we're on the first page and encounter an error, break out completely
            if (page === 1) break;

            // Otherwise try to move to the next page and continue
            page++;
            continue;
          }
        }
      } catch (error) {
        this.logger.error(`Error getting tickers for exchange ${exchange.name}: ${error.message}`);
        continue; // Continue with next exchange
      }
    }

    return usedCoinSlugs;
  }

  /**
   * Handler for coin synchronization job
   * Gets coins from CoinGecko and syncs them to DB
   * Only coins that are used in ticker pairs (supported on exchanges) are added
   * Removes coins that are either no longer in CoinGecko or not used in any ticker pairs
   */
  async handleSyncCoins(job: Job) {
    try {
      this.logger.log('Starting Coin Sync');
      await job.updateProgress(5); // Initial startup

      // Fetch all coins from CoinGecko and existing coins from our database
      this.logger.log('Fetching data from CoinGecko and database...');
      const [geckoCoins, existingCoins, supportedExchanges] = await Promise.all([
        this.gecko.coinList({ include_platform: false }),
        this.coin.getCoins(),
        this.exchangeService.getExchanges({ supported: true })
      ]);
      await job.updateProgress(15); // Data fetching complete

      // Create a map for faster lookups
      const existingCoinsMap = new Map(existingCoins.map((coin) => [coin.slug, coin]));

      await job.updateProgress(20); // Preprocessing complete

      // Find new coins to add (in CoinGecko but not in our DB)
      // Only add coins that are actually used in ticker pairs
      const usedCoinSlugs = await this.getUsedCoinSlugs(supportedExchanges);
      this.logger.log(`Found ${usedCoinSlugs.size} coins used in any ticker pairs`);

      const newCoins = geckoCoins
        .filter((coin) => !existingCoinsMap.has(coin.id) && usedCoinSlugs.has(coin.id))
        .map(({ id: slug, symbol, name }) => ({
          slug,
          symbol: symbol.toLowerCase(),
          name
        }));

      // Find coins to update (both in CoinGecko and our DB with changed data)
      const coinsToUpdate = [];
      for (const geckoCoin of geckoCoins) {
        const existingCoin = existingCoinsMap.get(geckoCoin.id);
        if (existingCoin) {
          // Check if basic data needs update
          if (existingCoin.symbol !== geckoCoin.symbol.toLowerCase() || existingCoin.name !== geckoCoin.name) {
            coinsToUpdate.push({
              id: existingCoin.id,
              name: geckoCoin.name,
              symbol: geckoCoin.symbol.toLowerCase()
            });
          }
        }
      }

      // Find coins to remove (coins in our DB but no longer in CoinGecko)
      this.logger.log('Identifying coins for removal...');
      const geckoCoinsSet = new Set(geckoCoins.map((coin) => coin.id));
      const missingFromGeckoCoins = existingCoins.filter((coin) => !geckoCoinsSet.has(coin.slug));
      const missingFromGeckoIds = missingFromGeckoCoins.map((coin) => coin.id);

      await job.updateProgress(30); // Basic analysis complete

      // Find coins that are not used in any ticker pairs (not supported on any exchange)
      // First, check existing coins that are still in CoinGecko
      const existingCoinsInGecko = existingCoins.filter((coin) => geckoCoinsSet.has(coin.slug));

      // We've already fetched the used coin slugs earlier

      // Find existing coins that are not used in any ticker pairs
      const unsupportedCoins = existingCoinsInGecko.filter((coin) => !usedCoinSlugs.has(coin.slug));
      const unsupportedCoinIds = unsupportedCoins.map((coin) => coin.id);

      this.logger.log(`Found ${unsupportedCoinIds.length} coins that are not used in any ticker pairs`);

      // Combine both lists for removal: missing from CoinGecko and not used in any ticker pairs
      const coinsToRemove = [...missingFromGeckoIds, ...unsupportedCoinIds];
      const uniqueCoinsToRemove = Array.from(new Set(coinsToRemove)); // Remove duplicates

      await job.updateProgress(45); // CoinGecko ticker analysis complete

      // Execute database operations
      if (newCoins.length > 0) {
        await this.coin.createMany(newCoins);
        this.logger.log(`Added ${newCoins.length} new coins from CoinGecko`);
      }

      if (coinsToUpdate.length > 0) {
        // Update coins one by one to ensure proper error handling
        const updatedCount = await Promise.all(
          coinsToUpdate.map(async ({ id, ...updates }) => {
            try {
              await this.coin.update(id, updates);
              return { success: true };
            } catch (error) {
              this.logger.error(`Failed to update coin ${id}: ${error.message}`);
              return { success: false };
            }
          })
        );

        const successCount = updatedCount.filter((result) => result.success).length;
        this.logger.log(`Updated ${successCount} of ${coinsToUpdate.length} coins`);
      }

      if (uniqueCoinsToRemove.length > 0) {
        // First log detailed information about the coins being removed
        if (missingFromGeckoIds.length > 0) {
          this.logger.log(`Removing ${missingFromGeckoIds.length} coins no longer found in CoinGecko`);
        }

        if (unsupportedCoinIds.length > 0) {
          this.logger.log(`Removing ${unsupportedCoinIds.length} coins not used in any ticker pairs`);
        }

        // Remove all coins in one operation
        await this.coin.removeMany(uniqueCoinsToRemove);
        this.logger.log(`Removed ${uniqueCoinsToRemove.length} coins in total`);
      }

      // Return summary for job completion callback
      return {
        added: newCoins.length,
        updated: coinsToUpdate.length,
        removed: uniqueCoinsToRemove.length,
        total: existingCoins.length + newCoins.length - uniqueCoinsToRemove.length
      };
    } catch (e) {
      this.logger.error('Coin sync failed:', e);
      throw e;
    } finally {
      await job.updateProgress(100); // Job complete
      this.logger.log('Coin Sync Complete');
    }
  }

  /**
   * Handler for detailed coin information update job
   * Now allows all coins in database since the list should be smaller
   */
  async handleCoinDetail(job: Job) {
    try {
      this.logger.log('Starting Detailed Coins Update');
      await job.updateProgress(5); // Initial startup

      this.logger.log('Clearing previous rank data...');
      this.coin.clearRank();
      await job.updateProgress(10); // Database preparation

      // Get trending coins from CoinGecko
      this.logger.log('Fetching trending coins from CoinGecko...');
      const trendingResponse = await this.gecko.trending();
      await job.updateProgress(20); // Trending data fetched

      // Get all existing coins from the database
      const allCoins = await this.coin.getCoins();

      // Add trending rank information to coins
      for (const trendingCoin of trendingResponse.coins) {
        const existingCoin = allCoins.find((coin) => coin.slug === trendingCoin.item.id);
        if (existingCoin) {
          existingCoin.geckoRank = trendingCoin.item.score;
        }
      }

      await job.updateProgress(30); // Trending data processing complete

      let updatedCount = 0;
      let errorCount = 0;
      const batchSize = 10;

      for (let i = 0; i < allCoins.length; i += batchSize) {
        const batch = allCoins.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async ({ id, slug, symbol, geckoRank }) => {
            try {
              this.logger.debug(`Updating details for ${symbol} (${slug})`);
              const coin = await this.gecko.coinId({
                id: slug,
                localization: false,
                tickers: false
              });

              await this.coin.update(id, {
                description: coin.description.en,
                image: coin.image.large || coin.image.small || coin.image.thumb,
                genesis: coin.genesis_date,
                totalSupply: sanitizeNumericValue(coin.market_data.total_supply, {
                  fieldName: `${symbol}.totalSupply`,
                  allowNegative: false
                }),
                totalVolume: sanitizeNumericValue(coin.market_data.total_volume.usd, {
                  fieldName: `${symbol}.totalVolume`,
                  allowNegative: false
                }),
                circulatingSupply: sanitizeNumericValue(coin.market_data.circulating_supply, {
                  fieldName: `${symbol}.circulatingSupply`,
                  allowNegative: false
                }),
                maxSupply: sanitizeNumericValue(coin.market_data.max_supply, {
                  fieldName: `${symbol}.maxSupply`,
                  allowNegative: false
                }),
                marketRank: coin.market_cap_rank,
                marketCap: sanitizeNumericValue(coin.market_data.market_cap.usd, {
                  fieldName: `${symbol}.marketCap`,
                  allowNegative: false
                }),
                geckoRank: coin.coingecko_rank ?? geckoRank ?? null,
                developerScore: coin.developer_score,
                communityScore: coin.community_score,
                liquidityScore: coin.liquidity_score,
                publicInterestScore: coin.public_interest_score,
                sentimentUp: coin.sentiment_votes_up_percentage,
                sentimentDown: coin.sentiment_votes_down_percentage,
                ath: coin.market_data.ath.usd,
                atl: coin.market_data.atl.usd,
                athDate: coin.market_data.ath_date.usd,
                atlDate: coin.market_data.atl_date.usd,
                athChange: coin.market_data.ath_change_percentage.usd,
                atlChange: coin.market_data.atl_change_percentage.usd,
                priceChange24h: coin.market_data.price_change_24h,
                priceChangePercentage24h: coin.market_data.price_change_percentage_24h,
                priceChangePercentage7d: coin.market_data.price_change_percentage_7d,
                priceChangePercentage14d: coin.market_data.price_change_percentage_14d,
                priceChangePercentage30d: coin.market_data.price_change_percentage_30d,
                priceChangePercentage60d: coin.market_data.price_change_percentage_60d,
                priceChangePercentage200d: coin.market_data.price_change_percentage_200d,
                priceChangePercentage1y: coin.market_data.price_change_percentage_1y,
                marketCapChange24h: sanitizeNumericValue(coin.market_data.market_cap_change_24h, {
                  fieldName: `${symbol}.marketCapChange24h`
                }),
                marketCapChangePercentage24h: coin.market_data.market_cap_change_percentage_24h,
                geckoLastUpdatedAt: coin.market_data.last_updated
              });
              this.logger.debug(`Successfully updated ${symbol}`);
              return { success: true };
            } catch (error) {
              this.logger.error(`Failed to update ${symbol}: ${error.message}`);
              return { success: false, error: error.message };
            }
          })
        );

        updatedCount += results.filter((r) => r.success).length;
        errorCount += results.filter((r) => !r.success).length;

        // Update job progress based on how far we've gone through the coins
        const progressPercent = Math.min(35 + Math.floor(((i + batchSize) / allCoins.length) * 60), 95);
        await job.updateProgress(progressPercent);

        // Add a small delay between batches to avoid rate limiting
        if (i + batchSize < allCoins.length) {
          await new Promise((resolve) => setTimeout(resolve, this.API_RATE_LIMIT_DELAY));
        }
      }

      await job.updateProgress(100); // Job complete
      this.logger.log('Detailed Coins Update Complete');

      // Return summary for job completion callback
      return {
        totalCoins: allCoins.length,
        updatedSuccessfully: updatedCount,
        errors: errorCount
      };
    } catch (e) {
      this.logger.error('Failed to process coin details:', e);
      throw e;
    }
  }
}
