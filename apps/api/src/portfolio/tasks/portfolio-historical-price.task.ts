import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { Job, Queue } from 'bullmq';

import { CoinService } from '../../coin/coin.service';
import { OHLCBackfillService } from '../../ohlc/services/ohlc-backfill.service';

interface HistoricalPriceJobData {
  coinId: string;
}
@Processor('portfolio-queue')
@Injectable()
export class PortfolioHistoricalPriceTask extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(PortfolioHistoricalPriceTask.name);
  private readonly DAYS_TO_FETCH = 90; // Fetch 90 days of historical data

  constructor(
    @InjectQueue('portfolio-queue') private readonly portfolioQueue: Queue,
    private readonly coin: CoinService,
    private readonly ohlcBackfill: OHLCBackfillService
  ) {
    super();
  }

  async onModuleInit() {
    // Skip scheduling jobs in local development
    if (process.env.NODE_ENV === 'development' || process.env.DISABLE_BACKGROUND_TASKS === 'true') {
      this.logger.log('Portfolio historical price jobs disabled for local development');
      return;
    }

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
   * Handler for fetching historical price data when a portfolio item is added.
   * Delegates to OHLCBackfillService which fetches OHLC data from exchanges.
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

      this.logger.log(`Fetching historical OHLC data for ${coin.name} (${coin.slug})`);
      await job.updateProgress(20);

      // Check if there's already a backfill in progress
      const existingProgress = await this.ohlcBackfill.getProgress(coinId);
      if (existingProgress?.status === 'in_progress') {
        this.logger.log(`OHLC backfill already in progress for ${coin.name}`);
        await job.updateProgress(100);
        return {
          coinId,
          coinName: coin.name,
          message: 'OHLC backfill already in progress',
          status: existingProgress.status
        };
      }

      if (existingProgress?.status === 'completed') {
        this.logger.log(`OHLC backfill already completed for ${coin.name}`);
        await job.updateProgress(100);
        return {
          coinId,
          coinName: coin.name,
          message: 'OHLC data already exists',
          status: existingProgress.status
        };
      }

      await job.updateProgress(30);

      // Calculate date range for backfill
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - this.DAYS_TO_FETCH * 24 * 60 * 60 * 1000);

      this.logger.log(
        `Starting OHLC backfill from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`
      );

      // Start the OHLC backfill (runs asynchronously)
      const jobId = await this.ohlcBackfill.startBackfill(coinId, startDate, endDate);

      await job.updateProgress(100);
      this.logger.log(`Started OHLC backfill job ${jobId} for ${coin.name}`);

      return {
        coinId,
        coinName: coin.name,
        message: 'OHLC backfill started',
        backfillJobId: jobId
      };
    } catch (error) {
      this.logger.error(`Failed to start OHLC backfill for coin ${coinId}: ${error.message}`, error.stack);
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
