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

  describe('strategy properties', () => {
    it('should have correct id', () => {
      expect(strategy.id).toBe('ema-rsi-filter-001');
    });
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

  describe('getConfigSchema', () => {
    it('should return valid configuration schema', () => {
      const schema = strategy.getConfigSchema();

      expect(schema).toHaveProperty('fastEmaPeriod');
      expect(schema).toHaveProperty('slowEmaPeriod');
      expect(schema).toHaveProperty('rsiPeriod');
      expect(schema).toHaveProperty('rsiMaxForBuy');
      expect(schema).toHaveProperty('rsiMinForSell');
    });
  });
});
