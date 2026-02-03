import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { OHLCService } from '../../ohlc/ohlc.service';

type DataFreshness = 'fresh' | 'stale' | 'critical' | 'no_data';

/**
 * Health indicator that monitors OHLC data freshness.
 * Uses OHLCService.getSyncStatus() to check data recency.
 * Fails if newest candle is older than 3 hours.
 */
@Injectable()
export class OHLCHealthIndicator {
  private readonly logger = new Logger(OHLCHealthIndicator.name);
  private readonly STALE_THRESHOLD_HOURS = 3;

  constructor(
    private readonly ohlcService: OHLCService,
    private readonly healthIndicatorService: HealthIndicatorService
  ) {}

  /**
   * Check OHLC data freshness
   * Fails if newest candle is older than 3 hours
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    try {
      const syncStatus = await this.ohlcService.getSyncStatus();

      // Handle case where there's no OHLC data
      if (!syncStatus.newestCandle) {
        const result = {
          newestCandle: null,
          timeSinceLastCandleMinutes: null,
          dataFreshness: 'no_data' as DataFreshness,
          totalCandles: syncStatus.totalCandles,
          coinsWithData: syncStatus.coinsWithData
        };
        return indicator.up(result);
      }

      const now = new Date();
      const timeSinceLastCandleMs = now.getTime() - syncStatus.newestCandle.getTime();
      const timeSinceLastCandleMinutes = Math.round(timeSinceLastCandleMs / (1000 * 60));
      const timeSinceLastCandleHours = timeSinceLastCandleMinutes / 60;

      // Determine data freshness status
      let dataFreshness: DataFreshness;
      if (timeSinceLastCandleHours <= 1) {
        dataFreshness = 'fresh';
      } else if (timeSinceLastCandleHours <= this.STALE_THRESHOLD_HOURS) {
        dataFreshness = 'stale';
      } else {
        dataFreshness = 'critical';
      }

      const result = {
        newestCandle: syncStatus.newestCandle.toISOString(),
        timeSinceLastCandleMinutes,
        dataFreshness,
        totalCandles: syncStatus.totalCandles,
        coinsWithData: syncStatus.coinsWithData
      };

      // Fail if data is too old
      if (dataFreshness === 'critical') {
        return indicator.down({
          ...result,
          message: `Newest candle is ${timeSinceLastCandleMinutes} minutes old (threshold: ${this.STALE_THRESHOLD_HOURS * 60} minutes)`
        });
      }

      return indicator.up(result);
    } catch (error) {
      this.logger.error(`OHLC health check failed: ${error.message}`);
      return indicator.down({ error: error.message });
    }
  }
}
