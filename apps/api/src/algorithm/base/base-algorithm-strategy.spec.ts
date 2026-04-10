import { type SchedulerRegistry } from '@nestjs/schedule';

import { BaseAlgorithmStrategy } from './base-algorithm-strategy';

import { AlgorithmStatus } from '../algorithm.entity';
import { type AlgorithmContext, type AlgorithmResult, SignalType, type TradingSignal } from '../interfaces';

/** Concrete subclass that exposes protected methods for testing. */
class TestStrategy extends BaseAlgorithmStrategy {
  readonly id = 'test-strategy';
  executeMock = jest.fn<Promise<AlgorithmResult>, [AlgorithmContext]>();

  constructor() {
    super({ addCronJob: jest.fn(), deleteCronJob: jest.fn() } as unknown as SchedulerRegistry);
  }

  async execute(context: AlgorithmContext): Promise<AlgorithmResult> {
    return this.executeMock(context);
  }

  /** Public proxies for protected methods. */
  public slice(context: AlgorithmContext, coinId: string, key: string, windowLength: number): number[] | undefined {
    return this.getPrecomputedSlice(context, coinId, key, windowLength);
  }

  public errorResult(error: string, executionTime?: number): AlgorithmResult {
    return this.createErrorResult(error, executionTime);
  }

  public successResult(
    signals: AlgorithmResult['signals'],
    chartData?: AlgorithmResult['chartData'],
    metadata?: AlgorithmResult['metadata']
  ): AlgorithmResult {
    return this.createSuccessResult(signals, chartData, metadata);
  }
}

const makeSignal = (overrides: Partial<TradingSignal> = {}): TradingSignal => ({
  type: SignalType.BUY,
  coinId: 'btc',
  strength: 0.8,
  confidence: 0.9,
  reason: 'test signal',
  ...overrides
});

const makeContext = (overrides: Partial<AlgorithmContext> = {}): AlgorithmContext => ({
  coins: [{ id: 'btc', symbol: 'BTC' }],
  priceData: { btc: [{ open: 1, high: 2, low: 0.5, close: 1.5, volume: 100, timestamp: new Date() } as any] },
  timestamp: new Date(),
  config: {},
  ...overrides
});

