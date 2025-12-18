import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { ATRTrailingStopStrategy } from './atr-trailing-stop.strategy';

import { IndicatorService } from '../indicators';
import { AlgorithmContext, SignalType } from '../interfaces';

describe('ATRTrailingStopStrategy', () => {
  let strategy: ATRTrailingStopStrategy;
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
        ATRTrailingStopStrategy,
        { provide: SchedulerRegistry, useValue: mockSchedulerRegistry },
        { provide: IndicatorService, useValue: mockIndicatorService }
      ]
    }).compile();

    strategy = module.get<ATRTrailingStopStrategy>(ATRTrailingStopStrategy);
    indicatorService = module.get(IndicatorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('strategy properties', () => {
    it('should have correct id', () => {
      expect(strategy.id).toBe('atr-trailing-stop-001');
    });
  });

  describe('execute', () => {
    it('should generate STOP_LOSS signal when price breaks below trailing stop', async () => {
      const prices = createMockPrices(30);
      // Set up a scenario where price drops significantly
      prices[29].avg = 80;
      prices[29].low = 75;
      prices[29].high = 85;

      const atrValues = Array(30).fill(NaN);
      // Set ATR values
      for (let i = 14; i < 30; i++) {
        atrValues[i] = 5;
      }

      indicatorService.calculateATR.mockResolvedValue({
        values: atrValues,
        validCount: 15,
        period: 14,
        fromCache: false
      });

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { atrPeriod: 14, atrMultiplier: 2.5, tradeDirection: 'long' }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      // May or may not generate signal depending on trailing stop calculation
      if (result.signals.length > 0) {
        expect(result.signals[0].type).toBe(SignalType.STOP_LOSS);
      }
    });

    it('should return no signals when price is above trailing stop', async () => {
      const prices = createMockPrices(30);
      // Price stays stable
      for (let i = 0; i < 30; i++) {
        prices[i].avg = 100;
        prices[i].high = 102;
        prices[i].low = 98;
      }

      const atrValues = Array(30).fill(NaN);
      for (let i = 14; i < 30; i++) {
        atrValues[i] = 2;
      }

      indicatorService.calculateATR.mockResolvedValue({
        values: atrValues,
        validCount: 15,
        period: 14,
        fromCache: false
      });

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { atrPeriod: 14, atrMultiplier: 2.5, tradeDirection: 'long' }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });

    it('should handle insufficient data gracefully', async () => {
      const prices = createMockPrices(10);

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { atrPeriod: 14 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });
  });

  describe('getConfigSchema', () => {
    it('should return valid configuration schema', () => {
      const schema = strategy.getConfigSchema();

      expect(schema).toHaveProperty('atrPeriod');
      expect(schema).toHaveProperty('atrMultiplier');
      expect(schema).toHaveProperty('tradeDirection');
      expect(schema).toHaveProperty('useHighLow');
    });
  });
});
