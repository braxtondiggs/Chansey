import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { TripleEMAStrategy } from './triple-ema.strategy';

import { IndicatorService } from '../indicators';
import { AlgorithmContext, SignalType } from '../interfaces';

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
      calculateSD: jest.fn()
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

  describe('strategy properties', () => {
    it('should have correct id', () => {
      expect(strategy.id).toBe('triple-ema-001');
    });
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

  describe('getConfigSchema', () => {
    it('should return valid configuration schema', () => {
      const schema = strategy.getConfigSchema();

      expect(schema).toHaveProperty('fastPeriod');
      expect(schema).toHaveProperty('mediumPeriod');
      expect(schema).toHaveProperty('slowPeriod');
      expect(schema).toHaveProperty('requireFullAlignment');
      expect(schema).toHaveProperty('signalOnPartialCross');
    });
  });
});
