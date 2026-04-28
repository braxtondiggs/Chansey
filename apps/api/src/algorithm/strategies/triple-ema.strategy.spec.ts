import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, type TestingModule } from '@nestjs/testing';

import { TripleEMAStrategy } from './triple-ema.strategy';

import { IndicatorService } from '../indicators';
import { type AlgorithmContext, SignalType } from '../interfaces';

describe('TripleEMAStrategy', () => {
  let strategy: TripleEMAStrategy;
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
      calculateSD: jest.fn(),
      calculateADX: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TripleEMAStrategy,
        { provide: SchedulerRegistry, useValue: mockSchedulerRegistry },
        { provide: IndicatorService, useValue: mockIndicatorService }
      ]
    }).compile();

    strategy = module.get<TripleEMAStrategy>(TripleEMAStrategy);
    indicatorService = module.get(IndicatorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should generate BUY signal when EMAs align bullish (fast > medium > slow)', async () => {
      const prices = createMockPrices(70);

      // Create EMA arrays
      const fastEMA = Array(70).fill(NaN);
      const mediumEMA = Array(70).fill(NaN);
      const slowEMA = Array(70).fill(NaN);

      // Set up transition to bullish alignment
      for (let i = 55; i < 70; i++) {
        slowEMA[i] = 95;
        mediumEMA[i] = 98;
        fastEMA[i] = 100;
      }
      // Previous bar was not aligned
      fastEMA[68] = 97; // Was below medium
      mediumEMA[68] = 98;
      slowEMA[68] = 95;

      // Current bar is aligned (fast > medium > slow)
      fastEMA[69] = 102;
      mediumEMA[69] = 99;
      slowEMA[69] = 96;

      indicatorService.calculateEMA
        .mockResolvedValueOnce({
          values: fastEMA,
          validCount: 60,
          period: 8,
          fromCache: false
        })
        .mockResolvedValueOnce({
          values: mediumEMA,
          validCount: 50,
          period: 21,
          fromCache: false
        })
        .mockResolvedValueOnce({
          values: slowEMA,
          validCount: 15,
          period: 55,
          fromCache: false
        });

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { fastPeriod: 8, mediumPeriod: 21, slowPeriod: 55 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.BUY);
      expect(result.signals[0].reason).toContain('Triple EMA bullish alignment');
    });

    it('should generate SELL signal when EMAs align bearish (fast < medium < slow)', async () => {
      const prices = createMockPrices(70);

      const fastEMA = Array(70).fill(NaN);
      const mediumEMA = Array(70).fill(NaN);
      const slowEMA = Array(70).fill(NaN);

      // Set up transition to bearish alignment
      for (let i = 55; i < 70; i++) {
        slowEMA[i] = 105;
        mediumEMA[i] = 102;
        fastEMA[i] = 100;
      }
      // Previous bar was not aligned
      fastEMA[68] = 103; // Was above medium
      mediumEMA[68] = 102;
      slowEMA[68] = 105;

      // Current bar is bearish aligned (fast < medium < slow)
      fastEMA[69] = 98;
      mediumEMA[69] = 101;
      slowEMA[69] = 104;

      indicatorService.calculateEMA
        .mockResolvedValueOnce({
          values: fastEMA,
          validCount: 60,
          period: 8,
          fromCache: false
        })
        .mockResolvedValueOnce({
          values: mediumEMA,
          validCount: 50,
          period: 21,
          fromCache: false
        })
        .mockResolvedValueOnce({
          values: slowEMA,
          validCount: 15,
          period: 55,
          fromCache: false
        });

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { fastPeriod: 8, mediumPeriod: 21, slowPeriod: 55 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.SELL);
      expect(result.signals[0].reason).toContain('Triple EMA bearish alignment');
    });

    it('should block entry signal when EMA spread is below minSpread', async () => {
      const prices = createMockPrices(70);

      const fastEMA = Array(70).fill(NaN);
      const mediumEMA = Array(70).fill(NaN);
      const slowEMA = Array(70).fill(NaN);

      // Set up transition to bullish alignment but with tiny spread
      for (let i = 55; i < 70; i++) {
        slowEMA[i] = 100;
        mediumEMA[i] = 100.02;
        fastEMA[i] = 100.04; // Spread = 0.04% — below default minSpread of 0.1%
      }
      // Previous bar was not aligned
      fastEMA[68] = 99.98;
      mediumEMA[68] = 100.02;
      slowEMA[68] = 100;

      // Current bar is aligned but tiny spread
      fastEMA[69] = 100.04;
      mediumEMA[69] = 100.02;
      slowEMA[69] = 100;

      indicatorService.calculateEMA
        .mockResolvedValueOnce({ values: fastEMA, validCount: 60, period: 8, fromCache: false })
        .mockResolvedValueOnce({ values: mediumEMA, validCount: 50, period: 21, fromCache: false })
        .mockResolvedValueOnce({ values: slowEMA, validCount: 15, period: 55, fromCache: false });

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { fastPeriod: 8, mediumPeriod: 21, slowPeriod: 55 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      // Bullish entry blocked by minSpread, but breakdown signal (bullish→neutral won't fire
      // since previous was also not bullish in this setup — net result is no signals)
      expect(result.signals).toHaveLength(0);
    });

    it('should generate SELL breakdown signal when alignment transitions bullish → neutral', async () => {
      const prices = createMockPrices(70);

      const fastEMA = Array(70).fill(NaN);
      const mediumEMA = Array(70).fill(NaN);
      const slowEMA = Array(70).fill(NaN);

      for (let i = 55; i < 70; i++) {
        slowEMA[i] = 95;
        mediumEMA[i] = 98;
        fastEMA[i] = 101;
      }
      // Previous bar was bullish aligned (fast > medium > slow)
      fastEMA[68] = 101;
      mediumEMA[68] = 98;
      slowEMA[68] = 95;

      // Current bar: fast dropped below medium — alignment breaks to neutral
      fastEMA[69] = 97;
      mediumEMA[69] = 98;
      slowEMA[69] = 95;

      indicatorService.calculateEMA
        .mockResolvedValueOnce({ values: fastEMA, validCount: 60, period: 8, fromCache: false })
        .mockResolvedValueOnce({ values: mediumEMA, validCount: 50, period: 21, fromCache: false })
        .mockResolvedValueOnce({ values: slowEMA, validCount: 15, period: 55, fromCache: false });

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { fastPeriod: 8, mediumPeriod: 21, slowPeriod: 55 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.SELL);
      expect(result.signals[0].metadata?.alignmentType).toBe('breakdown');
      expect(result.signals[0].metadata?.previousAlignment).toBe('bullish');
      expect(result.signals[0].reason).toContain('Bullish alignment lost');
    });

    it('should generate BUY breakdown signal when alignment transitions bearish → neutral', async () => {
      const prices = createMockPrices(70);

      const fastEMA = Array(70).fill(NaN);
      const mediumEMA = Array(70).fill(NaN);
      const slowEMA = Array(70).fill(NaN);

      for (let i = 55; i < 70; i++) {
        slowEMA[i] = 105;
        mediumEMA[i] = 102;
        fastEMA[i] = 99;
      }
      // Previous bar was bearish aligned (fast < medium < slow)
      fastEMA[68] = 99;
      mediumEMA[68] = 102;
      slowEMA[68] = 105;

      // Current bar: fast rose above medium — alignment breaks to neutral
      fastEMA[69] = 103;
      mediumEMA[69] = 102;
      slowEMA[69] = 105;

      indicatorService.calculateEMA
        .mockResolvedValueOnce({ values: fastEMA, validCount: 60, period: 8, fromCache: false })
        .mockResolvedValueOnce({ values: mediumEMA, validCount: 50, period: 21, fromCache: false })
        .mockResolvedValueOnce({ values: slowEMA, validCount: 15, period: 55, fromCache: false });

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { fastPeriod: 8, mediumPeriod: 21, slowPeriod: 55 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.BUY);
      expect(result.signals[0].metadata?.alignmentType).toBe('breakdown');
      expect(result.signals[0].metadata?.previousAlignment).toBe('bearish');
      expect(result.signals[0].reason).toContain('Bearish alignment lost');
    });

    it('should bypass minSpread filter for breakdown signals', async () => {
      const prices = createMockPrices(70);

      const fastEMA = Array(70).fill(NaN);
      const mediumEMA = Array(70).fill(NaN);
      const slowEMA = Array(70).fill(NaN);

      for (let i = 55; i < 70; i++) {
        slowEMA[i] = 100;
        mediumEMA[i] = 100.05;
        fastEMA[i] = 100.1;
      }
      // Previous bar was bullish aligned
      fastEMA[68] = 100.1;
      mediumEMA[68] = 100.05;
      slowEMA[68] = 100;

      // Current bar: fast dropped below medium — tiny spread but breakdown should still fire
      fastEMA[69] = 100.03;
      mediumEMA[69] = 100.05;
      slowEMA[69] = 100;

      indicatorService.calculateEMA
        .mockResolvedValueOnce({ values: fastEMA, validCount: 60, period: 8, fromCache: false })
        .mockResolvedValueOnce({ values: mediumEMA, validCount: 50, period: 21, fromCache: false })
        .mockResolvedValueOnce({ values: slowEMA, validCount: 15, period: 55, fromCache: false });

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { fastPeriod: 8, mediumPeriod: 21, slowPeriod: 55, minSpread: 0.01 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.SELL);
      expect(result.signals[0].metadata?.alignmentType).toBe('breakdown');
    });

    it('should return no signals when EMAs are not aligned', async () => {
      const prices = createMockPrices(70);

      const fastEMA = Array(70).fill(NaN);
      const mediumEMA = Array(70).fill(NaN);
      const slowEMA = Array(70).fill(NaN);

      // Mixed alignment (not bullish or bearish)
      for (let i = 55; i < 70; i++) {
        fastEMA[i] = 100;
        mediumEMA[i] = 102; // Medium > fast
        slowEMA[i] = 98; // But slow < fast
      }

      indicatorService.calculateEMA
        .mockResolvedValueOnce({
          values: fastEMA,
          validCount: 60,
          period: 8,
          fromCache: false
        })
        .mockResolvedValueOnce({
          values: mediumEMA,
          validCount: 50,
          period: 21,
          fromCache: false
        })
        .mockResolvedValueOnce({
          values: slowEMA,
          validCount: 15,
          period: 55,
          fromCache: false
        });

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: {}
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });
  });

  describe('ADX gate', () => {
    const buildBullishAlignmentContext = (configOverrides: Record<string, unknown> = {}) => {
      const prices = createMockPrices(70);
      const fastEMA = Array(70).fill(NaN);
      const mediumEMA = Array(70).fill(NaN);
      const slowEMA = Array(70).fill(NaN);
      for (let i = 55; i < 70; i++) {
        slowEMA[i] = 95;
        mediumEMA[i] = 98;
        fastEMA[i] = 100;
      }
      fastEMA[68] = 97;
      mediumEMA[68] = 98;
      slowEMA[68] = 95;
      fastEMA[69] = 102;
      mediumEMA[69] = 99;
      slowEMA[69] = 96;

      indicatorService.calculateEMA
        .mockResolvedValueOnce({ values: fastEMA, validCount: 60, period: 8, fromCache: false })
        .mockResolvedValueOnce({ values: mediumEMA, validCount: 60, period: 21, fromCache: false })
        .mockResolvedValueOnce({ values: slowEMA, validCount: 60, period: 55, fromCache: false });

      return {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { minConfidence: 0, ...configOverrides }
      } as AlgorithmContext;
    };

    it('does not call calculateADX when minAdx defaults to 0', async () => {
      const result = await strategy.execute(buildBullishAlignmentContext());
      expect(result.success).toBe(true);
      expect(indicatorService.calculateADX).not.toHaveBeenCalled();
    });

    it('blocks signal when ADX is below threshold', async () => {
      indicatorService.calculateADX.mockResolvedValueOnce({
        values: [...Array(69).fill(NaN), 10],
        pdi: [...Array(69).fill(NaN), 18],
        mdi: [...Array(69).fill(NaN), 22],
        validCount: 1,
        period: 14,
        fromCache: false
      });
      const result = await strategy.execute(buildBullishAlignmentContext({ minAdx: 25 }));
      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
      expect(indicatorService.calculateADX).toHaveBeenCalledTimes(1);
    });

    it('passes signal when ADX is above threshold', async () => {
      indicatorService.calculateADX.mockResolvedValueOnce({
        values: [...Array(69).fill(NaN), 35],
        pdi: [...Array(69).fill(NaN), 30],
        mdi: [...Array(69).fill(NaN), 12],
        validCount: 1,
        period: 14,
        fromCache: false
      });
      const result = await strategy.execute(buildBullishAlignmentContext({ minAdx: 25 }));
      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.BUY);
    });
  });

  describe('ADX tiered gate (adxStrongMin)', () => {
    const setupBullishAlignmentContext = (adxValue: number, configOverrides: Record<string, unknown> = {}) => {
      const prices = createMockPrices(70);
      const fastEMA = Array(70).fill(NaN);
      const mediumEMA = Array(70).fill(NaN);
      const slowEMA = Array(70).fill(NaN);
      for (let i = 55; i < 70; i++) {
        slowEMA[i] = 95;
        mediumEMA[i] = 98;
        fastEMA[i] = 100;
      }
      fastEMA[68] = 97;
      mediumEMA[68] = 98;
      slowEMA[68] = 95;
      fastEMA[69] = 102;
      mediumEMA[69] = 99;
      slowEMA[69] = 96;

      indicatorService.calculateEMA
        .mockResolvedValueOnce({ values: fastEMA, validCount: 60, period: 8, fromCache: false })
        .mockResolvedValueOnce({ values: mediumEMA, validCount: 60, period: 21, fromCache: false })
        .mockResolvedValueOnce({ values: slowEMA, validCount: 60, period: 55, fromCache: false });

      indicatorService.calculateADX.mockResolvedValue({
        values: [...Array(69).fill(NaN), adxValue],
        pdi: [...Array(69).fill(NaN), 28],
        mdi: [...Array(69).fill(NaN), 12],
        validCount: 1,
        period: 14,
        fromCache: false
      });

      return {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { minConfidence: 0, ...configOverrides }
      } as AlgorithmContext;
    };

    it('preserves baseline strength when adxStrongMin defaults to 0', async () => {
      const baseline = await strategy.execute(setupBullishAlignmentContext(22, {})); // gate disabled
      jest.clearAllMocks();
      const result = await strategy.execute(setupBullishAlignmentContext(22, { minAdx: 20 }));
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].strength).toBeCloseTo(baseline.signals[0].strength, 5);
      expect(result.signals[0].metadata?.trendStrength).toBe('weak');
      expect(result.signals[0].metadata?.adx).toBe(22);
    });

    it('emits weak-tier signal at half strength when minAdx ≤ ADX < adxStrongMin', async () => {
      const baseline = await strategy.execute(setupBullishAlignmentContext(22, {}));
      jest.clearAllMocks();
      const result = await strategy.execute(
        setupBullishAlignmentContext(22, { minAdx: 20, adxStrongMin: 25, adxWeakMultiplier: 0.5 })
      );
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].strength).toBeCloseTo(baseline.signals[0].strength * 0.5, 5);
      expect(result.signals[0].metadata?.trendStrength).toBe('weak');
    });

    it('emits strong-tier signal at full strength when ADX ≥ adxStrongMin', async () => {
      const baseline = await strategy.execute(setupBullishAlignmentContext(30, {}));
      jest.clearAllMocks();
      const result = await strategy.execute(
        setupBullishAlignmentContext(30, { minAdx: 20, adxStrongMin: 25, adxWeakMultiplier: 0.5 })
      );
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].strength).toBeCloseTo(baseline.signals[0].strength, 5);
      expect(result.signals[0].metadata?.trendStrength).toBe('strong');
      expect(result.signals[0].metadata?.adx).toBe(30);
      expect(result.signals[0].metadata?.pdi).toBe(28);
      expect(result.signals[0].metadata?.mdi).toBe(12);
    });
  });
});