describe('BaseAlgorithmStrategy', () => {
  let strategy: TestStrategy;

  beforeEach(() => {
    strategy = new TestStrategy();
  });

  // ─── getPrecomputedSlice ──────────────────────────────────────────

  describe('getPrecomputedSlice', () => {
    const makeSliceContext = (series: ArrayLike<number>, currentTimestampIndex: number): AlgorithmContext =>
      makeContext({
        priceData: {},
        precomputedIndicators: { btc: { ema_21: series } },
        currentTimestampIndex
      });

    it.each([
      { idx: 0, windowLength: 100, expectedLength: 1, expectedFirst: 0, expectedLast: 0 },
      { idx: 5, windowLength: 100, expectedLength: 6, expectedFirst: 0, expectedLast: 5 },
      { idx: 99, windowLength: 100, expectedLength: 100, expectedFirst: 0, expectedLast: 99 },
      { idx: 150, windowLength: 100, expectedLength: 100, expectedFirst: 51, expectedLast: 150 }
    ])(
      'idx=$idx, windowLength=$windowLength → length $expectedLength',
      ({ idx, windowLength, expectedLength, expectedFirst, expectedLast }) => {
        const series = Array.from({ length: 200 }, (_, i) => i);
        const result = strategy.slice(makeSliceContext(series, idx), 'btc', 'ema_21', windowLength);
        if (!result) throw new Error('expected slice result');
        expect(result).toHaveLength(expectedLength);
        expect(result[0]).toBe(expectedFirst);
        expect(result[result.length - 1]).toBe(expectedLast);
      }
    );

    it('Float64Array produces identical results to number[] and returns a real Array', () => {
      const plain = Array.from({ length: 200 }, (_, i) => i * 1.5);
      const typed = new Float64Array(plain);

      const plainResult = strategy.slice(makeSliceContext(plain, 3), 'btc', 'ema_21', 20);
      const typedResult = strategy.slice(makeSliceContext(typed, 3), 'btc', 'ema_21', 20);

      expect(plainResult).toEqual(typedResult);
      expect(plainResult).toHaveLength(4);
      expect(Array.isArray(typedResult)).toBe(true);
    });

    it('returns undefined when precomputedIndicators is missing', () => {
      expect(strategy.slice(makeContext({ priceData: {} }), 'btc', 'ema_21', 10)).toBeUndefined();
    });

    it('returns undefined when currentTimestampIndex is null', () => {
      const ctx = makeContext({
        priceData: {},
        precomputedIndicators: { btc: { ema_21: [1, 2, 3] } }
      });
      expect(strategy.slice(ctx, 'btc', 'ema_21', 3)).toBeUndefined();
    });
  });

  // ─── canExecute ───────────────────────────────────────────────────

  describe('canExecute', () => {
    it('returns true with valid context', () => {
      expect(strategy.canExecute(makeContext())).toBe(true);
    });

    it.each([
      ['no coins', makeContext({ coins: [] })],
      ['no priceData keys', makeContext({ priceData: {} })],
      ['undefined coins', makeContext({ coins: undefined as any })]
    ])('returns false when %s', (_, ctx) => {
      expect(strategy.canExecute(ctx)).toBeFalsy();
    });
  });

  // ─── safeExecute ──────────────────────────────────────────────────

  describe('safeExecute', () => {
    it('enriches successful result with execution metrics', async () => {
      const signals = [makeSignal({ confidence: 0.8 })];
      strategy.executeMock.mockResolvedValue({
        success: true,
        signals,
        metrics: { executionTime: 0, signalsGenerated: 0, confidence: 0.8 },
        timestamp: new Date()
      });

      const result = await strategy.safeExecute(makeContext());

      expect(result.success).toBe(true);
      expect(result.metrics?.signalsGenerated).toBe(1);
      expect(result.metrics?.executionTime).toBeGreaterThanOrEqual(0);
      expect(result.metrics?.confidence).toBe(0.8);
    });

    it('returns error result when canExecute fails', async () => {
      const result = await strategy.safeExecute(makeContext({ coins: [] }));

      expect(result.success).toBe(false);
      expect(result.error).toContain('cannot execute');
      expect(strategy.executeMock).not.toHaveBeenCalled();
    });

    it('catches execute() exceptions and returns error result', async () => {
      strategy.executeMock.mockRejectedValue(new Error('boom'));

      const result = await strategy.safeExecute(makeContext());

      expect(result.success).toBe(false);
      expect(result.error).toBe('boom');
      expect(result.metrics?.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('defaults confidence to 0 when result.metrics.confidence is undefined', async () => {
      strategy.executeMock.mockResolvedValue({
        success: true,
        signals: [],
        metrics: { executionTime: 0, signalsGenerated: 0 } as any,
        timestamp: new Date()
      });

      const result = await strategy.safeExecute(makeContext());
      expect(result.metrics?.confidence).toBe(0);
    });
  });

  // ─── healthCheck ──────────────────────────────────────────────────

  describe('healthCheck', () => {
    it('returns true when algorithm status is ACTIVE', async () => {
      await strategy.onInit({ status: AlgorithmStatus.ACTIVE, name: 'test' } as any);
      expect(await strategy.healthCheck()).toBe(true);
    });

    it('returns false when algorithm is not initialized', async () => {
      expect(await strategy.healthCheck()).toBe(false);
    });

    it('returns false when algorithm status is not ACTIVE', async () => {
      await strategy.onInit({ status: AlgorithmStatus.INACTIVE, name: 'test' } as any);
      expect(await strategy.healthCheck()).toBe(false);
    });
  });

  // ─── createErrorResult ────────────────────────────────────────────

  describe('createErrorResult', () => {
    it('produces well-formed error result with defaults', () => {
      const result = strategy.errorResult('something broke');
      expect(result).toMatchObject({
        success: false,
        signals: [],
        error: 'something broke',
        metrics: { executionTime: 0, signalsGenerated: 0, confidence: 0 }
      });
    });

    it('includes provided executionTime', () => {
      expect(strategy.errorResult('fail', 123).metrics?.executionTime).toBe(123);
    });
  });

  // ─── createSuccessResult ──────────────────────────────────────────

  describe('createSuccessResult', () => {
    it('computes average confidence across signals', () => {
      const signals = [makeSignal({ confidence: 0.6 }), makeSignal({ confidence: 0.8 })];
      const result = strategy.successResult(signals);
      expect(result.metrics?.confidence).toBeCloseTo(0.7);
      expect(result.metrics?.signalsGenerated).toBe(2);
    });

    it('sets confidence to 0 when no signals', () => {
      const result = strategy.successResult([]);
      expect(result.metrics?.confidence).toBe(0);
      expect(result.metrics?.signalsGenerated).toBe(0);
    });
  });

  // ─── getters (fallback behavior) ─────────────────────────────────

  describe('name/version/description getters', () => {
    it('falls back to constructor name when algorithm is not set', () => {
      expect(strategy.name).toBe('TestStrategy');
      expect(strategy.version).toBe('1.0.0');
      expect(strategy.description).toBe('');
    });

    it('uses algorithm values when initialized', async () => {
      await strategy.onInit({ name: 'My Algo', version: '2.0.0', description: 'desc' } as any);
      expect(strategy.name).toBe('My Algo');
      expect(strategy.version).toBe('2.0.0');
      expect(strategy.description).toBe('desc');
    });
  });

  // ─── default method returns ───────────────────────────────────────

  describe('default overridable methods', () => {
    it('getParameterConstraints returns empty array', () => {
      expect(strategy.getParameterConstraints()).toEqual([]);
    });

    it('getIndicatorRequirements returns empty array', () => {
      expect(strategy.getIndicatorRequirements({})).toEqual([]);
    });

    it('getMinDataPoints returns 0', () => {
      expect(strategy.getMinDataPoints({})).toBe(0);
    });
  });
});
