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

  const buildContext = (config: Record<string, any> = {}, overrides: Partial<AlgorithmContext> = {}) =>
    ({
      coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
      priceData: { btc: createMockPrices(50) as any },
      timestamp: new Date(),
      config,
      ...overrides
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

  // Setup all indicators for bullish scenario (trend-confirming)
  const setupBullishIndicators = () => {
    mockEMA(105, 100, 99, 100); // EMA12 > EMA26 (bullish trend)
    mockRSI(65); // RSI > 55 (strong upward momentum confirms trend)
    mockMACD(0.002, 0.001); // Positive histogram with upward momentum
    mockATR(1.0, 1.0); // Normal volatility
    mockBollingerBands(0.85); // %B > 0.55 (price pushing upper band, confirms uptrend)
  };

  // Setup all indicators for bearish scenario (trend-confirming)
  const setupBearishIndicators = () => {
    mockEMA(95, 100, 101, 100); // EMA12 < EMA26 (bearish trend)
    mockRSI(35); // RSI < 45 (weak momentum confirms downtrend)
    mockMACD(-0.002, -0.001); // Negative histogram with downward momentum
    mockATR(1.0, 1.0); // Normal volatility
    mockBollingerBands(0.15); // %B < 0.45 (price pushing lower band, confirms downtrend)
  };

  describe('execute - signal generation', () => {
    it('should generate BUY signal when all indicators agree bullish', async () => {
      setupBullishIndicators();

      const result = await strategy.execute(buildContext({ minConfluence: 3 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.BUY);
      expect(result.signals[0].reason).toContain('Confluence BUY');
      expect(result.signals[0].metadata?.confluenceCount).toBeGreaterThanOrEqual(3);
    });

    it('should generate SELL signal when all indicators agree bearish', async () => {
      setupBearishIndicators();

      const result = await strategy.execute(buildContext({ minConfluence: 3 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.SELL);
      expect(result.signals[0].reason).toContain('Confluence SELL');
    });

    it('should return no signals when confluence threshold not met', async () => {
      mockEMA(105, 100); // Bullish
      mockRSI(65); // Bullish (RSI > 55)
      mockMACD(-0.002, -0.001); // Bearish (conflicting)
      mockBollingerBands(0.5); // Neutral

      const result = await strategy.execute(buildContext({ minConfluence: 3, atrEnabled: false }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });

    it('should filter signals when ATR indicates high volatility', async () => {
      mockEMA(105, 100);
      mockRSI(65);
      mockMACD(0.002, 0.001);
      mockATR(2.5, 1.0); // High volatility (2.5x average)
      mockBollingerBands(0.85);

      const result = await strategy.execute(buildContext({ minConfluence: 3 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });

    it('should respect minConfidence threshold', async () => {
      setupBullishIndicators();

      const result = await strategy.execute(buildContext({ minConfluence: 3, minConfidence: 1.1 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });

    it('should hold when buy and sell counts are equal', async () => {
      mockEMA(105, 100); // Bullish
      mockRSI(35); // Bearish
      mockMACD(0.002, 0.001); // Bullish
      mockBollingerBands(0.15); // Bearish

      const result = await strategy.execute(buildContext({ minConfluence: 2, atrEnabled: false }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0); // 2 buy vs 2 sell → hold
    });
  });

  describe('execute - indicator disabling', () => {
    it.each([
      {
        label: 'EMA',
        configKey: 'emaEnabled',
        calculatorKey: 'calculateEMA' as const,
        setup: () => {
          mockRSI(65);
          mockMACD(0.002, 0.001);
          mockATR(1.0, 1.0);
          mockBollingerBands(0.85);
        }
      },
      {
        label: 'RSI',
        configKey: 'rsiEnabled',
        calculatorKey: 'calculateRSI' as const,
        setup: () => {
          mockEMA(105, 100);
          mockMACD(0.002, 0.001);
          mockATR(1.0, 1.0);
          mockBollingerBands(0.85);
        }
      },
      {
        label: 'MACD',
        configKey: 'macdEnabled',
        calculatorKey: 'calculateMACD' as const,
        setup: () => {
          mockEMA(105, 100);
          mockRSI(65);
          mockATR(1.0, 1.0);
          mockBollingerBands(0.85);
        }
      },
      {
        label: 'ATR',
        configKey: 'atrEnabled',
        calculatorKey: 'calculateATR' as const,
        setup: () => {
          mockEMA(105, 100);
          mockRSI(65);
          mockMACD(0.002, 0.001);
          mockBollingerBands(0.85);
        }
      },
      {
        label: 'Bollinger Bands',
        configKey: 'bbEnabled',
        calculatorKey: 'calculateBollingerBands' as const,
        setup: () => {
          mockEMA(105, 100);
          mockRSI(65);
          mockMACD(0.002, 0.001);
          mockATR(1.0, 1.0);
        }
      }
    ])('should skip $label calculation when disabled', async ({ configKey, calculatorKey, setup }) => {
      setup();

      const result = await strategy.execute(buildContext({ [configKey]: false, minConfluence: 3 }));

      expect(result.success).toBe(true);
      expect(indicatorService[calculatorKey]).not.toHaveBeenCalled();
    });
  });

  describe('chart data', () => {
    it('should include all indicator values in chart data', async () => {
      setupBullishIndicators();

      const result = await strategy.execute(buildContext());

      expect(result.chartData?.btc).toHaveLength(50);

      const lastPoint = result.chartData!.btc[49];
      expect(lastPoint.metadata?.ema12).toBe(105);
      expect(lastPoint.metadata?.ema26).toBe(100);
      expect(lastPoint.metadata?.rsi).toBe(65);
      expect(lastPoint.metadata?.atr).toBe(1.0);
      expect(lastPoint.metadata?.percentB).toBe(0.85);
      expect(lastPoint.metadata?.macd).toBeDefined();
    });

    it('should omit chart data in backtest mode', async () => {
      setupBullishIndicators();

      const result = await strategy.execute(
        buildContext({ minConfluence: 3 }, { metadata: { backtestId: 'bt-123' } } as any)
      );

      expect(result.success).toBe(true);
      expect(result.chartData?.btc).toBeUndefined();
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
        priceData: { btc: createMockPrices(5) as any },
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
          btc: createMockPrices(60) as any,
          eth: createMockPrices(5) as any
        },
        timestamp: new Date(),
        config: { minConfluence: 3 }
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
        config: { minConfluence: 3 }
      } as AlgorithmContext;

      expect(strategy.canExecute(context)).toBe(false);
    });

    it('should return false when minSellConfluence exceeds enabled directional indicators', () => {
      const context = buildContext({
        minConfluence: 2,
        minSellConfluence: 5,
        emaEnabled: false,
        rsiEnabled: false
      });
      expect(strategy.canExecute(context)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should skip coins with insufficient data and still succeed', async () => {
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

    it('should produce signals and chart data for multiple coins', async () => {
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
      expect(result.chartData?.btc).toHaveLength(50);
      expect(result.chartData?.eth).toHaveLength(50);
    });

    it('should return error result when indicator service throws', async () => {
      indicatorService.calculateEMA.mockRejectedValue(new Error('Service unavailable'));

      const result = await strategy.execute(buildContext({ minConfluence: 3 }));

      expect(result.success).toBe(false);
      expect(result.error).toContain('Service unavailable');
      expect(result.signals).toHaveLength(0);
    });
  });

  describe('symmetric sell thresholds', () => {
    it('should generate SELL when 3/4 indicators are bearish with BB neutral', async () => {
      mockEMA(95, 100, 101, 100); // Bearish
      mockRSI(35); // Bearish (RSI < 45)
      mockMACD(-0.002, -0.001); // Bearish
      mockATR(1.0, 1.0); // Normal volatility
      mockBollingerBands(0.5); // Neutral (between 0.45 and 0.55)

      const result = await strategy.execute(buildContext({ minConfluence: 2 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.SELL);
      expect(result.signals[0].metadata?.confluenceCount).toBe(3);
    });

    it('should complete a buy-sell cycle without trapping positions', async () => {
      // Phase 1: Bullish setup -> BUY
      setupBullishIndicators();
      const buyResult = await strategy.execute(buildContext({ minConfluence: 2 }));

      expect(buyResult.signals).toHaveLength(1);
      expect(buyResult.signals[0].type).toBe(SignalType.BUY);

      // Phase 2: Bearish setup -> SELL
      setupBearishIndicators();
      const sellResult = await strategy.execute(buildContext({ minConfluence: 2 }));

      expect(sellResult.signals).toHaveLength(1);
      expect(sellResult.signals[0].type).toBe(SignalType.SELL);
    });

    it('should use symmetric defaults so 2 bearish indicators produce SELL', async () => {
      mockEMA(95, 100, 101, 100); // Bearish
      mockRSI(50); // Neutral
      mockMACD(-0.002, -0.001); // Bearish
      mockATR(1.0, 1.0); // Normal volatility
      mockBollingerBands(0.5); // Neutral

      const result = await strategy.execute(buildContext({}));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.SELL);
      expect(result.signals[0].metadata?.confluenceCount).toBe(2);
    });
  });

  describe('signal metadata', () => {
    it('should include indicator breakdown and agreeing indicators in metadata', async () => {
      setupBullishIndicators();

      const result = await strategy.execute(buildContext({ minConfluence: 3 }));

      expect(result.signals).toHaveLength(1);
      const signal = result.signals[0];

      const breakdown = signal.metadata?.indicatorBreakdown as any[];
      expect(breakdown).toHaveLength(5); // EMA + RSI + MACD + BB + ATR
      expect(breakdown.every((b: any) => b.name && b.signal && typeof b.strength === 'number')).toBe(true);

      const agreeing = signal.metadata?.agreeingIndicators as string[];
      expect(agreeing).toContain('EMA');
      expect(agreeing).toContain('RSI');
      expect(agreeing).toContain('MACD');
      expect(agreeing).toContain('BB');
    });
  });
});
