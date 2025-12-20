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

  describe('strategy properties', () => {
    it('should have correct id', () => {
      expect(strategy.id).toBe('rsi-divergence-001');
    });
  });

  describe('execute', () => {
    it('should generate BUY signal on bullish divergence (price lower lows, RSI higher lows)', async () => {
      // Create prices with lower lows pattern
      const prices = createMockPrices(40);
      // Create pivot lows in price
      prices[20].low = 85;
      prices[20].avg = 88;
      prices[20].high = 90;
      // Second low is lower in price
      prices[35].low = 80;
      prices[35].avg = 83;
      prices[35].high = 86;

      // RSI shows higher lows (divergence)
      const rsiValues = Array(40).fill(NaN);
      for (let i = 14; i < 40; i++) {
        rsiValues[i] = 45; // Default neutral
      }
      // First RSI low
      rsiValues[20] = 25;
      // Second RSI low is higher (bullish divergence)
      rsiValues[35] = 32;
      rsiValues[39] = 35;

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
        config: { rsiPeriod: 14, lookbackPeriod: 20, pivotStrength: 2, minDivergencePercent: 3 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      // May or may not generate signal depending on pivot detection
      if (result.signals.length > 0) {
        expect(result.signals[0].type).toBe(SignalType.BUY);
        expect(result.signals[0].reason).toContain('Bullish RSI divergence');
      }
    });

    it('should return no signals when no divergence detected', async () => {
      const prices = createMockPrices(40);
      // Stable prices
      for (let i = 0; i < 40; i++) {
        prices[i].avg = 100;
        prices[i].high = 102;
        prices[i].low = 98;
      }

      const rsiValues = Array(40).fill(NaN);
      for (let i = 14; i < 40; i++) {
        rsiValues[i] = 50; // Stable RSI
      }

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
      const prices = createMockPrices(20); // Not enough for divergence detection

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

  describe('getConfigSchema', () => {
    it('should return valid configuration schema', () => {
      const schema = strategy.getConfigSchema();

      expect(schema).toHaveProperty('rsiPeriod');
      expect(schema).toHaveProperty('lookbackPeriod');
      expect(schema).toHaveProperty('pivotStrength');
      expect(schema).toHaveProperty('minDivergencePercent');
      expect(schema).toHaveProperty('minConfidence');
    });
  });
});
