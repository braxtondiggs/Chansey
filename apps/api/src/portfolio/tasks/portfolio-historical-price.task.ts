import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { Job, Queue } from 'bullmq';
import { CoinGeckoClient } from 'coingecko-api-v3';
import * as dayjs from 'dayjs';

import { CoinService } from '../../coin/coin.service';
import { CreatePriceDto } from '../../price/dto/create-price.dto';
import { PriceService } from '../../price/price.service';

interface HistoricalPriceJobData {
  coinId: string;
}
@Processor('portfolio-queue')
@Injectable()
export class PortfolioHistoricalPriceTask extends WorkerHost implements OnModuleInit {
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });
  private readonly logger = new Logger(PortfolioHistoricalPriceTask.name);
  private readonly BATCH_SIZE = 100; // Batch size for inserting price data
  private readonly DAYS_TO_FETCH = 90; // Fetch 90 days to get hourly data (CoinGecko returns hourly data for 1-90 days)

  constructor(
    @InjectQueue('portfolio-queue') private readonly portfolioQueue: Queue,
    private readonly coin: CoinService,
    private readonly price: PriceService
  ) {
    super();
  }

  async onModuleInit() {
    this.logger.log('Portfolio Historical Price Task initialized');
  }

  // BullMQ: process and route incoming jobs
  async process(job: Job) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);

    try {
      if (job.name === 'fetch-historical-prices') {
        return await this.handleFetchHistoricalPrices(job);
      } else {
        throw new Error(`Unknown job name: ${job.name}`);
      }
    } catch (error) {
      this.logger.error(`Failed to process job ${job.id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Handler for fetching historical price data when a portfolio item is added
   */
  async handleFetchHistoricalPrices(job: Job) {
    const { coinId }: HistoricalPriceJobData = job.data;

    try {
      this.logger.log(`Starting historical price fetch for coin ${coinId}`);
      await job.updateProgress(10);

      // Get the coin details
      const coin = await this.coin.getCoinById(coinId);
      if (!coin) {
        throw new Error(`Coin with ID ${coinId} not found`);
      }

      this.logger.log(`Fetching historical prices for ${coin.name} (${coin.slug})`);
      await job.updateProgress(20);

      // Check if we already have recent price data for this coin
      const existingPrices = await this.price.findAll(coin.id, 'all');
      const latestPriceDate =
        existingPrices.length > 0
          ? dayjs(Math.max(...existingPrices.map((p) => new Date(p.geckoLastUpdatedAt).getTime())))
          : null;

      // Determine the date range to fetch
      const toDate = dayjs();
      const fromDate =
        latestPriceDate && latestPriceDate.isAfter(dayjs().subtract(this.DAYS_TO_FETCH, 'days'))
          ? latestPriceDate.add(1, 'day') // Start from day after the latest price
          : dayjs().subtract(this.DAYS_TO_FETCH, 'days'); // Fetch full year

      // Skip if we already have recent data
      if (latestPriceDate && latestPriceDate.isAfter(dayjs().subtract(1, 'day'))) {
        this.logger.log(`Recent price data already exists for ${coin.name}, skipping historical fetch`);
        await job.updateProgress(100);
        return {
          coinId,
          coinName: coin.name,
          message: 'Recent price data already exists, skipping fetch',
          totalPrices: 0
        };
      }

      this.logger.log(
        `Fetching historical prices from ${fromDate.format('YYYY-MM-DD')} to ${toDate.format('YYYY-MM-DD')}`
      );
      await job.updateProgress(30);

      // Fetch historical market chart data from CoinGecko
      // Note: CoinGecko returns hourly data for 1-90 days, daily data for 91+ days
      const { prices, market_caps, total_volumes } = await this.gecko.coinIdMarketChartRange({
        id: coin.slug,
        vs_currency: 'usd',
        from: fromDate.unix(),
        to: toDate.unix()
      });

      await job.updateProgress(60);

      if (!prices || prices.length === 0) {
        this.logger.warn(`No historical price data available for ${coin.name}`);
        await job.updateProgress(100);
        return {
          coinId,
          coinName: coin.name,
          message: 'No historical price data available',
          totalPrices: 0
        };
      }

      this.logger.log(`Processing ${prices.length} historical price points for ${coin.name}`);

      // Convert the data to CreatePriceDto format and batch it
      const priceDataBatches = prices.reduce((batches, [timestamp, price], index) => {
        const marketCap = market_caps.find(([t]) => t === timestamp)?.[1];
        const totalVolume = total_volumes.find(([t]) => t === timestamp)?.[1];

        // Skip if we don't have complete data
        if (!marketCap || !totalVolume || !price) return batches;

        const batchIndex = Math.floor(index / this.BATCH_SIZE);
        if (!batches[batchIndex]) batches[batchIndex] = [];

        batches[batchIndex].push({
          coin,
          coinId: coin.id,
          price,
          marketCap,
          totalVolume,
          geckoLastUpdatedAt: new Date(timestamp)
        } as CreatePriceDto);

        return batches;
      }, [] as CreatePriceDto[][]);

      await job.updateProgress(80);

      // Insert price data in batches to avoid overwhelming the database
      let totalInserted = 0;
      for (const [batchIndex, batch] of priceDataBatches.entries()) {
        try {
          await this.price.createMany(batch);
          totalInserted += batch.length;

          this.logger.debug(
            `Inserted batch ${batchIndex + 1}/${priceDataBatches.length} (${batch.length} prices) for ${coin.name}`
          );

          // Small delay between batches to avoid overwhelming the database
          if (batchIndex < priceDataBatches.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        } catch (error) {
          this.logger.error(`Failed to insert price batch ${batchIndex + 1} for ${coin.name}: ${error.message}`);
          // Continue with next batch even if one fails
        }
      }

      await job.updateProgress(100);
      this.logger.log(`Successfully inserted ${totalInserted} historical price points for ${coin.name}`);

      return {
        coinId,
        coinName: coin.name,
        totalPrices: totalInserted,
        dateRange: {
          from: fromDate.format('YYYY-MM-DD'),
          to: toDate.format('YYYY-MM-DD')
        }
      };
    } catch (error) {
      this.logger.error(`Failed to fetch historical prices for coin ${coinId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Add a job to fetch historical prices for a coin
   */
  async addHistoricalPriceJob(coinId: string) {
    const jobData: HistoricalPriceJobData = {
      coinId
    };

    const job = await this.portfolioQueue.add('fetch-historical-prices', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000
      },
      removeOnComplete: 50, // Keep last 50 completed jobs
      removeOnFail: 20 // Keep last 20 failed jobs
    });

    this.logger.log(`Added historical price fetch job ${job.id} for coin ${coinId}`);
    return job;
  }
}
