import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Cache } from 'cache-manager';

import { ExchangeOHLCService } from './exchange-ohlc.service';

import { CoinService } from '../../coin/coin.service';
import { ExchangeService } from '../../exchange/exchange.service';
import { OHLCService } from '../ohlc.service';

export interface BackfillProgress {
  coinId: string;
  coinSymbol: string;
  startDate: Date;
  endDate: Date;
  currentDate: Date;
  candlesBackfilled: number;
  percentComplete: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  error?: string;
  startedAt: Date;
  updatedAt: Date;
}

@Injectable()
export class OHLCBackfillService {
  private readonly logger = new Logger(OHLCBackfillService.name);
  private readonly REDIS_PREFIX = 'ohlc:backfill:';
  private readonly BATCH_SIZE = 500; // Max candles per request
  private readonly BATCH_DELAY_MS = 100; // Delay between batches
  private readonly ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

  // Track cancelled jobs in memory
  private cancelledJobs = new Set<string>();

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly ohlcService: OHLCService,
    private readonly exchangeOHLC: ExchangeOHLCService,
    @Inject(forwardRef(() => CoinService))
    private readonly coinService: CoinService,
    @Inject(forwardRef(() => ExchangeService))
    private readonly exchangeService: ExchangeService,
    private readonly configService: ConfigService
  ) {}

  /**
   * Start backfill for a specific coin
   * @returns Job ID for tracking
   */
  async startBackfill(coinId: string, startDate?: Date, endDate?: Date): Promise<string> {
    const coin = await this.coinService.getCoinById(coinId).catch(() => null);
    if (!coin) {
      throw new Error(`Coin not found: ${coinId}`);
    }

    const symbol = `${coin.symbol.toUpperCase()}/USD`;
    const now = new Date();
    const start = startDate || new Date(now.getTime() - this.ONE_YEAR_MS);
    const end = endDate || now;

    const jobId = `backfill-${coinId}-${Date.now()}`;

    const progress: BackfillProgress = {
      coinId,
      coinSymbol: symbol,
      startDate: start,
      endDate: end,
      currentDate: start,
      candlesBackfilled: 0,
      percentComplete: 0,
      status: 'pending',
      startedAt: new Date(),
      updatedAt: new Date()
    };

    await this.saveProgress(coinId, progress);

    // Start the backfill in the background
    this.performBackfill(coinId, symbol, start, end).catch((error) => {
      this.logger.error(`Backfill failed for ${coinId}: ${error.message}`);
    });

    return jobId;
  }

  /**
   * Resume an interrupted backfill
   */
  async resumeBackfill(coinId: string): Promise<void> {
    const progress = await this.getProgress(coinId);

    if (!progress) {
      throw new Error(`No backfill progress found for coin: ${coinId}`);
    }

    if (progress.status === 'completed') {
      this.logger.log(`Backfill already completed for ${coinId}`);
      return;
    }

    if (progress.status === 'in_progress') {
      this.logger.log(`Backfill already in progress for ${coinId}`);
      return;
    }

    // Remove from cancelled set if it was cancelled
    this.cancelledJobs.delete(coinId);

    // Resume from current date
    this.logger.log(`Resuming backfill for ${coinId} from ${progress.currentDate.toISOString()}`);

    await this.updateProgress(coinId, { status: 'in_progress' });

    this.performBackfill(coinId, progress.coinSymbol, progress.currentDate, progress.endDate).catch((error) => {
      this.logger.error(`Resume backfill failed for ${coinId}: ${error.message}`);
    });
  }

  /**
   * Get backfill progress from Redis
   */
  async getProgress(coinId: string): Promise<BackfillProgress | null> {
    const key = `${this.REDIS_PREFIX}${coinId}`;
    const data = await this.cache.get<string>(key);

    if (!data) {
      return null;
    }

    const progress = JSON.parse(data);
    // Convert date strings back to Date objects
    return {
      ...progress,
      startDate: new Date(progress.startDate),
      endDate: new Date(progress.endDate),
      currentDate: new Date(progress.currentDate),
      startedAt: new Date(progress.startedAt),
      updatedAt: new Date(progress.updatedAt)
    };
  }

  /**
   * Get all active backfill jobs
   */
  async getAllProgress(): Promise<BackfillProgress[]> {
    // Note: This is a simplified implementation
    // In production, you might want to store job IDs in a separate set
    const symbolMaps = await this.ohlcService.getActiveSymbolMaps();
    const progress: BackfillProgress[] = [];

    for (const mapping of symbolMaps) {
      const p = await this.getProgress(mapping.coinId);
      if (p && (p.status === 'pending' || p.status === 'in_progress')) {
        progress.push(p);
      }
    }

    return progress;
  }

  /**
   * Cancel a running backfill
   */
  async cancelBackfill(coinId: string): Promise<void> {
    this.cancelledJobs.add(coinId);
    await this.updateProgress(coinId, { status: 'cancelled' });
    this.logger.log(`Backfill cancelled for ${coinId}`);
  }

  /**
   * Backfill hot coins (top coins by market cap).
   * Processes coins in batches to avoid rate limiting.
   * @returns Number of coins queued for backfill
   */
  async backfillHotCoins(): Promise<number> {
    const BATCH_SIZE = 3; // Process 3 coins concurrently to avoid rate limits

    this.logger.log('Starting backfill for popular coins');

    // Get popular coins (uses default limit of 50)
    const coins = await this.coinService.getPopularCoins();

    // Get primary exchange for symbol mapping
    const exchanges = await this.exchangeService.getExchanges({ supported: true });
    const primaryExchange = exchanges.find((e) => e.slug === 'binance_us') || exchanges[0];

    if (!primaryExchange) {
      throw new Error('No supported exchange found for backfill');
    }

    this.logger.log(`Found ${coins.length} coins to backfill`);

    // Process coins in batches to avoid rate limiting
    for (let i = 0; i < coins.length; i += BATCH_SIZE) {
      const batch = coins.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (coin) => {
          try {
            // Create symbol mapping if it doesn't exist
            await this.ohlcService.upsertSymbolMap({
              coinId: coin.id,
              exchangeId: primaryExchange.id,
              symbol: `${coin.symbol.toUpperCase()}/USD`,
              isActive: true,
              priority: 0
            });

            // Start backfill
            await this.startBackfill(coin.id);
          } catch (error) {
            this.logger.error(`Failed to start backfill for ${coin.symbol}: ${error.message}`);
          }
        })
      );

      // Delay between batches to avoid overwhelming the exchange
      if (i + BATCH_SIZE < coins.length) {
        await this.sleep(1000);
      }
    }

    this.logger.log(`Started backfill for ${coins.length} coins`);
    return coins.length;
  }

  /**
   * Perform the actual backfill operation
   */
  private async performBackfill(coinId: string, symbol: string, fromDate: Date, toDate: Date): Promise<void> {
    await this.updateProgress(coinId, { status: 'in_progress' });

    let currentDate = fromDate;
    let totalCandles = 0;

    while (currentDate < toDate) {
      // Check for cancellation
      if (this.isCancelled(coinId)) {
        this.logger.log(`Backfill cancelled for ${coinId}`);
        return;
      }

      try {
        const since = currentDate.getTime();
        const result = await this.exchangeOHLC.fetchOHLCWithFallback(symbol, since, this.BATCH_SIZE);

        if (result.success && result.candles && result.candles.length > 0) {
          // Get exchange ID from the result
          const exchanges = await this.exchangeService.getExchanges({ supported: true });
          const exchange = exchanges.find((e) => e.slug === result.exchangeSlug);

          if (exchange) {
            // Convert and save candles
            const entities = result.candles.map((candle) => ({
              coinId,
              exchangeId: exchange.id,
              timestamp: new Date(candle.timestamp),
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume
            }));

            await this.ohlcService.upsertCandles(entities);
            totalCandles += result.candles.length;

            // Update current date to after the last candle
            const lastCandle = result.candles[result.candles.length - 1];
            currentDate = new Date(lastCandle.timestamp + 3600000); // +1 hour
          }
        } else {
          // No data - skip forward
          currentDate = new Date(currentDate.getTime() + 3600000);
        }

        // Calculate and save progress
        const percentComplete = this.calculateProgress(fromDate, currentDate, toDate);
        await this.updateProgress(coinId, {
          currentDate,
          candlesBackfilled: totalCandles,
          percentComplete
        });

        await this.sleep(this.BATCH_DELAY_MS);
      } catch (error) {
        this.logger.error(`Backfill error for ${coinId}: ${error.message}`);

        // Save progress for resume
        await this.updateProgress(coinId, {
          status: 'failed',
          error: error.message
        });

        throw error;
      }
    }

    // Mark as complete
    await this.updateProgress(coinId, {
      status: 'completed',
      percentComplete: 100
    });

    this.logger.log(`Backfill complete for ${coinId}: ${totalCandles} candles`);
  }

  /**
   * Save progress to Redis
   */
  private async saveProgress(coinId: string, progress: BackfillProgress): Promise<void> {
    const key = `${this.REDIS_PREFIX}${coinId}`;
    // Store for 7 days (enough time to debug issues)
    await this.cache.set(key, JSON.stringify(progress), 7 * 24 * 60 * 60 * 1000);
  }

  /**
   * Update specific fields in progress
   */
  private async updateProgress(coinId: string, updates: Partial<BackfillProgress>): Promise<void> {
    const current = await this.getProgress(coinId);
    if (current) {
      const updated = {
        ...current,
        ...updates,
        updatedAt: new Date()
      };
      await this.saveProgress(coinId, updated);
    }
  }

  /**
   * Check if backfill is cancelled
   */
  private isCancelled(coinId: string): boolean {
    return this.cancelledJobs.has(coinId);
  }

  /**
   * Calculate completion percentage
   */
  private calculateProgress(start: Date, current: Date, end: Date): number {
    const totalMs = end.getTime() - start.getTime();
    const elapsedMs = current.getTime() - start.getTime();
    return Math.min(100, Math.floor((elapsedMs / totalMs) * 100));
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
