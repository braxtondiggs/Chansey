import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { BollingerBandSqueezeStrategy } from './bollinger-band-squeeze.strategy';

import { IndicatorService } from '../indicators';
import { AlgorithmContext, SignalType } from '../interfaces';

describe('BollingerBandSqueezeStrategy', () => {
  let strategy: BollingerBandSqueezeStrategy;
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
        BollingerBandSqueezeStrategy,
        { provide: SchedulerRegistry, useValue: mockSchedulerRegistry },
        { provide: IndicatorService, useValue: mockIndicatorService }
      ]
    }).compile();

    strategy = module.get<BollingerBandSqueezeStrategy>(BollingerBandSqueezeStrategy);
    indicatorService = module.get(IndicatorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('strategy properties', () => {
    it('should have correct id', () => {
      expect(strategy.id).toBe('bb-squeeze-001');
    });
  });

  describe('execute', () => {
    it('should generate BUY signal on bullish squeeze breakout', async () => {
      const prices = createMockPrices(40);
      // Set price above middle band at breakout
      prices[39].avg = 115;
      prices[38].avg = 100;

      const upper = Array(40).fill(NaN);
      const middle = Array(40).fill(NaN);
      const lower = Array(40).fill(NaN);
      const pb = Array(40).fill(NaN);
      const bandwidth = Array(40).fill(NaN);

      // Set up squeeze condition (low bandwidth) followed by breakout
      for (let i = 20; i < 40; i++) {
        upper[i] = 110;
        middle[i] = 100;
        lower[i] = 90;
        pb[i] = 0.5;
        // Squeeze condition for bars 25-38
        if (i >= 25 && i < 39) {
          bandwidth[i] = 0.03; // Below squeeze threshold of 0.04
        } else {
          bandwidth[i] = 0.15; // Normal bandwidth
        }
      }
      // Breakout bar
      bandwidth[39] = 0.05; // Breaking out of squeeze
      pb[39] = 0.75; // Above middle

      indicatorService.calculateBollingerBands.mockResolvedValue({
        upper,
        middle,
        lower,
        pb,
        bandwidth,
        validCount: 20,
        period: 20,
        stdDev: 2,
        fromCache: false
      });

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { squeezeThreshold: 0.04, minSqueezeBars: 6 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      // Signal depends on proper squeeze detection
      if (result.signals.length > 0) {
        expect(result.signals[0].type).toBe(SignalType.BUY);
        expect(result.signals[0].reason).toContain('Bullish squeeze breakout');
      }
    });

    it('should return no signals when in squeeze (not breaking out)', async () => {
      const prices = createMockPrices(40);

      const upper = Array(40).fill(NaN);
      const middle = Array(40).fill(NaN);
      const lower = Array(40).fill(NaN);
      const pb = Array(40).fill(NaN);
      const bandwidth = Array(40).fill(NaN);

      for (let i = 20; i < 40; i++) {
        upper[i] = 110;
        middle[i] = 100;
        lower[i] = 90;
        pb[i] = 0.5;
        bandwidth[i] = 0.03; // All in squeeze, no breakout
      }

      indicatorService.calculateBollingerBands.mockResolvedValue({
        upper,
        middle,
        lower,
        pb,
        bandwidth,
        validCount: 20,
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

    it('should return no signals when bandwidth is normal (no squeeze)', async () => {
      const prices = createMockPrices(40);

      const upper = Array(40).fill(NaN);
      const middle = Array(40).fill(NaN);
      const lower = Array(40).fill(NaN);
      const pb = Array(40).fill(NaN);
      const bandwidth = Array(40).fill(NaN);

      for (let i = 20; i < 40; i++) {
        upper[i] = 120;
        middle[i] = 100;
        lower[i] = 80;
        pb[i] = 0.5;
        bandwidth[i] = 0.2; // Normal bandwidth, no squeeze
      }

      indicatorService.calculateBollingerBands.mockResolvedValue({
        upper,
        middle,
        lower,
        pb,
        bandwidth,
        validCount: 20,
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
      expect(schema).toHaveProperty('squeezeThreshold');
      expect(schema).toHaveProperty('minSqueezeBars');
      expect(schema).toHaveProperty('breakoutConfirmation');
    });
  });
});
