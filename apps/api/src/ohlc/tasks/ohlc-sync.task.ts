import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { forwardRef, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { Job, Queue } from 'bullmq';

import { CoinService } from '../../coin/coin.service';
import { ExchangeService } from '../../exchange/exchange.service';
import { LOCK_DEFAULTS, LOCK_KEYS } from '../../shared/distributed-lock.constants';
import { DistributedLockService } from '../../shared/distributed-lock.service';
import { toErrorInfo } from '../../shared/error.util';
import { ExchangeSymbolMap } from '../exchange-symbol-map.entity';
import { OHLCService } from '../ohlc.service';
import { ExchangeOHLCService } from '../services/exchange-ohlc.service';

@Processor('ohlc-sync-queue')
@Injectable()
export class OHLCSyncTask extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(OHLCSyncTask.name);
  private jobScheduled = false;

  constructor(
    @InjectQueue('ohlc-sync-queue') private readonly ohlcQueue: Queue,
    private readonly ohlcService: OHLCService,
    private readonly exchangeOHLC: ExchangeOHLCService,
    @Inject(forwardRef(() => CoinService))
    private readonly coinService: CoinService,
    private readonly exchangeService: ExchangeService,
    private readonly configService: ConfigService,
    private readonly lockService: DistributedLockService
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

    await this.seedSymbolMapsIfEmpty();

    if (!this.jobScheduled) {
      await this.scheduleOHLCSyncJob();
      this.jobScheduled = true;
    }
  }

  /**
   * Weekly refresh: add symbol mappings for any new popular coins
   * Runs every Sunday at 4:00 AM
   */
  @Cron('0 4 * * 0')
  async refreshSymbolMaps(): Promise<void> {
    if (
      process.env.NODE_ENV === 'development' ||
      process.env.DISABLE_BACKGROUND_TASKS === 'true' ||
      this.configService.get('OHLC_SYNC_ENABLED') === 'false'
    ) {
      return;
    }

    const lock = await this.lockService.acquire({
      key: LOCK_KEYS.SYMBOL_MAP_REFRESH,
      ttlMs: LOCK_DEFAULTS.SCHEDULE_LOCK_TTL_MS,
      maxRetries: 2,
      retryDelayMs: 500
    });

    if (!lock.acquired) {
      this.logger.log('Another instance is refreshing symbol maps, skipping');
      return;
    }

    try {
      this.logger.log('Running weekly symbol map refresh');
      await this.seedSymbolMaps();
    } finally {
      await this.lockService.release(LOCK_KEYS.SYMBOL_MAP_REFRESH, lock.lockId);
    }
  }

  /**
   * Seed symbol mappings only if the table is completely empty (first boot)
   */
  private async seedSymbolMapsIfEmpty(): Promise<void> {
    try {
      const existing = await this.ohlcService.getActiveSymbolMaps();
      if (existing.length > 0) {
        return;
      }

      this.logger.log('No symbol mappings found, seeding from popular coins');
      await this.seedSymbolMaps();
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to check/seed symbol maps: ${err.message}`);
    }
  }

  /**
   * Create symbol mappings for popular coins, validating that pairs actually exist on exchanges.
   * Tries each exchange in priority order and picks the first one with a valid pair.
   */
  private async seedSymbolMaps(): Promise<void> {
    try {
      // Deactivate mappings that have never synced and have accumulated failures
      // Uses the same threshold as runtime deactivation to avoid removing transiently-failed mappings
      const deactivated = await this.ohlcService.deactivateFailedMappings(OHLCSyncTask.MAX_CONSECUTIVE_FAILURES);
      if (deactivated > 0) {
        this.logger.log(`Deactivated ${deactivated} failed symbol mappings before re-seeding`);
      }

      const exchanges = await this.exchangeService.getExchanges({ supported: true });
      const exchangePriority = this.exchangeOHLC.getExchangePriority();

      // Build a map of exchange slug -> exchange entity for quick lookup
      const exchangeBySlug = new Map(exchanges.map((e) => [e.slug, e]));

      // Pre-load markets for each exchange in priority order
      for (const slug of exchangePriority) {
        if (!exchangeBySlug.has(slug)) continue;
        try {
          await this.exchangeOHLC.getAvailableSymbols(slug, 'BTC'); // triggers loadMarkets()
        } catch (error: unknown) {
          const err = toErrorInfo(error);
          this.logger.warn(`Failed to load markets for ${slug}: ${err.message}`);
        }
      }

      const coins = await this.coinService.getPopularCoins(50);

      if (coins.length === 0) {
        this.logger.warn('No popular coins found, cannot seed symbol maps');
        return;
      }

      let created = 0;
      let skipped = 0;

      for (const coin of coins) {
        try {
          let mapped = false;

          for (const slug of exchangePriority) {
            const exchange = exchangeBySlug.get(slug);
            if (!exchange) continue;

            const symbols = await this.exchangeOHLC.getAvailableSymbols(slug, coin.symbol);
            if (symbols.length > 0) {
              await this.ohlcService.upsertSymbolMap({
                coinId: coin.id,
                exchangeId: exchange.id,
                symbol: symbols[0], // Already sorted: /USD preferred over /USDT
                isActive: true,
                priority: 0,
                failureCount: 0
              });
              created++;
              mapped = true;
              break;
            }
          }

          if (!mapped) {
            this.logger.warn(`No valid trading pair found for ${coin.symbol} on any exchange, skipping`);
            skipped++;
          }
        } catch (error: unknown) {
          const err = toErrorInfo(error);
          this.logger.warn(`Failed to create symbol map for ${coin.symbol}: ${err.message}`);
        }
      }

      this.logger.log(`Seeded ${created} symbol mappings, skipped ${skipped} coins with no valid pairs`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to seed symbol maps: ${err.message}`);
    }
  }

  /**
   * Schedule the recurring job for OHLC synchronization.
   * Uses distributed locking to prevent race conditions in multi-instance deployments.
   */
  private async scheduleOHLCSyncJob() {
    // Acquire a distributed lock to prevent race conditions when multiple instances start simultaneously
    const lock = await this.lockService.acquire({
      key: LOCK_KEYS.OHLC_SYNC_SCHEDULE,
      ttlMs: LOCK_DEFAULTS.SCHEDULE_LOCK_TTL_MS,
      maxRetries: 2,
      retryDelayMs: 500
    });

    if (!lock.acquired) {
      this.logger.log('Another instance is scheduling OHLC sync job, skipping');
      return;
    }

    try {
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
    } finally {
      await this.lockService.release(LOCK_KEYS.OHLC_SYNC_SCHEDULE, lock.lockId);
    }
  }

  // BullMQ: process incoming jobs
  async process(job: Job) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);
    try {
      return await this.handleOHLCSync(job);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to process job ${job.id}: ${err.message}`, err.stack);
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
        } catch (error: unknown) {
          const err = toErrorInfo(error);
          this.logger.error(`Failed to sync OHLC for coin ${coinId}: ${err.message}`);
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
    } catch (error: unknown) {
      this.logger.error('OHLC sync failed:', error);
      throw error;
    }
  }

  /**
   * Sync a single symbol mapping
   */
  private static readonly MAX_CONSECUTIVE_FAILURES = 24;

  private async syncSingleMapping(
    mapping: ExchangeSymbolMap,
    since: number
  ): Promise<{ success: boolean; closePrice?: number }> {
    try {
      const result = await this.exchangeOHLC.fetchOHLC(mapping.exchange.slug, mapping.symbol, since, 5);

      if (!result.success || !result.candles || result.candles.length === 0) {
        await this.ohlcService.incrementFailureCount(mapping.id);
        await this.deactivateIfExceededThreshold(mapping);
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
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to sync ${mapping.symbol} from ${mapping.exchange?.slug}: ${err.message}`);
      await this.ohlcService.incrementFailureCount(mapping.id);
      await this.deactivateIfExceededThreshold(mapping);
      return { success: false };
    }
  }

  /**
   * Deactivate a mapping if its failure count has exceeded the threshold
   */
  private async deactivateIfExceededThreshold(mapping: ExchangeSymbolMap): Promise<void> {
    if (mapping.failureCount + 1 >= OHLCSyncTask.MAX_CONSECUTIVE_FAILURES) {
      this.logger.warn(
        `Deactivating ${mapping.symbol} on ${mapping.exchange?.slug} after ${OHLCSyncTask.MAX_CONSECUTIVE_FAILURES} consecutive failures`
      );
      await this.ohlcService.updateSymbolMapStatus(mapping.id, false);
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
