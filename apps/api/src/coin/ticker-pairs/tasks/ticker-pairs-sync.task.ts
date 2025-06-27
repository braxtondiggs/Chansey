import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { Job, Queue } from 'bullmq';
import { CoinGeckoClient } from 'coingecko-api-v3';

import { ExchangeService } from '../../../exchange/exchange.service';
import { CoinService } from '../../coin.service';
import { TickerPairStatus, TickerPairs } from '../ticker-pairs.entity';
import { TickerPairService } from '../ticker-pairs.service';

// Default trading pair status values
const DEFAULT_STATUS = TickerPairStatus.TRADING;
const DEFAULT_SPOT_TRADING_ALLOWED = true;
const DEFAULT_MARGIN_TRADING_ALLOWED = false;

@Processor('ticker-pairs-queue')
@Injectable()
export class TickerPairSyncTask extends WorkerHost implements OnModuleInit {
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });
  private readonly logger = new Logger(TickerPairSyncTask.name);
  private jobScheduled = false;

  constructor(
    @InjectQueue('ticker-pairs-queue') private readonly tickerPairQueue: Queue,
    private readonly coin: CoinService,
    private readonly exchange: ExchangeService,
    private readonly tickerPair: TickerPairService
  ) {
    super();
  }

  /**
   * Lifecycle hook that runs once when the module is initialized
   * This ensures the cron job is only scheduled once when the application starts
   */
  async onModuleInit() {
    // Skip scheduling jobs in local development
    if (process.env.NODE_ENV === 'development' || process.env.DISABLE_BACKGROUND_TASKS === 'true') {
      this.logger.log('Ticker pairs sync jobs disabled for local development');
      return;
    }

    if (!this.jobScheduled) {
      await this.scheduleTickerPairSyncJob();
      this.jobScheduled = true;
    }
  }

  /**
   * Schedule the recurring job for ticker pair synchronization
   */
  private async scheduleTickerPairSyncJob() {
    // Check if there's already a scheduled job with the same name
    const repeatedJobs = await this.tickerPairQueue.getRepeatableJobs();
    const existingJob = repeatedJobs.find((job) => job.name === 'ticker-pair-sync');

    if (existingJob) {
      this.logger.log(`Ticker pair sync job already scheduled with pattern: ${existingJob.pattern}`);
      return;
    }

    await this.tickerPairQueue.add(
      'ticker-pair-sync',
      {
        timestamp: new Date().toISOString(),
        description: 'Scheduled ticker pair sync job'
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

    this.logger.log('Ticker pair sync job scheduled with weekly cron pattern');
  }

  /**
   * Process incoming jobs
   */
  async process(job: Job) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);
    try {
      if (job.name === 'ticker-pair-sync') {
        const result = await this.handleSyncTickerPairs(job);
        this.logger.log(`Job ${job.id} completed with result: ${JSON.stringify(result)}`);
        return result;
      }
    } catch (error) {
      this.logger.error(`Failed to process job ${job.id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Handler for ticker pair synchronization job
   * Uses CoinGecko's exchange/tickers API to get ticker pairs for supported exchanges
   */
  async handleSyncTickerPairs(job: Job) {
    const startTime = Date.now();
    try {
      this.logger.log('Starting ticker pairs synchronization');
      await job.updateProgress(10);

      // Get all supported exchanges
      const supportedExchanges = await this.exchange.getExchanges({ supported: true });
      if (supportedExchanges.length === 0) {
        this.logger.warn('No supported exchanges found, cannot sync ticker pairs');
        return { processedExchanges: 0, addedPairs: 0, updatedPairs: 0, executionTimeMs: Date.now() - startTime };
      }

      await job.updateProgress(20);

      // Get all existing coins from the database
      // These are already synced from CoinGecko via the coin-sync job
      const coins = await this.coin.getCoins();
      if (coins.length === 0) {
        this.logger.warn('No coins found in database, cannot sync ticker pairs');
        return { processedExchanges: 0, addedPairs: 0, updatedPairs: 0, executionTimeMs: Date.now() - startTime };
      }

      // Create a map of coins by slug for faster lookups
      const coinsBySlug = new Map(coins.map((coin) => [coin.slug.toLowerCase(), coin]));

      await job.updateProgress(30);

      // Get current ticker pairs from the database
      const existingPairs = await this.tickerPair.getTickerPairs();
      const newPairs: TickerPairs[] = [];

      await job.updateProgress(40);

      let processedExchanges = 0;
      const totalExchanges = supportedExchanges.length;

      // Process each supported exchange
      for (const exchange of supportedExchanges) {
        try {
          this.logger.log(`Processing ticker pairs for ${exchange.name} (${exchange.slug})`);
          let page = 1;
          const exchangePairs = new Set<string>();
          let totalProcessedTickers = 0;

          // Paginate through all tickers for this exchange
          // eslint-disable-next-line no-constant-condition
          while (true) {
            let tickers = [];

            try {
              // Get tickers from CoinGecko for this exchange
              const response = await this.gecko.exchangeIdTickers({
                id: exchange.slug,
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
            } catch (tickerError) {
              this.logger.error(`Failed to fetch page ${page} tickers for ${exchange.name}: ${tickerError.message}`);
              // If we're on the first page and encounter an error, break out completely
              if (page === 1) break;

              // Otherwise try to move to the next page and continue
              page++;
              continue;
            }

            // Process each ticker from the current page
            for (const ticker of tickers) {
              // Extract coin IDs from the ticker data
              const baseId = ticker.coin_id?.toLowerCase();
              const quoteId = ticker.target_coin_id?.toLowerCase();

              // Skip if coin IDs are missing
              if (!baseId || !quoteId) {
                this.logger.debug(`Skipping ticker with missing coin IDs: ${ticker.base}/${ticker.target}`);
                continue;
              }

              // Get the coin objects from our database
              const baseCoin = coinsBySlug.get(baseId);
              const quoteCoin = coinsBySlug.get(quoteId);

              // Skip if either coin is not in our database
              if (!baseCoin || !quoteCoin) {
                this.logger.debug(
                  `Skipping ticker ${ticker.base}/${ticker.target}: coins not found in database (base: ${!!baseCoin}, quote: ${!!quoteCoin})`
                );
                continue;
              }

              // Create a unique key for this ticker pair
              const pairKey = `${baseCoin.id}-${quoteCoin.id}-${exchange.id}`;
              exchangePairs.add(pairKey);

              // Look for an existing ticker pair matching this one
              const existingPair = existingPairs.find(
                (p) =>
                  p.baseAsset.id === baseCoin.id && p.quoteAsset.id === quoteCoin.id && p.exchange.id === exchange.id
              );

              if (!existingPair) {
                // Create a new ticker pair
                const newPair = await this.tickerPair.createTickerPair({
                  baseAsset: baseCoin,
                  quoteAsset: quoteCoin,
                  exchange,
                  volume: ticker.volume || 0,
                  tradeUrl: ticker.trade_url,
                  spreadPercentage: ticker.bid_ask_spread_percentage || 0,
                  lastTraded: ticker.last_traded_at,
                  fetchAt: new Date(),
                  status: DEFAULT_STATUS,
                  isSpotTradingAllowed: DEFAULT_SPOT_TRADING_ALLOWED,
                  isMarginTradingAllowed: DEFAULT_MARGIN_TRADING_ALLOWED
                });

                newPairs.push(newPair);
              } else {
                // Update the existing pair with new data
                Object.assign(existingPair, {
                  volume: ticker.volume || existingPair.volume,
                  tradeUrl: ticker.trade_url || existingPair.tradeUrl,
                  spreadPercentage: ticker.bid_ask_spread_percentage || existingPair.spreadPercentage,
                  lastTraded: ticker.last_traded_at,
                  fetchAt: new Date()
                  // Not updating status or trading flags as they should be managed separately
                });
              }
            }

            this.logger.log(`Processed page ${page} for ${exchange.name}, found ${tickers.length} ticker pairs`);

            // Apply standard rate limiting to avoid CoinGecko API issues
            await new Promise((r) => setTimeout(r, 1000));
            page++;
          }

          // Find pairs that are no longer present in the exchange data
          // and should be removed or marked as inactive
          const pairsToRemove = existingPairs.filter((pair) => {
            // Only consider pairs for the current exchange
            if (pair.exchange.id !== exchange.id) return false;

            // Check if the pair is still present in the exchange data
            const pairKey = `${pair.baseAsset.id}-${pair.quoteAsset.id}-${pair.exchange.id}`;
            return !exchangePairs.has(pairKey);
          });

          if (pairsToRemove.length > 0) {
            await this.tickerPair.removeTickerPair(pairsToRemove);
            this.logger.log(`Removed ${pairsToRemove.length} deprecated pairs for ${exchange.name}`);
          }

          // Update progress as each exchange is processed
          processedExchanges++;
          await job.updateProgress(40 + Math.floor((processedExchanges / totalExchanges) * 50));
        } catch (exchangeError) {
          this.logger.error(`Error processing exchange ${exchange.name}:`, exchangeError);
          continue; // Continue with next exchange
        }
      }

      // Save new ticker pairs with error handling
      if (newPairs.length > 0) {
        try {
          const savedPairs = await this.tickerPair.saveTickerPair(newPairs);
          this.logger.log(`Added ${savedPairs.length} new ticker pairs`);
        } catch (error) {
          this.logger.error(`Error saving new ticker pairs: ${error.message}`);
          // If there's a bulk error, try saving them one by one to identify which ones fail
          let savedCount = 0;
          for (const pair of newPairs) {
            try {
              await this.tickerPair.saveTickerPair([pair]);
              savedCount++;
            } catch (pairError) {
              this.logger.error(
                `Failed to save ticker pair ${pair.baseAsset.symbol}${pair.quoteAsset.symbol} for ${pair.exchange.name}: ${pairError.message}`
              );
            }
          }
          this.logger.log(`Saved ${savedCount}/${newPairs.length} new ticker pairs individually after bulk error`);
        }
      }

      // Update existing ticker pairs with error handling
      try {
        await this.tickerPair.saveTickerPair(existingPairs);
      } catch (error) {
        this.logger.error(`Error updating existing ticker pairs: ${error.message}`);
        // If there's a bulk error, try saving them in smaller batches
        const batchSize = 50;
        for (let i = 0; i < existingPairs.length; i += batchSize) {
          const batch = existingPairs.slice(i, i + batchSize);
          try {
            await this.tickerPair.saveTickerPair(batch);
          } catch (batchError) {
            this.logger.error(`Failed to save batch of ticker pairs: ${batchError.message}`);
          }
        }
      }

      await job.updateProgress(100);
      this.logger.log('Ticker pairs synchronization completed');

      // Return summary for job completion callback
      return {
        processedExchanges,
        addedPairs: newPairs.length,
        updatedPairs: existingPairs.length,
        executionTimeMs: Date.now() - startTime
      };
    } catch (error) {
      this.logger.error('Failed to synchronize ticker pairs:', error);
      throw error;
    }
  }
}
