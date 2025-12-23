import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { ConfluenceStrategy } from './confluence.strategy';

import { IndicatorService } from '../indicators';
import { AlgorithmContext, SignalType } from '../interfaces';

describe('ConfluenceStrategy', () => {
  let strategy: ConfluenceStrategy;
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
        ConfluenceStrategy,
        { provide: SchedulerRegistry, useValue: mockSchedulerRegistry },
        { provide: IndicatorService, useValue: mockIndicatorService }
      ]
    }).compile();

    strategy = module.get<ConfluenceStrategy>(ConfluenceStrategy);
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

  // Helper to mock EMA values (fast and slow)
  const mockEMA = (fast12: number, slow26: number, prevFast?: number, prevSlow?: number) => {
    const ema12Values = Array(50).fill(NaN);
    const ema26Values = Array(50).fill(NaN);
    ema12Values[49] = fast12;
    ema26Values[49] = slow26;
    if (prevFast !== undefined) ema12Values[48] = prevFast;
    if (prevSlow !== undefined) ema26Values[48] = prevSlow;

    indicatorService.calculateEMA.mockImplementation(async (options) => {
      const period = options.period;
      return {
        values: period === 12 ? ema12Values : ema26Values,
        validCount: 25,
        period,
        fromCache: false
      };
    });
  };

  // Helper to mock RSI values
  const mockRSI = (latest: number) => {
    const rsiValues = Array(50).fill(NaN);
    rsiValues[49] = latest;
    rsiValues[48] = latest + 5;
    indicatorService.calculateRSI.mockResolvedValue({
      values: rsiValues,
      validCount: 15,
      period: 14,
      fromCache: false
    });
  };

  // Helper to mock MACD values
  const mockMACD = (histogram: number, momentum = 0) => {
    const macdValues = Array(50).fill(NaN);
    const signalValues = Array(50).fill(NaN);
    const histogramValues = Array(50).fill(NaN);
    macdValues[49] = histogram > 0 ? 0.002 : -0.002;
    signalValues[49] = 0.001;
    histogramValues[49] = histogram;
    histogramValues[48] = histogram - momentum; // For momentum calculation

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

  // Helper to mock ATR values
  const mockATR = (current: number, average: number) => {
    const atrValues = Array(50).fill(average);
    atrValues[49] = current;
    indicatorService.calculateATR.mockResolvedValue({
      values: atrValues,
      validCount: 15,
      period: 14,
      fromCache: false
    });
  };

  // Helper to mock Bollinger Bands values
  const mockBollingerBands = (percentB: number) => {
    const pbValues = Array(50).fill(0.5);
    pbValues[49] = percentB;
    const bandwidthValues = Array(50).fill(0.05);
    indicatorService.calculateBollingerBands.mockResolvedValue({
      upper: Array(50).fill(110),
      middle: Array(50).fill(100),
      lower: Array(50).fill(90),
      pb: pbValues,
      bandwidth: bandwidthValues,
      validCount: 30,
      period: 20,
      stdDev: 2,
      fromCache: false
    });
  };

  // Setup all indicators for bullish scenario
  const setupBullishIndicators = () => {
    mockEMA(105, 100, 99, 100); // EMA12 > EMA26 (bullish trend)
    mockRSI(35); // RSI < 40 (bullish momentum)
    mockMACD(0.002, 0.001); // Positive histogram with upward momentum
    mockATR(1.0, 1.0); // Normal volatility
    mockBollingerBands(0.15); // %B < 0.2 (bullish mean reversion)
  };

  // Setup all indicators for bearish scenario
  const setupBearishIndicators = () => {
    mockEMA(95, 100, 101, 100); // EMA12 < EMA26 (bearish trend)
    mockRSI(65); // RSI > 60 (bearish momentum)
    mockMACD(-0.002, -0.001); // Negative histogram with downward momentum
    mockATR(1.0, 1.0); // Normal volatility
    mockBollingerBands(0.85); // %B > 0.8 (bearish mean reversion)
  };

  describe('strategy properties', () => {
    it('should have correct id', () => {
      expect(strategy.id).toBe('confluence-001');
    });

    it('should have correct name', () => {
      expect(strategy.name).toBeDefined();
    });

    it('should have correct version', () => {
      expect(strategy.version).toBeDefined();
    });
  });

  describe('execute - signal generation', () => {
    it('should generate BUY signal when all 5 indicators agree bullish', async () => {
      setupBullishIndicators();

      const result = await strategy.execute(buildContext({ minConfluence: 3 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.BUY);
      expect(result.signals[0].reason).toContain('Confluence BUY');
      expect(result.signals[0].metadata?.confluenceCount).toBeGreaterThanOrEqual(3);
    });

    it('should generate SELL signal when all 5 indicators agree bearish', async () => {
      setupBearishIndicators();

      const result = await strategy.execute(buildContext({ minConfluence: 3 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.SELL);
      expect(result.signals[0].reason).toContain('Confluence SELL');
    });

    it('should return no signals when only 2 indicators agree (minConfluence=3)', async () => {
      // Disable ATR so it doesn't add to confluence count as neutral
      mockEMA(105, 100); // Bullish
      mockRSI(35); // Bullish
      mockMACD(-0.002, -0.001); // Bearish (conflicting)
      mockBollingerBands(0.5); // Neutral

      const result = await strategy.execute(buildContext({ minConfluence: 3, atrEnabled: false }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });

    it('should filter signals when ATR indicates high volatility', async () => {
      mockEMA(105, 100);
      mockRSI(35);
      mockMACD(0.002, 0.001);
      mockATR(2.5, 1.0); // High volatility (2.5x average)
      mockBollingerBands(0.15);

      const result = await strategy.execute(buildContext({ minConfluence: 3 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0); // Filtered by ATR
    });

    it('should respect minConfidence threshold', async () => {
      setupBullishIndicators();

      const result = await strategy.execute(buildContext({ minConfluence: 3, minConfidence: 1.1 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0); // Filtered if confidence < threshold
    });
  });

  describe('execute - indicator disabling', () => {
    it('should work with EMA disabled', async () => {
      mockRSI(35);
      mockMACD(0.002, 0.001);
      mockATR(1.0, 1.0);
      mockBollingerBands(0.15);

      const result = await strategy.execute(buildContext({ emaEnabled: false, minConfluence: 3 }));

      expect(result.success).toBe(true);
      // Should still work with 4 indicators
      expect(indicatorService.calculateEMA).not.toHaveBeenCalled();
    });

    it('should work with RSI disabled', async () => {
      mockEMA(105, 100);
      mockMACD(0.002, 0.001);
      mockATR(1.0, 1.0);
      mockBollingerBands(0.15);

      const result = await strategy.execute(buildContext({ rsiEnabled: false, minConfluence: 3 }));

      expect(result.success).toBe(true);
      expect(indicatorService.calculateRSI).not.toHaveBeenCalled();
    });

    it('should work with MACD disabled', async () => {
      mockEMA(105, 100);
      mockRSI(35);
      mockATR(1.0, 1.0);
      mockBollingerBands(0.15);

      const result = await strategy.execute(buildContext({ macdEnabled: false, minConfluence: 3 }));

      expect(result.success).toBe(true);
      expect(indicatorService.calculateMACD).not.toHaveBeenCalled();
    });

    it('should work with ATR disabled', async () => {
      mockEMA(105, 100);
      mockRSI(35);
      mockMACD(0.002, 0.001);
      mockBollingerBands(0.15);

      const result = await strategy.execute(buildContext({ atrEnabled: false, minConfluence: 3 }));

      expect(result.success).toBe(true);
      expect(indicatorService.calculateATR).not.toHaveBeenCalled();
    });

    it('should work with Bollinger Bands disabled', async () => {
      mockEMA(105, 100);
      mockRSI(35);
      mockMACD(0.002, 0.001);
      mockATR(1.0, 1.0);

      const result = await strategy.execute(buildContext({ bbEnabled: false, minConfluence: 3 }));

      expect(result.success).toBe(true);
      expect(indicatorService.calculateBollingerBands).not.toHaveBeenCalled();
    });
  });

  describe('chart data', () => {
    it('should include all indicator values in chart data', async () => {
      setupBullishIndicators();

      const result = await strategy.execute(buildContext());

      expect(result.success).toBe(true);
      expect(result.chartData).toBeDefined();
      expect(result.chartData?.btc).toBeDefined();
      expect(result.chartData?.btc.length).toBeGreaterThan(0);

      const lastPoint = result.chartData?.btc[result.chartData?.btc.length - 1];
      expect(lastPoint?.metadata).toBeDefined();
      expect(lastPoint?.metadata?.ema12).toBeDefined();
      expect(lastPoint?.metadata?.ema26).toBeDefined();
      expect(lastPoint?.metadata?.rsi).toBeDefined();
      expect(lastPoint?.metadata?.macd).toBeDefined();
      expect(lastPoint?.metadata?.atr).toBeDefined();
      expect(lastPoint?.metadata?.percentB).toBeDefined();
    });
  });

  describe('configuration', () => {
    it('should return valid configuration schema', () => {
      const schema = strategy.getConfigSchema();

      // Core settings
      expect(schema).toHaveProperty('minConfluence');
      expect(schema).toHaveProperty('minConfidence');

      // EMA settings
      expect(schema).toHaveProperty('emaEnabled');
      expect(schema).toHaveProperty('emaFastPeriod');
      expect(schema).toHaveProperty('emaSlowPeriod');

      // RSI settings
      expect(schema).toHaveProperty('rsiEnabled');
      expect(schema).toHaveProperty('rsiPeriod');
      expect(schema).toHaveProperty('rsiBuyThreshold');
      expect(schema).toHaveProperty('rsiSellThreshold');

      // MACD settings
      expect(schema).toHaveProperty('macdEnabled');
      expect(schema).toHaveProperty('macdFastPeriod');
      expect(schema).toHaveProperty('macdSlowPeriod');
      expect(schema).toHaveProperty('macdSignalPeriod');

      // ATR settings
      expect(schema).toHaveProperty('atrEnabled');
      expect(schema).toHaveProperty('atrPeriod');
      expect(schema).toHaveProperty('atrVolatilityMultiplier');

      // Bollinger Bands settings
      expect(schema).toHaveProperty('bbEnabled');
      expect(schema).toHaveProperty('bbPeriod');
      expect(schema).toHaveProperty('bbStdDev');
      expect(schema).toHaveProperty('bbBuyThreshold');
      expect(schema).toHaveProperty('bbSellThreshold');
    });

    it('should apply default values correctly', async () => {
      setupBullishIndicators();

      const result = await strategy.execute(buildContext({}));

      expect(result.success).toBe(true);
      // Default minConfluence is 3, should work with defaults
    });
  });

  describe('canExecute', () => {
    it('should return true when enough indicators enabled', () => {
      const context = buildContext({ minConfluence: 3 });
      expect(strategy.canExecute(context)).toBe(true);
    });

    it('should return false when not enough indicators enabled', () => {
      const context = buildContext({
        minConfluence: 5,
        emaEnabled: false,
        rsiEnabled: false,
        macdEnabled: false
      });
      expect(strategy.canExecute(context)).toBe(false);
    });

    it('should return false when insufficient data', () => {
      const context = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: createMockPrices(5) as any }, // Only 5 data points
        timestamp: new Date(),
        config: {}
      } as AlgorithmContext;

      expect(strategy.canExecute(context)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle insufficient data gracefully', async () => {
      const context = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: createMockPrices(5) as any },
        timestamp: new Date(),
        config: {}
      } as AlgorithmContext;

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });

    it('should handle multiple coins', async () => {
      setupBullishIndicators();

      const context = {
        coins: [
          { id: 'btc', symbol: 'BTC', name: 'Bitcoin' },
          { id: 'eth', symbol: 'ETH', name: 'Ethereum' }
        ] as any,
        priceData: {
          btc: createMockPrices(50) as any,
          eth: createMockPrices(50, 2000) as any
        },
        timestamp: new Date(),
        config: { minConfluence: 3 }
      } as AlgorithmContext;

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.chartData?.btc).toBeDefined();
      expect(result.chartData?.eth).toBeDefined();
    });
  });

  describe('signal metadata', () => {
    it('should include indicator breakdown in metadata', async () => {
      setupBullishIndicators();

      const result = await strategy.execute(buildContext({ minConfluence: 3 }));

      expect(result.signals).toHaveLength(1);
      const signal = result.signals[0];

      expect(signal.metadata?.indicatorBreakdown).toBeDefined();
      expect(Array.isArray(signal.metadata?.indicatorBreakdown)).toBe(true);
      expect(signal.metadata?.agreeingIndicators).toBeDefined();
      expect(Array.isArray(signal.metadata?.agreeingIndicators)).toBe(true);
    });
  });
});
