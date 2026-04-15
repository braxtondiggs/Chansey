import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, type TestingModule } from '@nestjs/testing';

import { SimpleMovingAverageCrossoverStrategy } from './simple-moving-average-crossover.strategy';

import { IndicatorService } from '../indicators';
import { type AlgorithmContext, SignalType } from '../interfaces';

describe('SimpleMovingAverageCrossoverStrategy', () => {
  let strategy: SimpleMovingAverageCrossoverStrategy;
  let indicatorService: jest.Mocked<IndicatorService>;

  const mockSchedulerRegistry = {
    addCronJob: jest.fn(),
    deleteCronJob: jest.fn(),
    doesExist: jest.fn().mockReturnValue(false)
  };

  const createMockPrices = (count: number, basePrice = 100) => {
    return Array.from({ length: count }, (_, i) => ({
      id: `price-${i}`,
      avg: basePrice + Math.sin(i / 5) * 10,
      high: basePrice + Math.sin(i / 5) * 10 + 5,
      low: basePrice + Math.sin(i / 5) * 10 - 5,
      date: new Date(Date.now() - (count - i) * 24 * 60 * 60 * 1000),
      coin: { id: 'btc', symbol: 'BTC' }
    }));
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
        SimpleMovingAverageCrossoverStrategy,
        { provide: SchedulerRegistry, useValue: mockSchedulerRegistry },
        { provide: IndicatorService, useValue: mockIndicatorService }
      ]
    }).compile();

    strategy = module.get<SimpleMovingAverageCrossoverStrategy>(SimpleMovingAverageCrossoverStrategy);
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

  const mockSmaValues = (fast: number[], slow: number[], fastPeriod = 10, slowPeriod = 20) => {
    indicatorService.calculateSMA
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
      ['golden cross -> BUY', SignalType.BUY, { prevFast: 10, prevSlow: 11, currFast: 12, currSlow: 11 }],
      ['death cross -> SELL', SignalType.SELL, { prevFast: 11, prevSlow: 10, currFast: 9, currSlow: 10 }]
    ])('should generate %s signal', async (_label, expectedType, values) => {
      const prices = createMockPrices(30);
      const fast = Array(30).fill(NaN);
      const slow = Array(30).fill(NaN);

      fast[28] = values.prevFast;
      slow[28] = values.prevSlow;
      fast[29] = values.currFast;
      slow[29] = values.currSlow;

      mockSmaValues(fast, slow);

      const result = await strategy.execute(buildContext(prices, { fastPeriod: 10, slowPeriod: 20 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(expectedType);
      expect(result.signals[0].reason).toBeDefined();
    });

    it('should return no signals when no crossover occurs', async () => {
      const prices = createMockPrices(30);
      const fast = Array(30).fill(NaN);
      const slow = Array(30).fill(NaN);

      fast[28] = 12;
      slow[28] = 10;
      fast[29] = 13;
      slow[29] = 11;

      mockSmaValues(fast, slow);

      const result = await strategy.execute(buildContext(prices, { fastPeriod: 10, slowPeriod: 20 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });

    it('should skip coins with insufficient data', async () => {
      const prices = createMockPrices(10);

      const result = await strategy.execute(buildContext(prices, { slowPeriod: 20 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
      expect(indicatorService.calculateSMA).not.toHaveBeenCalled();
    });

    it('should skip coins with exactly slowPeriod data points (needs slowPeriod + 1)', async () => {
      const prices = createMockPrices(20);

      const result = await strategy.execute(buildContext(prices, { slowPeriod: 20 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
      expect(indicatorService.calculateSMA).not.toHaveBeenCalled();
    });

    it('should return null when previous SMA values are NaN', async () => {
      const prices = createMockPrices(30);
      const fast = Array(30).fill(NaN);
      const slow = Array(30).fill(NaN);

      // Current values are valid but previous values are NaN
      fast[29] = 12;
      slow[29] = 11;
      // fast[28] and slow[28] remain NaN

      mockSmaValues(fast, slow);

      const result = await strategy.execute(buildContext(prices, { fastPeriod: 10, slowPeriod: 20 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });

    it('should filter signals below minConfidence threshold', async () => {
      const prices = createMockPrices(30);
      const fast = Array(30).fill(NaN);
      const slow = Array(30).fill(NaN);

      // Golden cross with significant separation
      fast[28] = 10;
      slow[28] = 11;
      fast[29] = 12;
      slow[29] = 11;

      mockSmaValues(fast, slow);

      // Dynamic confidence for separation=1/11≈0.09 → confidence≈0.4+0.9+0.1=1.0 (capped)
      // Set threshold impossibly high
      const result = await strategy.execute(
        buildContext(prices, { fastPeriod: 10, slowPeriod: 20, minConfidence: 1.1 })
      );

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });

    it('should include signals meeting minConfidence threshold', async () => {
      const prices = createMockPrices(30);
      const fast = Array(30).fill(NaN);
      const slow = Array(30).fill(NaN);

      // Golden cross pattern with good separation
      fast[28] = 10;
      slow[28] = 11;
      fast[29] = 12;
      slow[29] = 11;

      mockSmaValues(fast, slow);

      const result = await strategy.execute(
        buildContext(prices, { fastPeriod: 10, slowPeriod: 20, minConfidence: 0.4 })
      );

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.BUY);
    });

    it('should block noise crosses below minSeparation', async () => {
      const prices = createMockPrices(30);
      const fast = Array(30).fill(NaN);
      const slow = Array(30).fill(NaN);

      // Tiny crossover: separation = |100.01-100|/100 = 0.0001 < 0.005
      fast[28] = 99.99;
      slow[28] = 100;
      fast[29] = 100.01;
      slow[29] = 100;

      mockSmaValues(fast, slow);

      const result = await strategy.execute(buildContext(prices, { fastPeriod: 10, slowPeriod: 20, minConfidence: 0 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });

    it('should produce dynamic strength that scales with separation', async () => {
      const prices = createMockPrices(30);

      // Small separation cross
      const fastSmall = Array(30).fill(NaN);
      const slowSmall = Array(30).fill(NaN);
      fastSmall[28] = 99;
      slowSmall[28] = 100;
      fastSmall[29] = 101;
      slowSmall[29] = 100;
      mockSmaValues(fastSmall, slowSmall);
      const smallResult = await strategy.execute(
        buildContext(prices, { fastPeriod: 10, slowPeriod: 20, minConfidence: 0 })
      );

      // Large separation cross
      const fastLarge = Array(30).fill(NaN);
      const slowLarge = Array(30).fill(NaN);
      fastLarge[28] = 95;
      slowLarge[28] = 100;
      fastLarge[29] = 105;
      slowLarge[29] = 100;
      mockSmaValues(fastLarge, slowLarge);
      const largeResult = await strategy.execute(
        buildContext(prices, { fastPeriod: 10, slowPeriod: 20, minConfidence: 0 })
      );

      expect(smallResult.signals).toHaveLength(1);
      expect(largeResult.signals).toHaveLength(1);
      expect(largeResult.signals[0].strength).toBeGreaterThan(smallResult.signals[0].strength);
    });
  });

  describe('canExecute', () => {
    it('should return true with sufficient data', () => {
      const prices = createMockPrices(30);
      expect(strategy.canExecute(buildContext(prices, { slowPeriod: 20 }))).toBe(true);
    });

    it('should return false with insufficient data', () => {
      const prices = createMockPrices(10);
      expect(strategy.canExecute(buildContext(prices, { slowPeriod: 20 }))).toBe(false);
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
        config: { slowPeriod: 20 }
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
        config: { slowPeriod: 20 }
      };

      expect(strategy.canExecute(context)).toBe(false);
    });
  });
});
