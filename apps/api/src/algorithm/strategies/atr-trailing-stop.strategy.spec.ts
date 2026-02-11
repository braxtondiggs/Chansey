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

  describe('execute', () => {
    it('should generate STOP_LOSS signal when price breaks below trailing stop', async () => {
      const prices = createMockPrices(30);
      // Stable prices with an early high to set a high trailing stop
      for (let i = 0; i < 30; i++) {
        prices[i].avg = 100;
        prices[i].high = 105;
        prices[i].low = 95;
      }
      // Spike high early: stop = 130 - 5*2.5 = 117.5
      prices[15].high = 130;
      // Last bar drops well below the trailing stop
      prices[29].avg = 80;
      prices[29].low = 75;
      prices[29].high = 85;

      const atrValues = Array(30).fill(NaN);
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
      expect(result.signals.length).toBeGreaterThan(0);
      expect(result.signals[0].type).toBe(SignalType.STOP_LOSS);
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

    it('should use trigger price (low) not avg in long stop signal metadata', async () => {
      const prices = createMockPrices(30);
      // Set last bar so low < stop < avg (triggers on low but not on avg)
      for (let i = 0; i < 30; i++) {
        prices[i].avg = 100;
        prices[i].high = 105;
        prices[i].low = 95;
      }
      // Spike a high early to set a high trailing stop
      prices[15].high = 130;
      // Last bar: low triggers, avg doesn't
      prices[29].avg = 100;
      prices[29].low = 80;
      prices[29].high = 105;

      const atrValues = Array(30).fill(NaN);
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
        config: { atrPeriod: 14, atrMultiplier: 2.5, tradeDirection: 'long', useHighLow: true }
      };

      const result = await strategy.execute(context);

      expect(result.signals.length).toBeGreaterThan(0);
      const signal = result.signals[0];
      expect(signal.metadata.currentPrice).toBe(80); // low, not avg
      expect(signal.metadata.avgPrice).toBe(100);
      expect(signal.metadata.direction).toBe('long');
    });

    it('should use trigger price (high) not avg in short stop signal metadata', async () => {
      const prices = createMockPrices(30);
      // Flat low prices, then last bar high spikes above stop
      for (let i = 0; i < 30; i++) {
        prices[i].avg = 100;
        prices[i].high = 105;
        prices[i].low = 95;
      }
      // Last bar: high breaches short stop, avg does not
      prices[29].avg = 100;
      prices[29].high = 120;
      prices[29].low = 95;

      const atrValues = Array(30).fill(NaN);
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
        config: { atrPeriod: 14, atrMultiplier: 2.5, tradeDirection: 'short', useHighLow: true }
      };

      const result = await strategy.execute(context);

      expect(result.signals.length).toBeGreaterThan(0);
      const signal = result.signals[0];
      expect(signal.metadata.currentPrice).toBe(120); // high, not avg
      expect(signal.metadata.avgPrice).toBe(100);
      expect(signal.metadata.direction).toBe('short');
    });

    it('should respect minConfidence: 0 and not filter out signals', async () => {
      const prices = createMockPrices(30);
      // Force a stop trigger
      for (let i = 0; i < 30; i++) {
        prices[i].avg = 100;
        prices[i].high = 105;
        prices[i].low = 95;
      }
      prices[15].high = 130;
      prices[29].avg = 80;
      prices[29].low = 75;
      prices[29].high = 85;

      const atrValues = Array(30).fill(NaN);
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
        config: { atrPeriod: 14, atrMultiplier: 2.5, tradeDirection: 'long', minConfidence: 0 }
      };

      const result = await strategy.execute(context);

      // With minConfidence: 0 (falsy!), a triggered stop should still produce a signal
      expect(result.signals.length).toBeGreaterThan(0);
    });

    it('should not produce NaN confidence when previous ATR index is NaN', async () => {
      const prices = createMockPrices(30);
      // Force a stop trigger
      for (let i = 0; i < 30; i++) {
        prices[i].avg = 100;
        prices[i].high = 105;
        prices[i].low = 95;
      }
      prices[15].high = 130;
      prices[29].avg = 80;
      prices[29].low = 75;
      prices[29].high = 85;

      // Only the very last ATR value is valid; all others NaN
      const atrValues = Array(30).fill(NaN);
      atrValues[29] = 5;

      indicatorService.calculateATR.mockResolvedValue({
        values: atrValues,
        validCount: 1,
        period: 14,
        fromCache: false
      });

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: { atrPeriod: 14, atrMultiplier: 2.5, tradeDirection: 'long', minConfidence: 0 }
      };

      const result = await strategy.execute(context);

      expect(result.signals.length).toBeGreaterThan(0);
      const signal = result.signals[0];
      expect(isNaN(signal.confidence)).toBe(false);
      expect(isNaN(signal.metadata.previousStopLevel as number)).toBe(false);
    });

    it('should ratchet long trailing stop when ATR spikes', async () => {
      // Ratcheting prevents the stop from dropping when ATR increases.
      // Previous bar had low ATR → high stop. Current bar has high ATR → lower raw stop.
      // Ratchet should hold the higher previous stop.
      const prices = createMockPrices(30);
      for (let i = 0; i < 30; i++) {
        prices[i].avg = 100;
        prices[i].high = 105;
        prices[i].low = 95;
      }
      // Last bar triggers: low drops below the ratcheted stop
      prices[29].avg = 80;
      prices[29].low = 75;
      prices[29].high = 85;

      // ATR is low (3) for most bars, then spikes to 8 on the last bar
      // Previous stop = 105 - 3*2.5 = 97.5
      // Raw current stop = 105 - 8*2.5 = 85
      // Ratcheted stop = max(85, 97.5) = 97.5
      const atrValues = Array(30).fill(NaN);
      for (let i = 14; i < 29; i++) {
        atrValues[i] = 3;
      }
      atrValues[29] = 8;

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
        config: { atrPeriod: 14, atrMultiplier: 2.5, tradeDirection: 'long', minConfidence: 0 }
      };

      const result = await strategy.execute(context);

      expect(result.signals.length).toBeGreaterThan(0);
      const signal = result.signals[0];

      // Ratcheted stop should hold at 97.5, not drop to raw 85
      expect(signal.metadata.stopLevel).toBeGreaterThanOrEqual(signal.metadata.previousStopLevel as number);
      expect(signal.metadata.stopLevel).toBeCloseTo(97.5, 1);
    });
  });
});
