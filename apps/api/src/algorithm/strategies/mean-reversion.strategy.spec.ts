import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { MeanReversionStrategy } from './mean-reversion.strategy';

import { IndicatorService } from '../indicators';
import { AlgorithmContext, SignalType } from '../interfaces';

describe('MeanReversionStrategy', () => {
  let strategy: MeanReversionStrategy;
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
        MeanReversionStrategy,
        { provide: SchedulerRegistry, useValue: mockSchedulerRegistry },
        { provide: IndicatorService, useValue: mockIndicatorService }
      ]
    }).compile();

    strategy = module.get<MeanReversionStrategy>(MeanReversionStrategy);
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

  /**
   * Mock only calculateBollingerBands — SMA and SD are now derived from BB result.
   */
  const mockIndicators = (movingAverage: number[], standardDeviation: number[], threshold = 2) => {
    const upper = movingAverage.map((ma, i) =>
      isNaN(ma) || isNaN(standardDeviation[i]) ? NaN : ma + standardDeviation[i] * threshold
    );
    const lower = movingAverage.map((ma, i) =>
      isNaN(ma) || isNaN(standardDeviation[i]) ? NaN : ma - standardDeviation[i] * threshold
    );

    indicatorService.calculateBollingerBands.mockResolvedValue({
      upper,
      middle: movingAverage,
      lower,
      pb: Array(movingAverage.length).fill(NaN),
      bandwidth: Array(movingAverage.length).fill(NaN),
      validCount: 20,
      period: 20,
      stdDev: threshold,
      fromCache: false
    });
  };

  describe('execute', () => {
    it.each([
      ['oversold -> BUY', SignalType.BUY, { price: 90, ma: 100, sd: 2, threshold: 2 }],
      ['overbought -> SELL', SignalType.SELL, { price: 110, ma: 100, sd: 2, threshold: 2 }]
    ])('should generate %s signal', async (_label, expectedType, cfg) => {
      const prices = createMockPrices(30, 100, cfg.price);
      const movingAverage = Array(30).fill(NaN);
      const standardDeviation = Array(30).fill(NaN);

      movingAverage[29] = cfg.ma;
      standardDeviation[29] = cfg.sd;

      mockIndicators(movingAverage, standardDeviation, cfg.threshold);

      const result = await strategy.execute(buildContext(prices, { period: 20, threshold: cfg.threshold }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(expectedType);
    });

    it('should return no signals when within threshold', async () => {
      const prices = createMockPrices(30, 100, 101);
      const movingAverage = Array(30).fill(NaN);
      const standardDeviation = Array(30).fill(NaN);

      movingAverage[29] = 100;
      standardDeviation[29] = 5;

      mockIndicators(movingAverage, standardDeviation);

      const result = await strategy.execute(buildContext(prices, { period: 20, threshold: 2 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });

    it('should return no signal when standard deviation is zero', async () => {
      const prices = createMockPrices(30, 100, 100);
      const movingAverage = Array(30).fill(NaN);
      const standardDeviation = Array(30).fill(NaN);

      // Flat price: MA = price, SD = 0
      movingAverage[29] = 100;
      standardDeviation[29] = 0;

      mockIndicators(movingAverage, standardDeviation);

      const result = await strategy.execute(buildContext(prices, { period: 20, threshold: 2 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);

      // Chart z-score should be NaN, not Infinity
      const chartData = result.chartData?.['btc'];
      expect(chartData).toBeDefined();
      const lastPoint = chartData![chartData!.length - 1];
      expect(lastPoint.metadata!['zScore']).toBeNaN();
    });

    it('should skip coins with insufficient data', async () => {
      const prices = createMockPrices(5);

      const result = await strategy.execute(buildContext(prices, { period: 20, threshold: 2 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
      expect(indicatorService.calculateBollingerBands).not.toHaveBeenCalled();
    });
  });

  describe('canExecute', () => {
    it('should return true with sufficient data', () => {
      const prices = createMockPrices(25);
      expect(strategy.canExecute(buildContext(prices, { period: 20 }))).toBe(true);
    });

    it('should return false with insufficient data', () => {
      const prices = createMockPrices(10);
      expect(strategy.canExecute(buildContext(prices, { period: 20 }))).toBe(false);
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
        config: { period: 20 }
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
        config: { period: 20 }
      };

      expect(strategy.canExecute(context)).toBe(false);
    });
  });
});
