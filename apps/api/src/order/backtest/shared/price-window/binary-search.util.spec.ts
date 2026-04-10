import { binarySearchLeft, binarySearchRight } from './binary-search.util';

import { OHLCCandle } from '../../../../ohlc/ohlc-candle.entity';

const makeCandle = (ts: number): OHLCCandle =>
  new OHLCCandle({
    coinId: 'btc',
    timestamp: new Date(ts),
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1000
  });

describe('binarySearchLeft', () => {
  const candles = [1000, 2000, 3000, 4000, 5000].map(makeCandle);

  it('returns 0 when target is before all candles', () => {
    expect(binarySearchLeft(candles, 500)).toBe(0);
  });

  it('returns index of exact match', () => {
    expect(binarySearchLeft(candles, 3000)).toBe(2);
  });

  it('returns index of next candle when target falls between', () => {
    expect(binarySearchLeft(candles, 2500)).toBe(2);
  });

  it('returns length when target is after all candles', () => {
    expect(binarySearchLeft(candles, 6000)).toBe(5);
  });

  it('handles empty array', () => {
    expect(binarySearchLeft([], 1000)).toBe(0);
  });
});

describe('binarySearchRight', () => {
  const candles = [1000, 2000, 3000, 4000, 5000].map(makeCandle);

  it('returns 0 when target is before all candles', () => {
    expect(binarySearchRight(candles, 500)).toBe(0);
  });

  it('returns index after exact match', () => {
    expect(binarySearchRight(candles, 3000)).toBe(3);
  });

  it('returns index of next candle when target falls between', () => {
    expect(binarySearchRight(candles, 2500)).toBe(2);
  });

  it('returns length when target is after all candles', () => {
    expect(binarySearchRight(candles, 6000)).toBe(5);
  });

  it('handles empty array', () => {
    expect(binarySearchRight([], 1000)).toBe(0);
  });

  it('returns index after last for last timestamp', () => {
    expect(binarySearchRight(candles, 5000)).toBe(5);
  });
});
