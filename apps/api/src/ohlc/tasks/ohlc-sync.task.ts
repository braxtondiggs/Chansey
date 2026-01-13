import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { forwardRef, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CronExpression } from '@nestjs/schedule';

import { Job, Queue } from 'bullmq';

import { CoinService } from '../../coin/coin.service';
import { ExchangeSymbolMap } from '../exchange-symbol-map.entity';
import { OHLCService } from '../ohlc.service';
import { ExchangeOHLCService } from '../services/exchange-ohlc.service';

@Processor('ohlc-queue')
@Injectable()
export class OHLCSyncTask extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(OHLCSyncTask.name);
  private jobScheduled = false;

  constructor(
    @InjectQueue('ohlc-queue') private readonly ohlcQueue: Queue,
    private readonly ohlcService: OHLCService,
    private readonly exchangeOHLC: ExchangeOHLCService,
    @Inject(forwardRef(() => CoinService))
    private readonly coinService: CoinService,
    private readonly configService: ConfigService
  ) {
    super();
  }

  /**
   * Lifecycle hook that runs once when the module is initialized
   */
  async onModuleInit() {
    // Skip scheduling jobs in local development or when disabled
    if (
      process.env.NODE_ENV === 'development' ||
      process.env.DISABLE_BACKGROUND_TASKS === 'true' ||
      this.configService.get('OHLC_SYNC_ENABLED') === 'false'
    ) {
      this.logger.log('OHLC sync jobs disabled');
      return;
    }

    if (!this.jobScheduled) {
      await this.scheduleOHLCSyncJob();
      this.jobScheduled = true;
    }
  }

  /**
   * Schedule the recurring job for OHLC synchronization
   */
  private async scheduleOHLCSyncJob() {
    // Check if there's already a scheduled job with the same name
    const repeatedJobs = await this.ohlcQueue.getRepeatableJobs();
    const existingJob = repeatedJobs.find((job) => job.name === 'ohlc-sync');

    if (existingJob) {
      this.logger.log(`OHLC sync job already scheduled with pattern: ${existingJob.pattern}`);
      return;
    }

    // Get cron pattern from config or use default (every hour at minute 5)
    const cronPattern = this.configService.get('OHLC_SYNC_CRON') || CronExpression.EVERY_HOUR;

    await this.ohlcQueue.add(
      'ohlc-sync',
      {
        timestamp: new Date().toISOString(),
        description: 'Scheduled OHLC sync job'
      },
      {
        repeat: { pattern: cronPattern },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 100,
        removeOnFail: 50
      }
    );

    this.logger.log(`OHLC sync job scheduled with pattern: ${cronPattern}`);
  }

  // BullMQ: process and route incoming jobs
  async process(job: Job) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);
    try {
      if (job.name === 'ohlc-sync') {
        return await this.handleOHLCSync(job);
      } else {
        throw new Error(`Unknown job name: ${job.name}`);
      }
    } catch (error) {
      this.logger.error(`Failed to process job ${job.id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Handler for OHLC synchronization job
   */
  async handleOHLCSync(job: Job) {
    try {
      this.logger.log('Starting OHLC Sync');
      await job.updateProgress(10);

      // Get all active symbol mappings
      const symbolMaps = await this.ohlcService.getActiveSymbolMaps();
      await job.updateProgress(15);

      if (symbolMaps.length === 0) {
        this.logger.warn('No active symbol mappings found. Skipping OHLC sync.');
        return {
          totalMappings: 0,
          processed: 0,
          successCount: 0,
          errorCount: 0
        };
      }

      this.logger.log(`Found ${symbolMaps.length} active symbol mappings`);

      let successCount = 0;
      let errorCount = 0;

      // Calculate the start time for fetching candles
      // We want to get the latest candle, so we'll fetch from 2 hours ago
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;

      // Group mappings by coin to avoid duplicate fetches
      const mappingsByCoin = this.groupMappingsByCoin(symbolMaps);

      let processedCount = 0;
      const totalCoins = Object.keys(mappingsByCoin).length;

      for (const [coinId, mappings] of Object.entries(mappingsByCoin)) {
        try {
          // Try each mapping in priority order until one succeeds
          let syncSuccess = false;

          for (const mapping of mappings) {
            const result = await this.syncSingleMapping(mapping, twoHoursAgo);

            if (result.success) {
              syncSuccess = true;
              // Update currentPrice on the Coin entity
              if (result.closePrice !== undefined) {
                await this.coinService.updateCurrentPrice(coinId, result.closePrice);
              }
              break;
            }
          }

          if (syncSuccess) {
            successCount++;
          } else {
            errorCount++;
          }
        } catch (error) {
          this.logger.error(`Failed to sync OHLC for coin ${coinId}: ${error.message}`);
          errorCount++;
        }

        processedCount++;
        await job.updateProgress(15 + Math.floor((processedCount / totalCoins) * 80));

        // Small delay between coins to avoid rate limiting
        await this.sleep(100);
      }

      await job.updateProgress(100);
      this.logger.log(`OHLC Sync Complete: ${successCount} success, ${errorCount} errors`);

      return {
        totalMappings: symbolMaps.length,
        totalCoins,
        processed: processedCount,
        successCount,
        errorCount
      };
    } catch (error) {
      this.logger.error('OHLC sync failed:', error);
      throw error;
    }
  }

  /**
   * Sync a single symbol mapping
   */
  private async syncSingleMapping(
    mapping: ExchangeSymbolMap,
    since: number
  ): Promise<{ success: boolean; closePrice?: number }> {
    try {
      const result = await this.exchangeOHLC.fetchOHLC(mapping.exchange.slug, mapping.symbol, since, 5);

      if (!result.success || !result.candles || result.candles.length === 0) {
        // Increment failure count
        await this.ohlcService.incrementFailureCount(mapping.id);
        return { success: false };
      }

      // Convert to candle entities and save
      const candles = result.candles.map((candle) => ({
        coinId: mapping.coinId,
        exchangeId: mapping.exchangeId,
        timestamp: new Date(candle.timestamp),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume
      }));

      await this.ohlcService.upsertCandles(candles);

      // Mark sync as successful
      await this.ohlcService.markSyncSuccess(mapping.id);

      // Return the close price of the most recent candle
      const latestCandle = result.candles[result.candles.length - 1];
      return { success: true, closePrice: latestCandle.close };
    } catch (error) {
      this.logger.warn(`Failed to sync ${mapping.symbol} from ${mapping.exchange?.slug}: ${error.message}`);
      await this.ohlcService.incrementFailureCount(mapping.id);
      return { success: false };
    }
  }

  /**
   * Group symbol mappings by coin ID, sorted by priority
   */
  private groupMappingsByCoin(mappings: ExchangeSymbolMap[]): Record<string, ExchangeSymbolMap[]> {
    const grouped: Record<string, ExchangeSymbolMap[]> = {};

    for (const mapping of mappings) {
      if (!grouped[mapping.coinId]) {
        grouped[mapping.coinId] = [];
      }
      grouped[mapping.coinId].push(mapping);
    }

    // Sort each group by priority
    for (const coinId of Object.keys(grouped)) {
      grouped[coinId].sort((a, b) => a.priority - b.priority);
    }

    return grouped;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
