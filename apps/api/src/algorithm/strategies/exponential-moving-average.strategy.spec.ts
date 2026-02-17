import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { ExponentialMovingAverageStrategy } from './exponential-moving-average.strategy';

import { IndicatorService } from '../indicators';
import { AlgorithmContext, SignalType } from '../interfaces';

describe('ExponentialMovingAverageStrategy', () => {
  let strategy: ExponentialMovingAverageStrategy;
  let indicatorService: jest.Mocked<IndicatorService>;

  const mockSchedulerRegistry = {
    addCronJob: jest.fn(),
    deleteCronJob: jest.fn(),
    doesExist: jest.fn().mockReturnValue(false)
  };

  const createMockPrices = (count: number, basePrice = 100, lastPrice = basePrice) => {
    const prices = Array.from({ length: count }, (_, i) => ({
      id: `price-${i}`,
      avg: basePrice + Math.sin(i / 5) * 10,
      high: basePrice + Math.sin(i / 5) * 10 + 5,
      low: basePrice + Math.sin(i / 5) * 10 - 5,
      date: new Date(Date.now() - (count - i) * 24 * 60 * 60 * 1000),
      coin: { id: 'btc', symbol: 'BTC' }
    }));
    prices[count - 1].avg = lastPrice;
    return prices;
  };

  beforeEach(async () => {
    const mockIndicatorService = {
      calculateRSI: jest.fn(),
      calculateEMA: jest.fn(),
      calculateSMA: jest.fn(),
      calculateMACD: jest.fn(),
      calculateBollingerBands: jest.fn(),
      calculateATR: jest.fn(),
      calculateSD: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExponentialMovingAverageStrategy,
        { provide: SchedulerRegistry, useValue: mockSchedulerRegistry },
        { provide: IndicatorService, useValue: mockIndicatorService }
      ]
    }).compile();

    strategy = module.get<ExponentialMovingAverageStrategy>(ExponentialMovingAverageStrategy);
    indicatorService = module.get(IndicatorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const buildContext = (prices: any[], config: Record<string, any> = {}) =>
    ({
      coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
      priceData: { btc: prices as any },
      timestamp: new Date(),
      config
    }) as AlgorithmContext;

  const mockEmaValues = (fast: number[], slow: number[], fastPeriod = 12, slowPeriod = 26) => {
    indicatorService.calculateEMA
      .mockResolvedValueOnce({
        values: fast,
        validCount: fast.filter((v) => !isNaN(v)).length,
        period: fastPeriod,
        fromCache: false
      })
      .mockResolvedValueOnce({
        values: slow,
        validCount: slow.filter((v) => !isNaN(v)).length,
        period: slowPeriod,
        fromCache: false
      });
  };

  describe('execute', () => {
    it.each([
      ['bullish crossover', SignalType.BUY, { prevFast: 10, prevSlow: 11, currFast: 12, currSlow: 11 }],
      ['bearish crossover', SignalType.SELL, { prevFast: 11, prevSlow: 10, currFast: 9, currSlow: 10 }]
    ])('should generate %s signal', async (_label, expectedType, values) => {
      const prices = createMockPrices(30, 100, 105);
      const fast = Array(30).fill(NaN);
      const slow = Array(30).fill(NaN);

      fast[28] = values.prevFast;
      slow[28] = values.prevSlow;
      fast[29] = values.currFast;
      slow[29] = values.currSlow;

      mockEmaValues(fast, slow);

      const result = await strategy.execute(buildContext(prices));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(expectedType);
      expect(result.signals[0].reason).toContain('EMA crossover');
      expect(result.signals[0].coinId).toBe('btc');
      expect(result.signals[0].price).toBe(105);
    });

    it('should return no signals when no crossover occurs', async () => {
      const prices = createMockPrices(30, 100, 101);
      const fast = Array(30).fill(NaN);
      const slow = Array(30).fill(NaN);

      fast[28] = 12;
      slow[28] = 10;
      fast[29] = 13;
      slow[29] = 11;

      mockEmaValues(fast, slow);

      const result = await strategy.execute(buildContext(prices));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });

    it('should return error result when indicator service throws', async () => {
      const prices = createMockPrices(30, 100, 105);
      indicatorService.calculateEMA.mockRejectedValueOnce(new Error('Redis connection failed'));

      const result = await strategy.execute(buildContext(prices));

      expect(result.success).toBe(false);
      expect(result.error).toContain('Redis connection failed');
      expect(result.signals).toHaveLength(0);
    });

    it('should return no signal when EMA values are NaN at last index', async () => {
      const prices = createMockPrices(30, 100, 105);
      const fast = Array(30).fill(NaN);
      const slow = Array(30).fill(NaN);

      // Only populate earlier bars, leave last index as NaN
      fast[27] = 10;
      slow[27] = 11;
      fast[28] = 12;
      slow[28] = 11;

      mockEmaValues(fast, slow);

      const result = await strategy.execute(buildContext(prices));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });

    it('should skip coins with insufficient data', async () => {
      const prices = createMockPrices(10);

      const result = await strategy.execute(buildContext(prices));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
      expect(indicatorService.calculateEMA).not.toHaveBeenCalled();
    });
  });

  describe('signal strength and confidence edge cases', () => {
    it('should produce valid strength when EMAs are identical at crossover boundary', async () => {
      const prices = createMockPrices(30, 50, 50);
      const fast = Array(30).fill(NaN);
      const slow = Array(30).fill(NaN);

      // Exact equality on previous bar, then crossover
      fast[28] = 50;
      slow[28] = 50;
      fast[29] = 50.01;
      slow[29] = 50;

      mockEmaValues(fast, slow);

      const result = await strategy.execute(buildContext(prices));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].strength).toBeGreaterThanOrEqual(0);
      expect(result.signals[0].strength).toBeLessThanOrEqual(1);
      expect(isNaN(result.signals[0].strength)).toBe(false);
    });

    it('should produce confidence > 0 when EMAs were converging before bullish crossover', async () => {
      const prices = createMockPrices(30, 100, 105);
      const fast = Array(30).fill(NaN);
      const slow = Array(30).fill(NaN);

      // Simulate converging EMAs leading to crossover
      // Gap narrowing: -3, -2, -1, -0.5, then crossover
      fast[25] = 97;
      slow[25] = 100; // gap = -3
      fast[26] = 98;
      slow[26] = 100; // gap = -2 (increasing toward 0)
      fast[27] = 99;
      slow[27] = 100; // gap = -1
      fast[28] = 99.5;
      slow[28] = 100; // gap = -0.5
      fast[29] = 101;
      slow[29] = 100; // gap = +1, crossover

      mockEmaValues(fast, slow);

      const result = await strategy.execute(buildContext(prices));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].confidence).toBeGreaterThan(0);
      expect(isNaN(result.signals[0].confidence)).toBe(false);
    });

    it('should never produce NaN for strength or confidence', async () => {
      const prices = createMockPrices(30, 100, 100);
      const fast = Array(30).fill(NaN);
      const slow = Array(30).fill(NaN);

      // Bearish crossover with zero-ish values
      fast[28] = 0.0001;
      slow[28] = 0.00005;
      fast[29] = 0.00004;
      slow[29] = 0.00005;

      mockEmaValues(fast, slow);

      const result = await strategy.execute(buildContext(prices));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);

      const signal = result.signals[0];
      expect(isNaN(signal.strength)).toBe(false);
      expect(isNaN(signal.confidence)).toBe(false);
      expect(signal.strength).toBeGreaterThanOrEqual(0);
      expect(signal.strength).toBeLessThanOrEqual(1);
      expect(signal.confidence).toBeGreaterThanOrEqual(0);
      expect(signal.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('crossover lookback window', () => {
    it('should detect crossover 2 bars ago with default lookback=3', async () => {
      const prices = createMockPrices(30, 100, 105);
      const fast = Array(30).fill(NaN);
      const slow = Array(30).fill(NaN);

      // Crossover happened 2 bars ago (index 27→28), not at the last bar
      fast[26] = 10;
      slow[26] = 11; // fast < slow
      fast[27] = 12;
      slow[27] = 11; // fast > slow → bullish crossover
      fast[28] = 13;
      slow[28] = 12; // still bullish, no new crossover
      fast[29] = 14;
      slow[29] = 13; // still bullish

      mockEmaValues(fast, slow);

      const result = await strategy.execute(buildContext(prices, { crossoverLookback: 3 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.BUY);
      expect(result.signals[0].metadata?.crossoverBarsAgo).toBe(2);
    });

    it('should NOT detect crossover outside the lookback window', async () => {
      const prices = createMockPrices(30, 100, 105);
      const fast = Array(30).fill(NaN);
      const slow = Array(30).fill(NaN);

      // Crossover happened 3 bars ago (index 26→27), lookback=2 only checks bars 29 and 28
      fast[25] = 10;
      slow[25] = 11;
      fast[26] = 12;
      slow[26] = 11; // crossover at index 26
      fast[27] = 13;
      slow[27] = 12;
      fast[28] = 14;
      slow[28] = 13;
      fast[29] = 15;
      slow[29] = 14;

      mockEmaValues(fast, slow);

      const result = await strategy.execute(buildContext(prices, { crossoverLookback: 2 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });

    it('should be backward-compatible with crossoverLookback=1 (single-bar check)', async () => {
      const prices = createMockPrices(30, 100, 105);
      const fast = Array(30).fill(NaN);
      const slow = Array(30).fill(NaN);

      // Crossover at the last bar only
      fast[28] = 10;
      slow[28] = 11;
      fast[29] = 12;
      slow[29] = 11;

      mockEmaValues(fast, slow);

      const result = await strategy.execute(buildContext(prices, { crossoverLookback: 1 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.BUY);
      expect(result.signals[0].metadata?.crossoverBarsAgo).toBe(0);
    });

    it('should prioritize most recent crossover when multiple exist in window', async () => {
      const prices = createMockPrices(30, 100, 90);
      const fast = Array(30).fill(NaN);
      const slow = Array(30).fill(NaN);

      // Bullish crossover at bar 27 (2 bars ago)
      fast[26] = 10;
      slow[26] = 11;
      fast[27] = 12;
      slow[27] = 11;
      // Bearish crossover at bar 29 (most recent, 0 bars ago)
      fast[28] = 11;
      slow[28] = 10;
      fast[29] = 9;
      slow[29] = 10;

      mockEmaValues(fast, slow);

      const result = await strategy.execute(buildContext(prices, { crossoverLookback: 3 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      // Most recent (bearish at bar 29) should win
      expect(result.signals[0].type).toBe(SignalType.SELL);
      expect(result.signals[0].metadata?.crossoverBarsAgo).toBe(0);
    });
  });

  describe('canExecute', () => {
    it('should return true with sufficient data', () => {
      const prices = createMockPrices(30);
      expect(strategy.canExecute(buildContext(prices))).toBe(true);
    });

    it('should return false with insufficient data', () => {
      const prices = createMockPrices(10);
      expect(strategy.canExecute(buildContext(prices))).toBe(false);
    });

    it('should return true when at least one coin has sufficient data (ANY semantics)', () => {
      const context: AlgorithmContext = {
        coins: [
          { id: 'btc', symbol: 'BTC', name: 'Bitcoin' },
          { id: 'eth', symbol: 'ETH', name: 'Ethereum' }
        ] as any,
        priceData: {
          btc: createMockPrices(30) as any,
          eth: createMockPrices(5) as any
        },
        timestamp: new Date(),
        config: {}
      };

      expect(strategy.canExecute(context)).toBe(true);
    });

    it('should return false when no coins have sufficient data', () => {
      const context: AlgorithmContext = {
        coins: [
          { id: 'btc', symbol: 'BTC', name: 'Bitcoin' },
          { id: 'eth', symbol: 'ETH', name: 'Ethereum' }
        ] as any,
        priceData: {
          btc: createMockPrices(5) as any,
          eth: createMockPrices(3) as any
        },
        timestamp: new Date(),
        config: {}
      };

      expect(strategy.canExecute(context)).toBe(false);
    });
  });
});
