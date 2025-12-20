import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { BollingerBandsBreakoutStrategy } from './bollinger-bands-breakout.strategy';

import { IndicatorService } from '../indicators';
import { AlgorithmContext, SignalType } from '../interfaces';

describe('BollingerBandsBreakoutStrategy', () => {
  let strategy: BollingerBandsBreakoutStrategy;
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
        BollingerBandsBreakoutStrategy,
        { provide: SchedulerRegistry, useValue: mockSchedulerRegistry },
        { provide: IndicatorService, useValue: mockIndicatorService }
      ]
    }).compile();

    strategy = module.get<BollingerBandsBreakoutStrategy>(BollingerBandsBreakoutStrategy);
    indicatorService = module.get(IndicatorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('strategy properties', () => {
    it('should have correct id', () => {
      expect(strategy.id).toBe('bb-breakout-001');
    });
  });

  describe('execute', () => {
    it('should generate BUY signal on upper band breakout', async () => {
      const prices = createMockPrices(30);
      prices[29].avg = 120; // Price above upper band

      const upper = Array(30).fill(NaN);
      const middle = Array(30).fill(NaN);
      const lower = Array(30).fill(NaN);
      const pb = Array(30).fill(NaN);
      const bandwidth = Array(30).fill(NaN);

      // Populate BB values for the last several bars
      for (let i = 20; i < 30; i++) {
        upper[i] = 115;
        middle[i] = 100;
        lower[i] = 85;
        pb[i] = 0.5; // Normal
        bandwidth[i] = 0.2 + (i - 20) * 0.01; // Gradually expanding
      }
      // Last bar shows breakout
      pb[29] = 1.33; // Above upper band (%B > 1)
      bandwidth[29] = 0.3;

      indicatorService.calculateBollingerBands.mockResolvedValue({
        upper,
        middle,
        lower,
        pb,
        bandwidth,
        validCount: 15,
        period: 20,
        stdDev: 2,
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
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.BUY);
      expect(result.signals[0].reason).toContain('Bullish breakout');
    });

    it('should generate SELL signal on lower band breakout', async () => {
      const prices = createMockPrices(30);
      prices[29].avg = 80; // Price below lower band

      const upper = Array(30).fill(NaN);
      const middle = Array(30).fill(NaN);
      const lower = Array(30).fill(NaN);
      const pb = Array(30).fill(NaN);
      const bandwidth = Array(30).fill(NaN);

      // Populate BB values for the last several bars
      for (let i = 20; i < 30; i++) {
        upper[i] = 115;
        middle[i] = 100;
        lower[i] = 85;
        pb[i] = 0.5; // Normal
        bandwidth[i] = 0.2 + (i - 20) * 0.01; // Gradually expanding
      }
      // Last bar shows breakout
      pb[29] = -0.33; // Below lower band (%B < 0)
      bandwidth[29] = 0.3;

      indicatorService.calculateBollingerBands.mockResolvedValue({
        upper,
        middle,
        lower,
        pb,
        bandwidth,
        validCount: 15,
        period: 20,
        stdDev: 2,
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
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.SELL);
      expect(result.signals[0].reason).toContain('Bearish breakout');
    });

    it('should return no signals when price is within bands', async () => {
      const prices = createMockPrices(30);

      const upper = Array(30).fill(NaN);
      const middle = Array(30).fill(NaN);
      const lower = Array(30).fill(NaN);
      const pb = Array(30).fill(NaN);
      const bandwidth = Array(30).fill(NaN);

      upper[29] = 115;
      middle[29] = 100;
      lower[29] = 85;
      pb[29] = 0.5; // Within bands
      bandwidth[29] = 0.3;

      indicatorService.calculateBollingerBands.mockResolvedValue({
        upper,
        middle,
        lower,
        pb,
        bandwidth,
        validCount: 15,
        period: 20,
        stdDev: 2,
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

      expect(schema).toHaveProperty('period');
      expect(schema).toHaveProperty('stdDev');
      expect(schema).toHaveProperty('requireConfirmation');
    });
  });
});
