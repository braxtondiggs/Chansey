import { OHLCCandle } from '../../../../ohlc/ohlc-candle.entity';

/**
 * Find the index of the first candle with timestamp >= target.
 * Candles array must be sorted by timestamp ascending.
 */
export function binarySearchLeft(candles: OHLCCandle[], targetTime: number): number {
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (candles[mid].timestamp.getTime() < targetTime) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * Find the index of the first candle with timestamp > target.
 * Candles array must be sorted by timestamp ascending.
 */
export function binarySearchRight(candles: OHLCCandle[], targetTime: number): number {
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (candles[mid].timestamp.getTime() <= targetTime) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}
