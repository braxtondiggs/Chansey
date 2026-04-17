import { MultiTimeframeAggregatorService } from './multi-timeframe-aggregator.service';
import { HIGHER_TIMEFRAMES, PriceTimeframe } from './price-timeframe';

import type { PriceSummary } from '../../../../ohlc/ohlc-candle.entity';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Narrowing helper: the aggregator always returns a map for each requested
 * timeframe, with an entry per input coin — but the return type is nullable.
 * This encapsulates the nullable access so individual tests stay readable.
 */
const getBucket = (
  result: Map<PriceTimeframe, Map<string, PriceSummary[]>>,
  tf: PriceTimeframe,
  coin: string
): PriceSummary[] => {
  const map = result.get(tf);
  if (!map) throw new Error(`No aggregated map for timeframe ${tf}`);
  const summaries = map.get(coin);
  if (!summaries) throw new Error(`No summaries for coin ${coin} at timeframe ${tf}`);
  return summaries;
};

describe('MultiTimeframeAggregatorService', () => {
  let service: MultiTimeframeAggregatorService;

  beforeEach(() => {
    service = new MultiTimeframeAggregatorService();
  });

  /**
   * Build N consecutive 1h summaries starting at `startMs` (UTC).
   * Price series walks up linearly so per-bucket OHLCV is easy to verify.
   */
  const buildHourlySeries = (coin: string, startMs: number, count: number, basePrice = 100): PriceSummary[] =>
    Array.from({ length: count }, (_, i) => {
      const close = basePrice + i;
      return {
        coin,
        date: new Date(startMs + i * HOUR_MS),
        avg: close,
        open: close - 0.5,
        close,
        high: close + 1,
        low: close - 1,
        volume: 10
      };
    });

  describe('aggregate', () => {
    it('emits 6 four-hour and 1 daily bucket from 24 aligned hourly bars', () => {
      // 2024-01-15T00:00Z — Monday midnight UTC so the daily/weekly buckets align.
      const start = Date.UTC(2024, 0, 15, 0, 0, 0);
      const hourly = buildHourlySeries('btc', start, 24);
      const input = new Map<string, PriceSummary[]>([['btc', hourly]]);

      const result = service.aggregate(input, HIGHER_TIMEFRAMES);

      const fourHour = getBucket(result, PriceTimeframe.FOUR_HOUR, 'btc');
      expect(fourHour).toHaveLength(6);
      // First 4h bucket: hours 0-3, opens at first hour's open, closes at hour 3.
      expect(fourHour[0].open).toBe(hourly[0].open);
      expect(fourHour[0].close).toBe(hourly[3].close);
      expect(fourHour[0].high).toBe(Math.max(...hourly.slice(0, 4).map((c) => c.high)));
      expect(fourHour[0].low).toBe(Math.min(...hourly.slice(0, 4).map((c) => c.low)));
      expect(fourHour[0].volume).toBe(40); // 4 × 10
      expect(fourHour[0].date.getTime()).toBe(start);

      const daily = getBucket(result, PriceTimeframe.DAILY, 'btc');
      expect(daily).toHaveLength(1);
      expect(daily[0].open).toBe(hourly[0].open);
      expect(daily[0].close).toBe(hourly[23].close);
      expect(daily[0].volume).toBe(240);
      expect(daily[0].date.getTime()).toBe(start);
    });

    it('drops partial trailing buckets (23 hours -> 0 daily, 5 four-hour)', () => {
      const start = Date.UTC(2024, 0, 15, 0, 0, 0);
      const hourly = buildHourlySeries('btc', start, 23);
      const input = new Map<string, PriceSummary[]>([['btc', hourly]]);

      const result = service.aggregate(input, HIGHER_TIMEFRAMES);

      expect(getBucket(result, PriceTimeframe.FOUR_HOUR, 'btc')).toHaveLength(5);
      expect(getBucket(result, PriceTimeframe.DAILY, 'btc')).toHaveLength(0);
      expect(getBucket(result, PriceTimeframe.WEEKLY, 'btc')).toHaveLength(0);
    });

    it('respects 4h bucket boundaries (hours 1-4 produce no bucket, hours 0-4 produce one)', () => {
      const start = Date.UTC(2024, 0, 15, 1, 0, 0);
      // Four hours but starting at 01:00 — they span two buckets (01-03, 04).
      const hourly = buildHourlySeries('btc', start, 4);
      const input = new Map<string, PriceSummary[]>([['btc', hourly]]);

      const result = service.aggregate(input, [PriceTimeframe.FOUR_HOUR]);

      // First bucket 01-03 has only 3 bars → incomplete, dropped.
      // Second bucket 04 has 1 bar → incomplete, dropped.
      expect(getBucket(result, PriceTimeframe.FOUR_HOUR, 'btc')).toHaveLength(0);
    });

    it('returns empty maps for empty input without throwing', () => {
      const result = service.aggregate(new Map(), HIGHER_TIMEFRAMES);
      expect(result.get(PriceTimeframe.FOUR_HOUR)?.size ?? 0).toBe(0);
      expect(result.get(PriceTimeframe.DAILY)?.size ?? 0).toBe(0);
    });

    it('handles coins with empty summaries without throwing', () => {
      const input = new Map<string, PriceSummary[]>([['btc', []]]);
      const result = service.aggregate(input, HIGHER_TIMEFRAMES);
      expect(getBucket(result, PriceTimeframe.DAILY, 'btc')).toEqual([]);
    });

    it('anchors weekly buckets on Monday 00:00 UTC (Sunday->Monday transition)', () => {
      // 2024-01-14T23:00Z is a Sunday; 2024-01-15T00:00Z is Monday.
      // Build 168 * 2 hours = 2 full weeks starting from Monday 2024-01-15.
      const mondayStart = Date.UTC(2024, 0, 15, 0, 0, 0);
      const hourly = buildHourlySeries('btc', mondayStart, 168 * 2);
      const input = new Map<string, PriceSummary[]>([['btc', hourly]]);

      const result = service.aggregate(input, [PriceTimeframe.WEEKLY]);
      const weekly = getBucket(result, PriceTimeframe.WEEKLY, 'btc');

      expect(weekly).toHaveLength(2);
      expect(weekly[0].date.getUTCDay()).toBe(1); // Monday
      expect(weekly[0].date.getTime()).toBe(mondayStart);
      expect(weekly[1].date.getTime()).toBe(mondayStart + 7 * 24 * HOUR_MS);
    });

    it('treats Sunday-starting hourly bars as belonging to the prior week bucket', () => {
      // Start Sunday 2024-01-14T00:00Z; 168 hours covers Sunday+Mon-Sat.
      // But week buckets anchor on Monday, so the Sunday bars roll into the
      // week that ended Monday 2024-01-15 00:00Z → incomplete first week,
      // then one full Mon-Sun week -> exactly one complete bucket.
      const sundayStart = Date.UTC(2024, 0, 14, 0, 0, 0);
      const hourly = buildHourlySeries('btc', sundayStart, 168 * 2);
      const input = new Map<string, PriceSummary[]>([['btc', hourly]]);

      const result = service.aggregate(input, [PriceTimeframe.WEEKLY]);
      const weekly = getBucket(result, PriceTimeframe.WEEKLY, 'btc');

      expect(weekly).toHaveLength(1);
      expect(weekly[0].date.getUTCDay()).toBe(1); // Monday
      expect(weekly[0].date.getTime()).toBe(Date.UTC(2024, 0, 15, 0, 0, 0));
    });

    it('handles missing volume without emitting a bogus volume field', () => {
      const start = Date.UTC(2024, 0, 15, 0, 0, 0);
      const hourly: PriceSummary[] = buildHourlySeries('btc', start, 4).map((s) => {
        const { volume: _volume, ...rest } = s;
        return rest;
      });
      const input = new Map<string, PriceSummary[]>([['btc', hourly]]);

      const result = service.aggregate(input, [PriceTimeframe.FOUR_HOUR]);
      const bucket = getBucket(result, PriceTimeframe.FOUR_HOUR, 'btc')[0];

      expect(bucket.volume).toBeUndefined();
    });
  });
});
