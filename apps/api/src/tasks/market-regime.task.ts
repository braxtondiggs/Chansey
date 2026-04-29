import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { Queue } from 'bullmq';

import { DEFAULT_VOLATILITY_CONFIG } from '@chansey/api-interfaces';

import { CoinService } from '../coin/coin.service';
import { CoinSelectionService } from '../coin-selection/coin-selection.service';
import { CompositeRegimeService } from '../market-regime/composite-regime.service';
import { MarketRegimeService } from '../market-regime/market-regime.service';
import { OHLCService } from '../ohlc/ohlc.service';
import { OHLCBackfillService } from '../ohlc/services/ohlc-backfill.service';
import { toErrorInfo } from '../shared/error.util';

/** Default asset list used when the dynamic resolver fails — keeps regime tracking from going dark. */
const DEFAULT_MONITORED_ASSETS = ['BTC', 'ETH', 'SOL', 'POL'] as const;

/** Bound concurrent BullMQ enqueues per regime sweep so Redis backpressure stays bounded as the universe grows. */
const ENQUEUE_BATCH_SIZE = 10;

/**
 * Market Regime Check Task
 * Automated background job for detecting market regime changes
 * Runs periodically to monitor market volatility
 */
@Injectable()
export class MarketRegimeTask {
  private readonly logger = new Logger(MarketRegimeTask.name);

  constructor(
    @InjectQueue('regime-check-queue') private regimeQueue: Queue,
    private readonly marketRegimeService: MarketRegimeService,
    private readonly compositeRegimeService: CompositeRegimeService,
    private readonly ohlcService: OHLCService,
    private readonly coinService: CoinService,
    private readonly backfillService: OHLCBackfillService,
    private readonly coinSelectionService: CoinSelectionService
  ) {}

  /**
   * Schedule market regime checks
   * Runs every hour to detect regime changes
   */
  @Cron(CronExpression.EVERY_HOUR)
  async scheduleRegimeCheck() {
    this.logger.log('Starting scheduled market regime check');

    const assets = await this.resolveMonitoredAssets();

    for (let i = 0; i < assets.length; i += ENQUEUE_BATCH_SIZE) {
      const batch = assets.slice(i, i + ENQUEUE_BATCH_SIZE);
      await Promise.all(batch.map((asset) => this.queueRegimeCheck(asset)));
    }

    try {
      await this.compositeRegimeService.refresh();
      this.logger.log('Composite regime refreshed');
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to refresh composite regime: ${err.message}`);
    }
  }

  /**
   * Resolve the set of assets to track by reading every coin in any user's
   * coin_selection (AUTOMATIC + MANUAL + WATCHED), then unioning with BTC
   * which the BTC-global trend-filter macro signal always requires.
   *
   * Falls back to the legacy hardcoded set on any error so regime tracking
   * never goes dark.
   */
  private async resolveMonitoredAssets(): Promise<string[]> {
    try {
      const symbols = await this.coinSelectionService.getEligibleSymbolsForRegimeTracking();
      return Array.from(new Set([...symbols, 'BTC']));
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to resolve monitored assets, using default set: ${err.message}`);
      return [...DEFAULT_MONITORED_ASSETS];
    }
  }

  /**
   * Queue regime check for specific asset
   */
  async queueRegimeCheck(asset: string): Promise<void> {
    try {
      await this.regimeQueue.add(
        'check-regime',
        {
          asset,
          timestamp: new Date().toISOString()
        },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 3000
          },
          removeOnComplete: true,
          removeOnFail: 50
        }
      );

      this.logger.log(`Queued regime check for ${asset}`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to queue regime check for ${asset}: ${err.message}`);
    }
  }

  /**
   * Process regime check job
   * This would be called by a BullMQ processor
   */
  async processRegimeCheck(asset: string): Promise<void> {
    this.logger.log(`Processing regime check for ${asset}`);

    try {
      // Fetch recent price data (last 365 days for percentile calculation)
      const priceData = await this.fetchPriceData(asset);

      if (!priceData) {
        this.logger.warn(`No price data available for ${asset}, skipping regime detection`);
        return;
      }

      // Detect current regime
      await this.marketRegimeService.detectRegime(asset, priceData);

      this.logger.log(`Regime check complete for ${asset}`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to check regime for ${asset}: ${err.message}`);
      throw error;
    }
  }

  /**
   * Fetch historical price data for asset from local OHLC candles.
   * @param asset Asset symbol (e.g., 'BTC', 'ETH')
   * @returns Array of daily closing prices in chronological order, or null if unavailable
   */
  private async fetchPriceData(asset: string): Promise<number[] | null> {
    try {
      const coin = await this.coinService.getCoinBySymbol(asset, [], false);
      if (!coin) {
        this.logger.warn(`Coin not found for symbol ${asset}, skipping regime check`);
        return null;
      }

      const summaries = await this.ohlcService.findAllByDay(coin.id, '1y');
      const coinSummaries = summaries[coin.id];

      if (!coinSummaries || coinSummaries.length === 0) {
        this.logger.warn(`No OHLC data for ${asset}`);
        await this.triggerBackfillIfNeeded(coin.id, asset, 0);
        return null;
      }

      // findAllByDay returns descending order — reverse to chronological
      const closes = coinSummaries
        .map((s) => s.close)
        .filter((v): v is number => Number.isFinite(v))
        .reverse();

      const requiredDays = DEFAULT_VOLATILITY_CONFIG.lookbackDays;

      if (closes.length < requiredDays) {
        await this.triggerBackfillIfNeeded(coin.id, asset, closes.length);
        return null;
      }

      // Trim to required days for percentile calculation
      if (closes.length > requiredDays) {
        return closes.slice(-requiredDays);
      }

      return closes;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to fetch price data for ${asset}: ${err.message}`);
      return null;
    }
  }

  /**
   * Trigger OHLC backfill if no backfill is already pending or in progress.
   */
  private async triggerBackfillIfNeeded(coinId: string, asset: string, count: number): Promise<void> {
    const required = DEFAULT_VOLATILITY_CONFIG.lookbackDays;
    try {
      const progress = await this.backfillService.getProgress(coinId);
      if (
        progress &&
        (progress.status === 'pending' || progress.status === 'in_progress' || progress.status === 'failed')
      ) {
        this.logger.warn(
          `Insufficient OHLC data for ${asset} (${count}/${required} days) — backfill already ${progress.status}`
        );
        return;
      }

      this.logger.warn(`Insufficient OHLC data for ${asset} (${count}/${required} days) — backfill triggered`);
      this.backfillService.startBackfill(coinId).catch((error: unknown) => {
        const err = toErrorInfo(error);
        this.logger.warn(`Failed to trigger backfill for ${asset}: ${err.message}`);
      });
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to check backfill progress for ${asset}: ${err.message}`);
    }
  }

  /**
   * Manually trigger regime check for an asset
   */
  async triggerRegimeCheck(asset: string): Promise<void> {
    await this.queueRegimeCheck(asset);
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    const jobCounts = await this.regimeQueue.getJobCounts();
    const monitoredAssets = await this.resolveMonitoredAssets();
    return {
      waiting: jobCounts.waiting,
      active: jobCounts.active,
      completed: jobCounts.completed,
      failed: jobCounts.failed,
      monitoredAssets
    };
  }
}
