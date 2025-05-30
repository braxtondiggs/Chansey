import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { Job, Queue } from 'bullmq';
import { CoinGeckoClient } from 'coingecko-api-v3';

import { CoinService } from '../../coin/coin.service';
import { PortfolioService } from '../../portfolio/portfolio.service';
import { CreatePriceDto } from '../dto/create-price.dto';
import { PriceService } from '../price.service';

@Processor('price-queue')
@Injectable()
export class PriceSyncTask extends WorkerHost implements OnModuleInit {
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });
  private readonly logger = new Logger(PriceSyncTask.name);
  private readonly BATCH_SIZE = 50; // CoinGecko has a limit on number of coins per request
  private jobScheduled = false;

  constructor(
    @InjectQueue('price-queue') private readonly priceQueue: Queue,
    private readonly portfolio: PortfolioService,
    private readonly price: PriceService,
    private readonly coin: CoinService
  ) {
    super();
  }

  /**
   * Lifecycle hook that runs once when the module is initialized
   * This ensures the cron jobs are only scheduled once when the application starts
   */
  async onModuleInit() {
    if (!this.jobScheduled) {
      await this.schedulePriceSyncJob();
      this.jobScheduled = true;
    }
  }

  /**
   * Schedule the recurring job for price synchronization
   */
  private async schedulePriceSyncJob() {
    // Check if there's already a scheduled job with the same name
    const repeatedJobs = await this.priceQueue.getRepeatableJobs();
    const existingJob = repeatedJobs.find((job) => job.name === 'price-sync');

    if (existingJob) {
      this.logger.log(`Price sync job already scheduled with pattern: ${existingJob.pattern}`);
      return;
    }

    await this.priceQueue.add(
      'price-sync',
      {
        timestamp: new Date().toISOString(),
        description: 'Scheduled price sync job'
      },
      {
        repeat: { pattern: CronExpression.EVERY_5_MINUTES },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 100, // keep the last 100 completed jobs
        removeOnFail: 50 // keep the last 50 failed jobs
      }
    );

    this.logger.log('Price sync job scheduled with 5-minute cron pattern');
  }

  // BullMQ: process and route incoming jobs
  async process(job: Job) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);
    try {
      if (job.name === 'price-sync') {
        return await this.handlePriceSync(job);
      } else {
        throw new Error(`Unknown job name: ${job.name}`);
      }
    } catch (error) {
      this.logger.error(`Failed to process job ${job.id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Handler for price synchronization job
   */
  async handlePriceSync(job: Job) {
    try {
      this.logger.log('Starting Price Sync');
      await job.updateProgress(10);

      const coins = await this.portfolio.getPortfolioCoins();
      await job.updateProgress(20);

      let totalCoinsProcessed = 0;
      let successCount = 0;
      let errorCount = 0;

      // Process coins in batches
      for (let i = 0; i < coins.length; i += this.BATCH_SIZE) {
        const batch = coins.slice(i, i + this.BATCH_SIZE);
        const ids = batch.map(({ slug }) => slug).join(',');

        try {
          await job.updateProgress(20 + Math.floor(((i + batch.length) / coins.length) * 70));

          const prices = await this.gecko.simplePrice({
            ids,
            vs_currencies: 'usd',
            include_24hr_vol: true,
            include_market_cap: true,
            include_last_updated_at: true
          });

          const updates: CreatePriceDto[] = batch
            .map((coin) => {
              const coinData = prices[coin.slug];
              if (!coinData) {
                this.logger.warn(`No price data found for ${coin.name} (${coin.slug})`);
                return null;
              }

              return {
                price: coinData.usd,
                marketCap: coinData.usd_market_cap,
                totalVolume: coinData.usd_24h_vol,
                geckoLastUpdatedAt: new Date(coinData.last_updated_at * 1000),
                coin: coin,
                coinId: coin.id
              };
            })
            .filter(Boolean);

          const results = await Promise.all(
            updates.map(async (update) => {
              try {
                // Create price record
                await this.price.create(update);

                // Update coin's current price
                await this.coin.updateCurrentPrice(update.coinId, update.price);

                return { success: true, coinId: update.coinId };
              } catch (error) {
                this.logger.error(`Failed to update price for coin ${update.coinId}:`, error);
                return { success: false, coinId: update.coinId, error: error.message };
              }
            })
          );

          totalCoinsProcessed += batch.length;
          successCount += results.filter((r) => r.success).length;
          errorCount += results.filter((r) => !r.success).length;

          // Add a small delay between batches to avoid rate limiting
          if (i + this.BATCH_SIZE < coins.length) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        } catch (error) {
          this.logger.error(`Failed to fetch prices for batch starting with ${batch[0].slug}:`, error);
          errorCount += batch.length;
        }
      }

      await job.updateProgress(100);
      this.logger.log('Price Sync Complete');

      // Return summary for job completion callback
      return {
        totalCoins: coins.length,
        processed: totalCoinsProcessed,
        updatedSuccessfully: successCount,
        errors: errorCount
      };
    } catch (error) {
      this.logger.error('Price sync failed:', error);
      throw error;
    }
  }
}
