import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { EMARSIFilterStrategy } from './ema-rsi-filter.strategy';

import { IndicatorService } from '../indicators';
import { AlgorithmContext, SignalType } from '../interfaces';

describe('EMARSIFilterStrategy', () => {
  let strategy: EMARSIFilterStrategy;
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
        EMARSIFilterStrategy,
        { provide: SchedulerRegistry, useValue: mockSchedulerRegistry },
        { provide: IndicatorService, useValue: mockIndicatorService }
      ]
    }).compile();

    strategy = module.get<EMARSIFilterStrategy>(EMARSIFilterStrategy);
    indicatorService = module.get(IndicatorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should generate BUY signal when EMA bullish crossover AND RSI not overbought', async () => {
      const prices = createMockPrices(50);

      const fastEMA = Array(50).fill(NaN);
      const slowEMA = Array(50).fill(NaN);
      const rsiValues = Array(50).fill(NaN);

      // Set up bullish crossover
      for (let i = 26; i < 50; i++) {
        fastEMA[i] = 100;
        slowEMA[i] = 101;
      }
      // Previous: fast <= slow
      fastEMA[48] = 99;
      slowEMA[48] = 100;
      // Current: fast > slow (bullish crossover)
      fastEMA[49] = 101;
      slowEMA[49] = 100;
      // RSI is not overbought
      rsiValues[49] = 55;

      indicatorService.calculateEMA
        .mockResolvedValueOnce({
          values: fastEMA,
          validCount: 40,
          period: 12,
          fromCache: false
        })
        .mockResolvedValueOnce({
          values: slowEMA,
          validCount: 25,
          period: 26,
          fromCache: false
        });

      indicatorService.calculateRSI.mockResolvedValue({
        values: rsiValues,
        validCount: 35,
        period: 14,
        fromCache: false
      });

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { rsiMaxForBuy: 70, rsiMinForSell: 30 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.BUY);
      expect(result.signals[0].reason).toContain('EMA bullish crossover confirmed by RSI filter');
    });

    it('should NOT generate BUY signal when EMA bullish crossover BUT RSI is overbought', async () => {
      const prices = createMockPrices(50);

      const fastEMA = Array(50).fill(NaN);
      const slowEMA = Array(50).fill(NaN);
      const rsiValues = Array(50).fill(NaN);

      // Set up bullish crossover
      for (let i = 26; i < 50; i++) {
        fastEMA[i] = 100;
        slowEMA[i] = 101;
      }
      fastEMA[48] = 99;
      slowEMA[48] = 100;
      fastEMA[49] = 101;
      slowEMA[49] = 100;
      // RSI IS overbought (should filter out the buy signal)
      rsiValues[49] = 75;

      indicatorService.calculateEMA
        .mockResolvedValueOnce({
          values: fastEMA,
          validCount: 40,
          period: 12,
          fromCache: false
        })
        .mockResolvedValueOnce({
          values: slowEMA,
          validCount: 25,
          period: 26,
          fromCache: false
        });

      indicatorService.calculateRSI.mockResolvedValue({
        values: rsiValues,
        validCount: 35,
        period: 14,
        fromCache: false
      });

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { rsiMaxForBuy: 70 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0); // Signal filtered due to RSI
    });

    it('should generate SELL signal when EMA bearish crossover AND RSI not oversold', async () => {
      const prices = createMockPrices(50);

      const fastEMA = Array(50).fill(NaN);
      const slowEMA = Array(50).fill(NaN);
      const rsiValues = Array(50).fill(NaN);

      // Set up bearish crossover
      for (let i = 26; i < 50; i++) {
        fastEMA[i] = 100;
        slowEMA[i] = 99;
      }
      // Previous: fast >= slow
      fastEMA[48] = 101;
      slowEMA[48] = 100;
      // Current: fast < slow (bearish crossover)
      fastEMA[49] = 99;
      slowEMA[49] = 100;
      // RSI is not oversold
      rsiValues[49] = 45;

      indicatorService.calculateEMA
        .mockResolvedValueOnce({
          values: fastEMA,
          validCount: 40,
          period: 12,
          fromCache: false
        })
        .mockResolvedValueOnce({
          values: slowEMA,
          validCount: 25,
          period: 26,
          fromCache: false
        });

      indicatorService.calculateRSI.mockResolvedValue({
        values: rsiValues,
        validCount: 35,
        period: 14,
        fromCache: false
      });

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { rsiMinForSell: 30 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.SELL);
      expect(result.signals[0].reason).toContain('EMA bearish crossover confirmed by RSI filter');
    });

    it('should NOT generate SELL signal when EMA bearish crossover BUT RSI is oversold', async () => {
      const prices = createMockPrices(50);

      const fastEMA = Array(50).fill(NaN);
      const slowEMA = Array(50).fill(NaN);
      const rsiValues = Array(50).fill(NaN);

      // Bearish crossover
      fastEMA[48] = 101;
      slowEMA[48] = 100;
      fastEMA[49] = 99;
      slowEMA[49] = 100;
      // RSI IS oversold (should filter out the sell signal)
      rsiValues[49] = 25;

      indicatorService.calculateEMA
        .mockResolvedValueOnce({
          values: fastEMA,
          validCount: 40,
          period: 12,
          fromCache: false
        })
        .mockResolvedValueOnce({
          values: slowEMA,
          validCount: 25,
          period: 26,
          fromCache: false
        });

      indicatorService.calculateRSI.mockResolvedValue({
        values: rsiValues,
        validCount: 35,
        period: 14,
        fromCache: false
      });

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { rsiMinForSell: 30 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0); // Signal filtered due to RSI
    });

    it('should not crash when rsiMaxForBuy=50 (division-by-zero edge case)', async () => {
      const prices = createMockPrices(50);

      const fastEMA = Array(50).fill(NaN);
      const slowEMA = Array(50).fill(NaN);
      const rsiValues = Array(50).fill(NaN);

      // Set up bullish crossover
      for (let i = 26; i < 50; i++) {
        fastEMA[i] = 100;
        slowEMA[i] = 101;
        rsiValues[i] = 55;
      }
      fastEMA[48] = 99;
      slowEMA[48] = 100;
      fastEMA[49] = 101;
      slowEMA[49] = 100;
      // RSI at 55 is >= rsiMaxForBuy=50, so signal should be filtered
      rsiValues[49] = 55;

      indicatorService.calculateEMA
        .mockResolvedValueOnce({ values: fastEMA, validCount: 40, period: 12, fromCache: false })
        .mockResolvedValueOnce({ values: slowEMA, validCount: 25, period: 26, fromCache: false });
      indicatorService.calculateRSI.mockResolvedValue({
        values: rsiValues,
        validCount: 35,
        period: 14,
        fromCache: false
      });

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { rsiMaxForBuy: 50, rsiMinForSell: 30 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      // RSI 55 >= rsiMaxForBuy 50, so buy should be filtered
      expect(result.signals).toHaveLength(0);
    });

    it('should not crash when rsiMinForSell=50 (division-by-zero edge case)', async () => {
      const prices = createMockPrices(50);

      const fastEMA = Array(50).fill(NaN);
      const slowEMA = Array(50).fill(NaN);
      const rsiValues = Array(50).fill(NaN);

      // Set up bearish crossover
      for (let i = 26; i < 50; i++) {
        fastEMA[i] = 100;
        slowEMA[i] = 99;
        rsiValues[i] = 45;
      }
      fastEMA[48] = 101;
      slowEMA[48] = 100;
      fastEMA[49] = 99;
      slowEMA[49] = 100;
      // RSI at 45 is <= rsiMinForSell=50, so signal should be filtered
      rsiValues[49] = 45;

      indicatorService.calculateEMA
        .mockResolvedValueOnce({ values: fastEMA, validCount: 40, period: 12, fromCache: false })
        .mockResolvedValueOnce({ values: slowEMA, validCount: 25, period: 26, fromCache: false });
      indicatorService.calculateRSI.mockResolvedValue({
        values: rsiValues,
        validCount: 35,
        period: 14,
        fromCache: false
      });

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { rsiMaxForBuy: 70, rsiMinForSell: 50 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      // RSI 45 <= rsiMinForSell 50, so sell should be filtered
      expect(result.signals).toHaveLength(0);
    });

    it('should respect minConfidence: 0 (not default to 0.6)', async () => {
      const prices = createMockPrices(50);

      const fastEMA = Array(50).fill(NaN);
      const slowEMA = Array(50).fill(NaN);
      const rsiValues = Array(50).fill(NaN);

      // Set up bullish crossover
      for (let i = 26; i < 50; i++) {
        fastEMA[i] = 100;
        slowEMA[i] = 101;
        rsiValues[i] = 50;
      }
      fastEMA[48] = 99;
      slowEMA[48] = 100;
      fastEMA[49] = 101;
      slowEMA[49] = 100;
      rsiValues[49] = 55;

      indicatorService.calculateEMA
        .mockResolvedValueOnce({ values: fastEMA, validCount: 40, period: 12, fromCache: false })
        .mockResolvedValueOnce({ values: slowEMA, validCount: 25, period: 26, fromCache: false });
      indicatorService.calculateRSI.mockResolvedValue({
        values: rsiValues,
        validCount: 35,
        period: 14,
        fromCache: false
      });

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { minConfidence: 0 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      // With minConfidence: 0, any signal should pass regardless of confidence
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.BUY);
    });

    it('should produce higher signal strength for faster EMA divergence', async () => {
      const buildContext = (spreadDelta: number) => {
        const prices = createMockPrices(50);
        const fastEMA = Array(50).fill(NaN);
        const slowEMA = Array(50).fill(NaN);
        const rsiValues = Array(50).fill(NaN);

        for (let i = 26; i < 50; i++) {
          fastEMA[i] = 100;
          slowEMA[i] = 101;
          rsiValues[i] = 50;
        }
        // Previous: fast <= slow (no spread)
        fastEMA[48] = 100;
        slowEMA[48] = 100;
        // Current: fast > slow by spreadDelta
        fastEMA[49] = 100 + spreadDelta;
        slowEMA[49] = 100;
        rsiValues[49] = 45;

        return { prices, fastEMA, slowEMA, rsiValues };
      };

      // Small divergence (0.1% of slowEMA → emaStrength = 0.1)
      const small = buildContext(0.1);
      indicatorService.calculateEMA
        .mockResolvedValueOnce({ values: small.fastEMA, validCount: 40, period: 12, fromCache: false })
        .mockResolvedValueOnce({ values: small.slowEMA, validCount: 25, period: 26, fromCache: false });
      indicatorService.calculateRSI.mockResolvedValueOnce({
        values: small.rsiValues,
        validCount: 35,
        period: 14,
        fromCache: false
      });

      const smallResult = await strategy.execute({
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: small.prices as any },
        timestamp: new Date(),
        config: { minConfidence: 0 }
      });

      // Large divergence (0.5% of slowEMA → emaStrength = 0.5)
      const large = buildContext(0.5);
      indicatorService.calculateEMA
        .mockResolvedValueOnce({ values: large.fastEMA, validCount: 40, period: 12, fromCache: false })
        .mockResolvedValueOnce({ values: large.slowEMA, validCount: 25, period: 26, fromCache: false });
      indicatorService.calculateRSI.mockResolvedValueOnce({
        values: large.rsiValues,
        validCount: 35,
        period: 14,
        fromCache: false
      });

      const largeResult = await strategy.execute({
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: large.prices as any },
        timestamp: new Date(),
        config: { minConfidence: 0 }
      });

      expect(smallResult.signals).toHaveLength(1);
      expect(largeResult.signals).toHaveLength(1);
      expect(largeResult.signals[0].strength).toBeGreaterThan(smallResult.signals[0].strength);
    });

    it('should produce higher confidence when price momentum confirms bullish crossover', async () => {
      // Rising prices → higher confidence
      const risingPrices = Array.from({ length: 50 }, (_, i) => ({
        id: `price-${i}`,
        avg: 100 + i * 0.5, // steadily rising
        high: 100 + i * 0.5 + 5,
        low: 100 + i * 0.5 - 5,
        date: new Date(Date.now() - (50 - i) * 24 * 60 * 60 * 1000),
        coin: { id: 'btc', symbol: 'BTC' }
      }));

      // Flat prices → lower confidence
      const flatPrices = Array.from({ length: 50 }, (_, i) => ({
        id: `price-${i}`,
        avg: 100 + (i % 2 === 0 ? 0.1 : -0.1), // oscillating flat
        high: 105,
        low: 95,
        date: new Date(Date.now() - (50 - i) * 24 * 60 * 60 * 1000),
        coin: { id: 'btc', symbol: 'BTC' }
      }));

      const buildEMAs = () => {
        const fastEMA = Array(50).fill(NaN);
        const slowEMA = Array(50).fill(NaN);
        const rsiValues = Array(50).fill(NaN);
        for (let i = 26; i < 50; i++) {
          fastEMA[i] = 100;
          slowEMA[i] = 101;
          rsiValues[i] = 50;
        }
        fastEMA[48] = 99;
        slowEMA[48] = 100;
        fastEMA[49] = 102;
        slowEMA[49] = 100;
        rsiValues[49] = 45;
        return { fastEMA, slowEMA, rsiValues };
      };

      // Rising prices run
      const rising = buildEMAs();
      indicatorService.calculateEMA
        .mockResolvedValueOnce({ values: rising.fastEMA, validCount: 40, period: 12, fromCache: false })
        .mockResolvedValueOnce({ values: rising.slowEMA, validCount: 25, period: 26, fromCache: false });
      indicatorService.calculateRSI.mockResolvedValueOnce({
        values: rising.rsiValues,
        validCount: 35,
        period: 14,
        fromCache: false
      });

      const risingResult = await strategy.execute({
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: risingPrices as any },
        timestamp: new Date(),
        config: { minConfidence: 0 }
      });

      // Flat prices run
      const flat = buildEMAs();
      indicatorService.calculateEMA
        .mockResolvedValueOnce({ values: flat.fastEMA, validCount: 40, period: 12, fromCache: false })
        .mockResolvedValueOnce({ values: flat.slowEMA, validCount: 25, period: 26, fromCache: false });
      indicatorService.calculateRSI.mockResolvedValueOnce({
        values: flat.rsiValues,
        validCount: 35,
        period: 14,
        fromCache: false
      });

      const flatResult = await strategy.execute({
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: flatPrices as any },
        timestamp: new Date(),
        config: { minConfidence: 0 }
      });

      expect(risingResult.signals).toHaveLength(1);
      expect(flatResult.signals).toHaveLength(1);
      expect(risingResult.signals[0].confidence).toBeGreaterThan(flatResult.signals[0].confidence);
    });

    it('should return no signals when no crossover occurs', async () => {
      const prices = createMockPrices(50);

      const fastEMA = Array(50).fill(NaN);
      const slowEMA = Array(50).fill(NaN);
      const rsiValues = Array(50).fill(NaN);

      // No crossover - fast stays above slow
      for (let i = 26; i < 50; i++) {
        fastEMA[i] = 102;
        slowEMA[i] = 100;
        rsiValues[i] = 50;
      }

      indicatorService.calculateEMA
        .mockResolvedValueOnce({
          values: fastEMA,
          validCount: 40,
          period: 12,
          fromCache: false
        })
        .mockResolvedValueOnce({
          values: slowEMA,
          validCount: 25,
          period: 26,
          fromCache: false
        });

      indicatorService.calculateRSI.mockResolvedValue({
        values: rsiValues,
        validCount: 35,
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
  });
});
