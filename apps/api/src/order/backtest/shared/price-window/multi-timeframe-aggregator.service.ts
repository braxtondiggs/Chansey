import { Injectable } from '@nestjs/common';

import { HIGHER_TIMEFRAMES, PriceTimeframe } from './price-timeframe';

import { PriceSummary } from '../../../../ohlc/ohlc-candle.entity';

const HOUR_MS = 60 * 60 * 1000;
const FOUR_HOUR_MS = 4 * HOUR_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/**
 * Expected hourly-bar counts per aggregated bucket. A bucket is only emitted
 * once it reaches this size OR the next hourly bar belongs to a later bucket
 * — this guarantees strategies only see *completed* higher-timeframe bars.
 */
const EXPECTED_BUCKET_SIZE: Record<Exclude<PriceTimeframe, PriceTimeframe.HOURLY>, number> = {
  [PriceTimeframe.FOUR_HOUR]: 4,
  [PriceTimeframe.DAILY]: 24,
  [PriceTimeframe.WEEKLY]: 168
};

/**
 * Pure, stateless aggregation of 1h candles into higher timeframes.
 *
 * The in-memory variant used by Phase 1 — no persistence, no new queues.
 * Called once during backtest initialization (and again if the base series
 * is reloaded). Safe to reuse across optimization combos with the same
 * date range.
 */
@Injectable()
export class MultiTimeframeAggregatorService {
  /**
   * Aggregate per-coin 1h summaries into higher-timeframe summaries.
   * Only emits *completed* buckets — partial trailing buckets are dropped.
   */
  aggregate(
    summariesByCoin: Map<string, PriceSummary[]>,
    timeframes: readonly PriceTimeframe[] = HIGHER_TIMEFRAMES
  ): Map<PriceTimeframe, Map<string, PriceSummary[]>> {
    const result = new Map<PriceTimeframe, Map<string, PriceSummary[]>>();

    for (const tf of timeframes) {
      if (tf === PriceTimeframe.HOURLY) continue;
      const perCoin = new Map<string, PriceSummary[]>();
      for (const [coinId, summaries] of summariesByCoin) {
        perCoin.set(coinId, this.aggregateCoin(summaries, tf));
      }
      result.set(tf, perCoin);
    }

    return result;
  }

  private aggregateCoin(summaries: PriceSummary[], timeframe: PriceTimeframe): PriceSummary[] {
    if (summaries.length === 0) return [];
    if (timeframe === PriceTimeframe.HOURLY) {
      return summaries.slice();
    }

    const expectedSize = EXPECTED_BUCKET_SIZE[timeframe as Exclude<PriceTimeframe, PriceTimeframe.HOURLY>];
    const buckets: PriceSummary[] = [];

    let currentKey: number | null = null;
    let currentStart: Date | null = null;
    let currentOpen: number | undefined;
    let currentHigh = -Infinity;
    let currentLow = Infinity;
    let currentClose: number | undefined;
    let currentAvgFallback: number | undefined;
    let currentVolume = 0;
    let currentHasVolume = false;
    let currentCount = 0;
    let currentCoin: string | undefined;

    const emitCurrent = (): void => {
      if (currentKey === null || currentStart === null || currentCount === 0 || !currentCoin) return;
      const open = currentOpen ?? currentAvgFallback ?? 0;
      const close = currentClose ?? currentAvgFallback ?? 0;
      buckets.push({
        coin: currentCoin,
        date: currentStart,
        open,
        high: currentHigh === -Infinity ? close : currentHigh,
        low: currentLow === Infinity ? close : currentLow,
        close,
        avg: close,
        ...(currentHasVolume ? { volume: currentVolume } : {})
      });
    };

    for (let i = 0; i < summaries.length; i++) {
      const summary = summaries[i];
      const ts = summary.date.getTime();
      const bucketKey = this.bucketKey(ts, timeframe);

      if (currentKey !== bucketKey) {
        // New bucket: flush prior one IF it met expected size (completed bucket rule).
        if (currentKey !== null && currentCount >= expectedSize) {
          emitCurrent();
        }
        currentKey = bucketKey;
        currentStart = new Date(this.bucketStart(bucketKey, timeframe));
        currentOpen = summary.open ?? summary.avg;
        currentHigh = summary.high;
        currentLow = summary.low;
        currentClose = summary.close ?? summary.avg;
        currentAvgFallback = summary.avg;
        currentVolume = 0;
        currentHasVolume = false;
        currentCount = 0;
        currentCoin = summary.coin;
      } else {
        if (summary.high > currentHigh) currentHigh = summary.high;
        if (summary.low < currentLow) currentLow = summary.low;
        currentClose = summary.close ?? summary.avg;
        currentAvgFallback = summary.avg;
      }

      if (summary.volume != null) {
        currentVolume += summary.volume;
        currentHasVolume = true;
      }
      currentCount++;
    }

    // Flush the trailing bucket only if it reached the expected size —
    // otherwise we'd leak a partial candle to strategies.
    if (currentKey !== null && currentCount >= expectedSize) {
      emitCurrent();
    }

    return buckets;
  }

  private bucketKey(timestampMs: number, timeframe: PriceTimeframe): number {
    switch (timeframe) {
      case PriceTimeframe.FOUR_HOUR:
        return Math.floor(timestampMs / FOUR_HOUR_MS);
      case PriceTimeframe.DAILY:
        return Math.floor(timestampMs / DAY_MS);
      case PriceTimeframe.WEEKLY:
        // ISO-week buckets anchor on Monday 00:00 UTC.
        // Unix epoch 1970-01-01 was a Thursday, so shift by 4 days.
        return Math.floor((timestampMs - 4 * DAY_MS) / WEEK_MS);
      default:
        return Math.floor(timestampMs / HOUR_MS);
    }
  }

  private bucketStart(bucketKey: number, timeframe: PriceTimeframe): number {
    switch (timeframe) {
      case PriceTimeframe.FOUR_HOUR:
        return bucketKey * FOUR_HOUR_MS;
      case PriceTimeframe.DAILY:
        return bucketKey * DAY_MS;
      case PriceTimeframe.WEEKLY:
        return bucketKey * WEEK_MS + 4 * DAY_MS;
      default:
        return bucketKey * HOUR_MS;
    }
  }
}
