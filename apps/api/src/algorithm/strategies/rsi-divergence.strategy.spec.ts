import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { RSIDivergenceStrategy } from './rsi-divergence.strategy';

import { IndicatorService } from '../indicators';
import { AlgorithmContext, SignalType } from '../interfaces';

describe('RSIDivergenceStrategy', () => {
  let strategy: RSIDivergenceStrategy;
  let indicatorService: jest.Mocked<IndicatorService>;

  const mockSchedulerRegistry = {
    addCronJob: jest.fn(),
    deleteCronJob: jest.fn(),
    doesExist: jest.fn().mockReturnValue(false)
  };

  /**
   * Build a flat price array — all bars identical so no accidental pivots form.
   * Override specific indices to create intentional pivots.
   */
  const createFlatPrices = (count: number, basePrice = 100) => {
    return Array.from({ length: count }, (_, i) => ({
      id: `price-${i}`,
      avg: basePrice,
      high: basePrice + 2,
      low: basePrice - 2,
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
        RSIDivergenceStrategy,
        { provide: SchedulerRegistry, useValue: mockSchedulerRegistry },
        { provide: IndicatorService, useValue: mockIndicatorService }
      ]
    }).compile();

    strategy = module.get<RSIDivergenceStrategy>(RSIDivergenceStrategy);
    indicatorService = module.get(IndicatorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should generate BUY signal on bullish divergence (price lower lows, RSI higher lows)', async () => {
      // Flat base so only our explicit pivot lows are detected.
      // pivotStrength=2 means each pivot needs bars ±2 strictly higher.
      const prices = createFlatPrices(50);

      // Pivot low #1 at index 30
      prices[28].low = 95;
      prices[29].low = 92;
      prices[30].low = 80;
      prices[30].avg = 83;
      prices[31].low = 90;
      prices[32].low = 94;

      // Pivot low #2 at index 45: lower price → price makes lower low
      prices[43].low = 93;
      prices[44].low = 88;
      prices[45].low = 74;
      prices[45].avg = 77;
      prices[46].low = 87;
      prices[47].low = 92;

      // RSI: NaN for first 14, neutral 50 elsewhere, divergent lows at pivots
      const rsiValues = Array(50).fill(NaN);
      for (let i = 14; i < 50; i++) rsiValues[i] = 50;
      rsiValues[30] = 22; // RSI low at pivot #1
      rsiValues[45] = 30; // RSI higher low at pivot #2 → bullish divergence
      rsiValues[49] = 35; // Current RSI (< 40 for position score boost)

      indicatorService.calculateRSI.mockResolvedValue({
        values: rsiValues,
        validCount: 36,
        period: 14,
        fromCache: false
      });

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { rsiPeriod: 14, lookbackPeriod: 30, pivotStrength: 2, minDivergencePercent: 3, minConfidence: 0.5 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.BUY);
      expect(result.signals[0].reason).toContain('Bullish RSI divergence');
    });

    it('should generate SELL signal on bearish divergence (price higher highs, RSI lower highs)', async () => {
      // Flat base so only our explicit pivot highs are detected.
      const prices = createFlatPrices(50);

      // Pivot high #1 at index 30 (high=120, well above base 102)
      prices[30].high = 120;
      prices[30].avg = 117;
      prices[30].low = 114;

      // Pivot high #2 at index 45: higher price → price makes higher high
      prices[45].high = 130;
      prices[45].avg = 127;
      prices[45].low = 124;

      // RSI: neutral 50, with lower high at pivot #2
      const rsiValues = Array(50).fill(NaN);
      for (let i = 14; i < 50; i++) rsiValues[i] = 50;
      rsiValues[30] = 78; // RSI high at pivot #1
      rsiValues[45] = 68; // RSI lower high at pivot #2 → bearish divergence
      rsiValues[49] = 65; // Current RSI (> 60 for position score boost)

      indicatorService.calculateRSI.mockResolvedValue({
        values: rsiValues,
        validCount: 36,
        period: 14,
        fromCache: false
      });

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { rsiPeriod: 14, lookbackPeriod: 30, pivotStrength: 2, minDivergencePercent: 3, minConfidence: 0.5 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.SELL);
      expect(result.signals[0].reason).toContain('Bearish RSI divergence');
    });

    it('should return no signals when no divergence detected', async () => {
      const prices = createFlatPrices(40);

      const rsiValues = Array(40).fill(NaN);
      for (let i = 14; i < 40; i++) rsiValues[i] = 50;

      indicatorService.calculateRSI.mockResolvedValue({
        values: rsiValues,
        validCount: 25,
        period: 14,
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

    it('should handle insufficient data gracefully', async () => {
      const prices = createFlatPrices(20);

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { rsiPeriod: 14, lookbackPeriod: 14, pivotStrength: 2 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });
  });
});
