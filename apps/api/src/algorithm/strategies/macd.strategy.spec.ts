import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, type TestingModule } from '@nestjs/testing';

import { MACDStrategy } from './macd.strategy';

import { IndicatorService } from '../indicators';
import { type AlgorithmContext, SignalType } from '../interfaces';

describe('MACDStrategy', () => {
  let strategy: MACDStrategy;
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
        MACDStrategy,
        { provide: SchedulerRegistry, useValue: mockSchedulerRegistry },
        { provide: IndicatorService, useValue: mockIndicatorService }
      ]
    }).compile();

    strategy = module.get<MACDStrategy>(MACDStrategy);
    indicatorService = module.get(IndicatorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const buildContext = (config: Record<string, any> = {}) =>
    ({
      coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
      priceData: { btc: createMockPrices(50) as any },
      timestamp: new Date(),
      config
    }) as AlgorithmContext;

  const mockMACD = (
    macdPrev: number,
    macdCurr: number,
    signalPrev: number,
    signalCurr: number,
    histogramPrev: number,
    histogramCurr: number
  ) => {
    const macdValues = Array(50).fill(NaN);
    const signalValues = Array(50).fill(NaN);
    const histogramValues = Array(50).fill(NaN);
    macdValues[48] = macdPrev;
    macdValues[49] = macdCurr;
    signalValues[48] = signalPrev;
    signalValues[49] = signalCurr;
    histogramValues[48] = histogramPrev;
    histogramValues[49] = histogramCurr;

    indicatorService.calculateMACD.mockResolvedValue({
      macd: macdValues,
      signal: signalValues,
      histogram: histogramValues,
      validCount: 15,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      fromCache: false
    });
  };

  describe('execute', () => {
    it.each([
      [
        'bullish crossover',
        SignalType.BUY,
        { macdPrev: -0.001, macdCurr: 0.002, signalPrev: 0.001, signalCurr: 0.001, histPrev: -0.002, histCurr: 0.001 }
      ],
      [
        'bearish crossover',
        SignalType.SELL,
        { macdPrev: 0.002, macdCurr: -0.001, signalPrev: 0.001, signalCurr: 0.001, histPrev: 0.001, histCurr: -0.002 }
      ]
    ])('should generate %s signal on crossover', async (_label, expectedType, macd) => {
      mockMACD(macd.macdPrev, macd.macdCurr, macd.signalPrev, macd.signalCurr, macd.histPrev, macd.histCurr);

      const result = await strategy.execute(buildContext({ minConfidence: 0.0001, useHistogramConfirmation: false }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(expectedType);
      expect(result.signals[0].reason).toBeDefined();
    });

    it('should return no signals when no crossover occurs', async () => {
      mockMACD(0.002, 0.003, 0.001, 0.001, 0.001, 0.002);

      const result = await strategy.execute(buildContext());

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('should produce valid strength (not NaN) when all histogram values are zero', async () => {
      const macdValues = Array(50).fill(NaN);
      const signalValues = Array(50).fill(NaN);
      const histogramValues = Array(50).fill(0);
      // Set up a bullish crossover via MACD/signal, but keep histogram all-zero
      // so avgMagnitude is exactly 0 and the division guard fires
      macdValues[48] = -0.001;
      macdValues[49] = 0.002;
      signalValues[48] = 0.001;
      signalValues[49] = 0.001;

      indicatorService.calculateMACD.mockResolvedValue({
        macd: macdValues,
        signal: signalValues,
        histogram: histogramValues,
        validCount: 15,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        fromCache: false
      });

      const result = await strategy.execute(buildContext({ minConfidence: 0, useHistogramConfirmation: false }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].strength).not.toBeNaN();
      expect(result.signals[0].strength).toBe(0.3);
    });

    it('should respect explicit zero config values (not override with defaults)', async () => {
      mockMACD(-0.001, 0.002, 0.001, 0.001, -0.002, 0.001);

      const result = await strategy.execute(
        buildContext({ minHistogramStrength: 0, minConfidence: 0, useHistogramConfirmation: false })
      );

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
    });
  });

  describe('ADX tiered gate', () => {
    /** Build a fresh bullish crossover with controllable ADX value. */
    const setupBullishCrossover = (adxValue: number, configOverrides: Record<string, unknown> = {}) => {
      mockMACD(-0.001, 0.002, 0.001, 0.001, -0.002, 0.001);
      indicatorService.calculateADX.mockResolvedValueOnce({
        values: [...Array(49).fill(NaN), adxValue],
        pdi: [...Array(49).fill(NaN), 28],
        mdi: [...Array(49).fill(NaN), 12],
        validCount: 1,
        period: 14,
        fromCache: false
      });
      return buildContext({ minConfidence: 0.0001, useHistogramConfirmation: false, ...configOverrides });
    };

    it('does not call calculateADX when minAdx defaults to 0', async () => {
      mockMACD(-0.001, 0.002, 0.001, 0.001, -0.002, 0.001);
      const result = await strategy.execute(buildContext({ minConfidence: 0.0001, useHistogramConfirmation: false }));
      expect(result.signals).toHaveLength(1);
      expect(indicatorService.calculateADX).not.toHaveBeenCalled();
    });

    it('blocks signal when ADX is below minAdx', async () => {
      const ctx = setupBullishCrossover(15, { minAdx: 25 });
      const result = await strategy.execute(ctx);
      expect(result.signals).toHaveLength(0);
    });

    it('emits weak-tier signal at half strength when minAdx ≤ ADX < adxStrongMin', async () => {
      // Baseline (gate disabled)
      mockMACD(-0.001, 0.002, 0.001, 0.001, -0.002, 0.001);
      const baseline = await strategy.execute(buildContext({ minConfidence: 0.0001, useHistogramConfirmation: false }));
      jest.clearAllMocks();

      const ctx = setupBullishCrossover(22, {
        minAdx: 20,
        adxStrongMin: 25,
        adxWeakMultiplier: 0.5
      });
      const result = await strategy.execute(ctx);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].strength).toBeCloseTo(baseline.signals[0].strength * 0.5, 5);
      expect(result.signals[0].metadata?.trendStrength).toBe('weak');
    });

    it('emits strong-tier signal at full strength when ADX ≥ adxStrongMin', async () => {
      mockMACD(-0.001, 0.002, 0.001, 0.001, -0.002, 0.001);
      const baseline = await strategy.execute(buildContext({ minConfidence: 0.0001, useHistogramConfirmation: false }));
      jest.clearAllMocks();

      const ctx = setupBullishCrossover(30, {
        minAdx: 20,
        adxStrongMin: 25,
        adxWeakMultiplier: 0.5
      });
      const result = await strategy.execute(ctx);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].strength).toBeCloseTo(baseline.signals[0].strength, 5);
      expect(result.signals[0].metadata?.trendStrength).toBe('strong');
      expect(result.signals[0].metadata?.adx).toBe(30);
      expect(result.signals[0].metadata?.pdi).toBe(28);
      expect(result.signals[0].metadata?.mdi).toBe(12);
    });
  });

  describe('canExecute', () => {
    it('should return true with sufficient data', () => {
      const context = buildContext();
      expect(strategy.canExecute(context)).toBe(true);
    });

    it('should return false with insufficient data', () => {
      const context = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: createMockPrices(10) as any },
        timestamp: new Date(),
        config: {}
      } as AlgorithmContext;

      expect(strategy.canExecute(context)).toBe(false);
    });

    it('should return true when at least one coin has sufficient data (ANY semantics)', () => {
      const context = {
        coins: [
          { id: 'btc', symbol: 'BTC', name: 'Bitcoin' },
          { id: 'eth', symbol: 'ETH', name: 'Ethereum' }
        ] as any,
        priceData: {
          btc: createMockPrices(50) as any,
          eth: createMockPrices(5) as any
        },
        timestamp: new Date(),
        config: {}
      } as AlgorithmContext;

      expect(strategy.canExecute(context)).toBe(true);
    });

    it('should return false when no coins have sufficient data', () => {
      const context = {
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
      } as AlgorithmContext;

      expect(strategy.canExecute(context)).toBe(false);
    });
  });
});
