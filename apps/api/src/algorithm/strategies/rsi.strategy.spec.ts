import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { RSIStrategy } from './rsi.strategy';

import { IndicatorService } from '../indicators';
import { AlgorithmContext, SignalType } from '../interfaces';

describe('RSIStrategy', () => {
  let strategy: RSIStrategy;
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
        RSIStrategy,
        { provide: SchedulerRegistry, useValue: mockSchedulerRegistry },
        { provide: IndicatorService, useValue: mockIndicatorService }
      ]
    }).compile();

    strategy = module.get<RSIStrategy>(RSIStrategy);
    indicatorService = module.get(IndicatorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const buildContext = (prices: any[], config: Record<string, any>) =>
    ({
      coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
      priceData: { btc: prices as any },
      timestamp: new Date(),
      config
    }) as AlgorithmContext;

  const mockRsi = (values: number[], validCount = 15, period = 14) => {
    indicatorService.calculateRSI.mockResolvedValue({
      values,
      validCount,
      period,
      fromCache: false
    });
  };

  describe('strategy properties', () => {
    it('should have correct id', () => {
      expect(strategy.id).toBe('rsi-momentum-001');
    });
  });

  describe('execute', () => {
    it.each([
      ['oversold -> BUY', 25, 32, { oversoldThreshold: 30, overboughtThreshold: 70 }, 1, SignalType.BUY],
      ['overbought -> SELL', 78, 68, { oversoldThreshold: 30, overboughtThreshold: 70 }, 1, SignalType.SELL],
      ['neutral -> no signal', 52, 48, { oversoldThreshold: 30, overboughtThreshold: 70 }, 0, undefined],
      ['custom oversold -> BUY', 38, 42, { oversoldThreshold: 40, overboughtThreshold: 60 }, 1, SignalType.BUY]
    ])('should handle %s', async (_label, latestRsi, prevRsi, config, expectedCount, expectedType) => {
      const prices = createMockPrices(30);
      const rsiValues = Array(30).fill(NaN);
      rsiValues[28] = prevRsi;
      rsiValues[29] = latestRsi;

      mockRsi(rsiValues);

      const result = await strategy.execute(buildContext(prices, { period: 14, ...config }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(expectedCount);
      if (expectedCount > 0) {
        expect(result.signals[0].type).toBe(expectedType);
      }
    });

    it('should handle insufficient data gracefully', async () => {
      const prices = createMockPrices(5); // Too few prices

      const result = await strategy.execute(buildContext(prices, { period: 14 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
      expect(indicatorService.calculateRSI).not.toHaveBeenCalled();
    });

    it('should only generate signals for coins with sufficient data', async () => {
      const sufficientPrices = createMockPrices(30);
      const insufficientPrices = createMockPrices(5);

      const rsiValues = Array(30).fill(NaN);
      rsiValues[28] = 32;
      rsiValues[29] = 25; // oversold
      mockRsi(rsiValues);

      const context = {
        coins: [
          { id: 'btc', symbol: 'BTC', name: 'Bitcoin' },
          { id: 'eth', symbol: 'ETH', name: 'Ethereum' }
        ] as any,
        priceData: {
          btc: sufficientPrices as any,
          eth: insufficientPrices as any
        },
        timestamp: new Date(),
        config: { period: 14, oversoldThreshold: 30, overboughtThreshold: 70 }
      } as AlgorithmContext;

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(indicatorService.calculateRSI).toHaveBeenCalledTimes(1);
      expect(indicatorService.calculateRSI).toHaveBeenCalledWith(
        expect.objectContaining({ coinId: 'btc' }),
        expect.anything()
      );
    });
  });

  describe('canExecute', () => {
    it('should return true with sufficient data', () => {
      const prices = createMockPrices(30);

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { period: 14 }
      };

      expect(strategy.canExecute(context)).toBe(true);
    });

    it('should return false with insufficient data', () => {
      const prices = createMockPrices(10);

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { period: 14 }
      };

      expect(strategy.canExecute(context)).toBe(false);
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
        config: { period: 14 }
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
        config: { period: 14 }
      };

      expect(strategy.canExecute(context)).toBe(false);
    });
  });

  describe('getConfigSchema', () => {
    it('should return valid configuration schema', () => {
      const schema = strategy.getConfigSchema();

      expect(schema).toHaveProperty('period');
      expect(schema).toHaveProperty('oversoldThreshold');
      expect(schema).toHaveProperty('overboughtThreshold');
      expect(schema).toHaveProperty('minConfidence');
    });
  });
});
