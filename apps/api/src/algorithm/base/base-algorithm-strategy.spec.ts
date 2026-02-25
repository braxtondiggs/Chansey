import { SchedulerRegistry } from '@nestjs/schedule';

import { BaseAlgorithmStrategy } from './base-algorithm-strategy';

import { AlgorithmContext, AlgorithmResult } from '../interfaces';

/** Concrete subclass that exposes the protected getPrecomputedSlice for testing. */
class TestStrategy extends BaseAlgorithmStrategy {
  readonly id = 'test-strategy';

  constructor() {
    super({ addCronJob: jest.fn(), deleteCronJob: jest.fn() } as unknown as SchedulerRegistry);
  }

  async execute(): Promise<AlgorithmResult> {
    return { success: true, signals: [], metrics: {} as any, timestamp: new Date() };
  }

  /** Public proxy for the protected method. */
  public slice(context: AlgorithmContext, coinId: string, key: string, windowLength: number): number[] | undefined {
    return this.getPrecomputedSlice(context, coinId, key, windowLength);
  }
}

describe('BaseAlgorithmStrategy.getPrecomputedSlice', () => {
  let strategy: TestStrategy;

  beforeEach(() => {
    strategy = new TestStrategy();
  });

  const makeContext = (series: ArrayLike<number>, currentTimestampIndex: number): AlgorithmContext => ({
    coins: [{ id: 'btc', symbol: 'BTC' }],
    priceData: {},
    timestamp: new Date(),
    config: {},
    precomputedIndicators: { btc: { ema_21: series } },
    currentTimestampIndex
  });

  // --- Boundary: early timestamps (idx < windowLength - 1) ---

  it('idx=0, windowLength=100 → returns array of length 1', () => {
    const series = new Array(200).fill(0).map((_, i) => i);
    const result = strategy.slice(makeContext(series, 0), 'btc', 'ema_21', 100);
    expect(result).toHaveLength(1);
    expect(result![0]).toBe(0);
  });

  it('idx=5, windowLength=100 → returns array of length 6', () => {
    const series = new Array(200).fill(0).map((_, i) => i);
    const result = strategy.slice(makeContext(series, 5), 'btc', 'ema_21', 100);
    expect(result).toHaveLength(6);
    expect(result).toEqual([0, 1, 2, 3, 4, 5]);
  });

  // --- Normal case: full window ---

  it('idx=99, windowLength=100 → returns array of length 100', () => {
    const series = new Array(200).fill(0).map((_, i) => i);
    const result = strategy.slice(makeContext(series, 99), 'btc', 'ema_21', 100);
    expect(result).toHaveLength(100);
    expect(result![0]).toBe(0);
    expect(result![99]).toBe(99);
  });

  it('idx=150, windowLength=100 → returns array of length 100', () => {
    const series = new Array(200).fill(0).map((_, i) => i);
    const result = strategy.slice(makeContext(series, 150), 'btc', 'ema_21', 100);
    expect(result).toHaveLength(100);
    expect(result![0]).toBe(51);
    expect(result![99]).toBe(150);
  });

  // --- Float64Array inputs produce same results as plain number[] ---

  it('Float64Array and number[] produce identical results (early index)', () => {
    const plain = new Array(200).fill(0).map((_, i) => i * 1.5);
    const typed = new Float64Array(plain);

    const plainResult = strategy.slice(makeContext(plain, 3), 'btc', 'ema_21', 20);
    const typedResult = strategy.slice(makeContext(typed, 3), 'btc', 'ema_21', 20);

    expect(plainResult).toEqual(typedResult);
    expect(plainResult).toHaveLength(4);
  });

  it('Float64Array result is a real Array (not a TypedArray view)', () => {
    const typed = new Float64Array(100);
    const result = strategy.slice(makeContext(typed, 50), 'btc', 'ema_21', 20);
    expect(Array.isArray(result)).toBe(true);
  });

  // --- Returns undefined when precomputed data is absent ---

  it('returns undefined when precomputedIndicators is missing', () => {
    const ctx: AlgorithmContext = {
      coins: [{ id: 'btc', symbol: 'BTC' }],
      priceData: {},
      timestamp: new Date(),
      config: {},
      currentTimestampIndex: 5
    };
    expect(strategy.slice(ctx, 'btc', 'ema_21', 10)).toBeUndefined();
  });

  it('returns undefined when currentTimestampIndex is null', () => {
    const ctx: AlgorithmContext = {
      coins: [{ id: 'btc', symbol: 'BTC' }],
      priceData: {},
      timestamp: new Date(),
      config: {},
      precomputedIndicators: { btc: { ema_21: [1, 2, 3] } }
    };
    expect(strategy.slice(ctx, 'btc', 'ema_21', 3)).toBeUndefined();
  });
});
