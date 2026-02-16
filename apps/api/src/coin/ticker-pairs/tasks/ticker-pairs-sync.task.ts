import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { Job, Queue } from 'bullmq';
import { CoinGeckoClient } from 'coingecko-api-v3';

import { ExchangeService } from '../../../exchange/exchange.service';
import { toErrorInfo } from '../../../shared/error.util';
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
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to process job ${job.id}: ${err.message}`, err.stack);
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
            const id = exchange.slug === 'coinbase' ? 'gdax' : exchange.slug.toLowerCase();

            try {
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
            } catch (tickerError: unknown) {
              const err = toErrorInfo(tickerError);
              this.logger.error(`Failed to fetch page ${page} tickers for ${exchange.name}: ${err.message}`);
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
              const baseSymbol = String(ticker.base ?? '');
              const targetSymbol = String(ticker.target ?? '');

              // Skip tickers with missing symbols
              if (!baseSymbol || !targetSymbol) {
                this.logger.debug(`Skipping ticker with missing base or target symbol`);
                continue;
              }

              // Get the coin objects from our database
              const baseCoin = baseId ? coinsBySlug.get(baseId) : undefined;
              const quoteCoin = quoteId ? coinsBySlug.get(quoteId) : undefined;

              // Determine if this is a fiat pair
              const baseIsFiat = !baseCoin && this.isFiatCurrency(baseSymbol);
              const quoteIsFiat = !quoteCoin && this.isFiatCurrency(targetSymbol);
              const isFiatPair = baseIsFiat || quoteIsFiat;

              // Skip if neither coin exists and it's not a fiat pair
              if (!baseCoin && !quoteCoin && !isFiatPair) {
                this.logger.debug(
                  `Skipping ticker ${baseSymbol}/${targetSymbol}: coins not found in database and not fiat pair`
                );
                continue;
              }

              // Skip if one coin exists but the other doesn't and it's not fiat
              if ((!baseCoin && !baseIsFiat) || (!quoteCoin && !quoteIsFiat)) {
                this.logger.debug(
                  `Skipping ticker ${baseSymbol}/${targetSymbol}: missing coin in database (base: ${!!baseCoin || baseIsFiat}, quote: ${!!quoteCoin || quoteIsFiat})`
                );
                continue;
              }

              // Create a unique key for this ticker pair
              const baseKey = baseCoin?.id || baseSymbol;
              const quoteKey = quoteCoin?.id || targetSymbol;
              const pairKey = `${baseKey}-${quoteKey}-${exchange.id}`;
              exchangePairs.add(pairKey);

              // Look for an existing ticker pair matching this one
              const existingPair = existingPairs.find((p) => {
                if (isFiatPair) {
                  // For fiat pairs, match by symbol and exchange
                  const expectedSymbol = `${baseSymbol}${targetSymbol}`.toUpperCase();
                  return p.symbol === expectedSymbol && p.exchange.id === exchange.id;
                } else {
                  // For regular pairs, match by coin IDs
                  return (
                    p.baseAsset?.id === baseCoin?.id &&
                    p.quoteAsset?.id === quoteCoin?.id &&
                    p.exchange.id === exchange.id
                  );
                }
              });

              if (!existingPair) {
                // Create a new ticker pair
                const pairData: any = {
                  exchange,
                  volume: Number(ticker.volume ?? 0),
                  tradeUrl: ticker.trade_url,
                  spreadPercentage: Number(ticker.bid_ask_spread_percentage ?? 0),
                  lastTraded: ticker.last_traded_at ?? new Date(),
                  fetchAt: new Date(),
                  status: DEFAULT_STATUS,
                  isSpotTradingAllowed: DEFAULT_SPOT_TRADING_ALLOWED,
                  isMarginTradingAllowed: DEFAULT_MARGIN_TRADING_ALLOWED,
                  isFiatPair
                };

                if (isFiatPair) {
                  // For fiat pairs, store symbols instead of coin references
                  pairData.baseAssetSymbol = baseSymbol.toLowerCase();
                  pairData.quoteAssetSymbol = targetSymbol.toLowerCase();
                  // Only set coin references if they exist
                  if (baseCoin) pairData.baseAsset = baseCoin;
                  if (quoteCoin) pairData.quoteAsset = quoteCoin;
                } else {
                  // For regular pairs, use coin references
                  pairData.baseAsset = baseCoin;
                  pairData.quoteAsset = quoteCoin;
                }

                const newPair = await this.tickerPair.createTickerPair(pairData);

                newPairs.push(newPair);
              } else {
                // Update the existing pair with new data
                Object.assign(existingPair, {
                  volume: Number(ticker.volume ?? existingPair.volume),
                  tradeUrl: ticker.trade_url ?? existingPair.tradeUrl,
                  spreadPercentage: Number(ticker.bid_ask_spread_percentage ?? existingPair.spreadPercentage),
                  lastTraded: ticker.last_traded_at ?? existingPair.lastTraded,
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
            let pairKey: string;
            if (pair.isFiatPair) {
              pairKey = `${pair.baseAssetSymbol || pair.baseAsset?.symbol}-${pair.quoteAssetSymbol || pair.quoteAsset?.symbol}-${pair.exchange.id}`;
            } else {
              pairKey = `${pair.baseAsset?.id}-${pair.quoteAsset?.id}-${pair.exchange.id}`;
            }
            return !exchangePairs.has(pairKey);
          });

          if (pairsToRemove.length > 0) {
            await this.tickerPair.removeTickerPair(pairsToRemove);
            this.logger.log(`Removed ${pairsToRemove.length} deprecated pairs for ${exchange.name}`);
          }

          // Update progress as each exchange is processed
          processedExchanges++;
          await job.updateProgress(40 + Math.floor((processedExchanges / totalExchanges) * 50));
        } catch (exchangeError: unknown) {
          this.logger.error(`Error processing exchange ${exchange.name}:`, exchangeError);
          continue; // Continue with next exchange
        }
      }

      // Save new ticker pairs with error handling
      if (newPairs.length > 0) {
        try {
          const savedPairs = await this.tickerPair.saveTickerPair(newPairs);
          this.logger.log(`Added ${savedPairs.length} new ticker pairs`);
        } catch (error: unknown) {
          const err = toErrorInfo(error);
          this.logger.error(`Error saving new ticker pairs: ${err.message}`);
          // If there's a bulk error, try saving them one by one to identify which ones fail
          let savedCount = 0;
          for (const pair of newPairs) {
            try {
              await this.tickerPair.saveTickerPair([pair]);
              savedCount++;
            } catch (pairError: unknown) {
              const pErr = toErrorInfo(pairError);
              this.logger.error(
                `Failed to save ticker pair ${pair.baseAsset?.symbol ?? pair.baseAssetSymbol ?? 'unknown'}${pair.quoteAsset?.symbol ?? pair.quoteAssetSymbol ?? 'unknown'} for ${pair.exchange.name}: ${pErr.message}`
              );
            }
          }
          this.logger.log(`Saved ${savedCount}/${newPairs.length} new ticker pairs individually after bulk error`);
        }
      }

      // Update existing ticker pairs with error handling
      try {
        await this.tickerPair.saveTickerPair(existingPairs);
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Error updating existing ticker pairs: ${err.message}`);
        // If there's a bulk error, try saving them in smaller batches
        const batchSize = 50;
        for (let i = 0; i < existingPairs.length; i += batchSize) {
          const batch = existingPairs.slice(i, i + batchSize);
          try {
            await this.tickerPair.saveTickerPair(batch);
          } catch (batchError: unknown) {
            const bErr = toErrorInfo(batchError);
            this.logger.error(`Failed to save batch of ticker pairs: ${bErr.message}`);
          }
        }
      }

      // Update ticker pairs count for all exchanges
      this.logger.log('Updating ticker pairs count for all exchanges');
      await this.updateExchangeTickerPairsCounts();

      await job.updateProgress(100);
      this.logger.log('Ticker pairs synchronization completed');

      // Return summary for job completion callback
      return {
        processedExchanges,
        addedPairs: newPairs.length,
        updatedPairs: existingPairs.length,
        executionTimeMs: Date.now() - startTime
      };
    } catch (error: unknown) {
      this.logger.error('Failed to synchronize ticker pairs:', error);
      throw error;
    }
  }

  /**
   * Update ticker pairs count for all exchanges
   * This method counts the actual ticker pairs for each exchange and updates the stored count
   */
  private async updateExchangeTickerPairsCounts(): Promise<void> {
    try {
      // Get all exchanges
      const exchanges = await this.exchange.getExchanges();

      // Get ticker pair counts per exchange in a single query
      const counts = await this.tickerPair.getTickerPairsCountByExchange();

      // Create a map for efficient lookup
      const countMap = new Map<string, number>();
      counts.forEach(({ exchangeId, count }) => {
        countMap.set(exchangeId, count);
      });

      // Update each exchange with its ticker pairs count
      const updatePromises = exchanges.map(async (exchange) => {
        const tickerPairsCount = countMap.get(exchange.id) || 0;

        // Only update if the count has changed
        if (exchange.tickerPairsCount !== tickerPairsCount) {
          try {
            await this.exchange.updateExchange(exchange.id, { tickerPairsCount });
            this.logger.debug(`Updated ${exchange.name} ticker pairs count to ${tickerPairsCount}`);
          } catch (error: unknown) {
            const err = toErrorInfo(error);
            this.logger.error(`Failed to update ticker pairs count for ${exchange.name}: ${err.message}`);
          }
        }
      });

      await Promise.all(updatePromises);
      this.logger.log('Successfully updated ticker pairs counts for all exchanges');
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to update exchange ticker pairs counts: ${err.message}`);
    }
  }

  /**
   * Check if a currency symbol is a fiat currency
   */
  private isFiatCurrency(symbol: string): boolean {
    const fiatCurrencies = [
      'USD',
      'EUR',
      'GBP',
      'JPY',
      'AUD',
      'CAD',
      'CHF',
      'CNY',
      'SEK',
      'NZD',
      'MXN',
      'SGD',
      'HKD',
      'NOK',
      'TRY',
      'RUB',
      'INR',
      'BRL',
      'ZAR',
      'KRW'
    ];
    return fiatCurrencies.includes(symbol.toUpperCase());
  }
}
