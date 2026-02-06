import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { Queue } from 'bullmq';

import { CoinService } from '../coin/coin.service';
import { MarketRegimeService } from '../market-regime/market-regime.service';

/**
 * Market Regime Check Task
 * Automated background job for detecting market regime changes
 * Runs periodically to monitor market volatility
 */
@Injectable()
export class MarketRegimeTask {
  private readonly logger = new Logger(MarketRegimeTask.name);

  // Track assets to monitor
  private readonly monitoredAssets = ['BTC', 'ETH', 'SOL', 'POL'];

  constructor(
    @InjectQueue('regime-check-queue') private regimeQueue: Queue,
    private readonly marketRegimeService: MarketRegimeService,
    private readonly coinService: CoinService
  ) {}

  /**
   * Schedule market regime checks
   * Runs every hour to detect regime changes
   */
  @Cron(CronExpression.EVERY_HOUR)
  async scheduleRegimeCheck() {
    this.logger.log('Starting scheduled market regime check');

    for (const asset of this.monitoredAssets) {
      await this.queueRegimeCheck(asset);
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
          removeOnFail: false
        }
      );

      this.logger.log(`Queued regime check for ${asset}`);
    } catch (error) {
      this.logger.error(`Failed to queue regime check for ${asset}: ${error.message}`);
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
      // Note: This is simplified - full implementation would fetch actual historical prices
      const priceData = await this.fetchPriceData(asset, 365);

      // Detect current regime
      await this.marketRegimeService.detectRegime(asset, priceData);

      this.logger.log(`Regime check complete for ${asset}`);
    } catch (error) {
      this.logger.error(`Failed to check regime for ${asset}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch historical price data for asset using CoinService
   * @param asset Asset symbol (e.g., 'BTC', 'ETH')
   * @param days Number of days of historical data
   * @returns Array of historical prices
   */
  private async fetchPriceData(asset: string, days: number): Promise<number[]> {
    try {
      // Map asset symbol to coin slug (CoinGecko format)
      const assetSlugMap: Record<string, string> = {
        BTC: 'bitcoin',
        ETH: 'ethereum',
        SOL: 'solana',
        POL: 'polygon-ecosystem-token'
      };

      const slug = assetSlugMap[asset.toUpperCase()];
      if (!slug) {
        this.logger.warn(`Unknown asset ${asset}, using fallback price data`);
        return this.generateFallbackPriceData(days);
      }

      // Map days to appropriate period
      let period: '24h' | '7d' | '30d' | '1y' = '1y';
      if (days <= 1) period = '24h';
      else if (days <= 7) period = '7d';
      else if (days <= 30) period = '30d';

      const chartData = await this.coinService.getMarketChart(slug, period);

      if (!chartData.prices || chartData.prices.length === 0) {
        this.logger.warn(`No price data returned for ${asset}, using fallback`);
        return this.generateFallbackPriceData(days);
      }

      // Extract prices from chart data and limit to requested days
      const prices = chartData.prices.map((p) => p.price);

      // If we have more data than requested, take the last N days
      if (prices.length > days) {
        return prices.slice(-days);
      }

      return prices;
    } catch (error) {
      this.logger.error(`Failed to fetch price data for ${asset}: ${error.message}`);
      return this.generateFallbackPriceData(days);
    }
  }

  /**
   * Generate fallback price data when API fails
   * Uses a deterministic pattern based on date to avoid truly random values
   */
  private generateFallbackPriceData(days: number): number[] {
    const prices: number[] = [];
    const basePrice = 50000;
    const today = new Date();

    for (let i = days - 1; i >= 0; i--) {
      // Use date-based deterministic variation instead of random
      const dayOffset = new Date(today);
      dayOffset.setDate(today.getDate() - i);
      const dateHash = dayOffset.getFullYear() * 10000 + (dayOffset.getMonth() + 1) * 100 + dayOffset.getDate();
      const variation = ((dateHash % 1000) - 500) / 50000; // ±1% variation based on date
      prices.push(basePrice * (1 + variation));
    }

    return prices;
  }

  /**
   * Manually trigger regime check for an asset
   */
  async triggerRegimeCheck(asset: string): Promise<void> {
    await this.queueRegimeCheck(asset);
  }

  /**
   * Add asset to monitoring list
   */
  addMonitoredAsset(asset: string): void {
    if (!this.monitoredAssets.includes(asset)) {
      this.monitoredAssets.push(asset);
      this.logger.log(`Added ${asset} to monitored assets`);
    }
  }

  /**
   * Remove asset from monitoring list
   */
  removeMonitoredAsset(asset: string): void {
    const index = this.monitoredAssets.indexOf(asset);
    if (index > -1) {
      this.monitoredAssets.splice(index, 1);
      this.logger.log(`Removed ${asset} from monitored assets`);
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    const jobCounts = await this.regimeQueue.getJobCounts();
    return {
      waiting: jobCounts.waiting,
      active: jobCounts.active,
      completed: jobCounts.completed,
      failed: jobCounts.failed,
      monitoredAssets: this.monitoredAssets
    };
  }
}
