import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, type TestingModule } from '@nestjs/testing';

import { BollingerBandSqueezeStrategy } from './bollinger-band-squeeze.strategy';

import { IndicatorService } from '../indicators';
import { type AlgorithmContext, SignalType } from '../interfaces';

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
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.BUY);
      expect(result.signals[0].reason).toContain('Bullish squeeze breakout');
      expect(result.signals[0].metadata?.currentBandwidth).not.toBeNaN();
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

    it('should use config squeezeThreshold in signal strength (not hardcoded default)', async () => {
      const prices = createMockPrices(40);
      prices[39].avg = 115;
      prices[38].avg = 100;

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
        if (i >= 25 && i < 39) {
          bandwidth[i] = 0.06; // Below custom threshold 0.08, but above default 0.04
        } else {
          bandwidth[i] = 0.15;
        }
      }
      bandwidth[39] = 0.09; // Breaking out above custom threshold
      pb[39] = 0.75;

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
        config: { squeezeThreshold: 0.08, minSqueezeBars: 6 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      // With hardcoded 0.04, intensity = (0.04 - 0.06) / 0.03 = negative → strength floors to 0.4.
      // With config threshold 0.08, intensity = (0.08 - 0.06) / 0.06 = positive → strength > 0.4.
      expect(result.signals[0].strength).toBeGreaterThan(0.4);
    });

    it('should not merge separate squeeze periods across NaN gaps', async () => {
      const prices = createMockPrices(40);
      prices[39].avg = 115;
      prices[38].avg = 100;

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
        bandwidth[i] = 0.03; // In squeeze
      }
      // NaN gap splitting squeeze into two short periods (each < minSqueezeBars=6)
      bandwidth[35] = NaN;
      // Post-gap: only bars 36,37,38 = 3 bars (< 6 minimum)
      bandwidth[39] = 0.05; // Breakout bar
      pb[39] = 0.75;

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
      expect(result.signals).toHaveLength(0); // NaN breaks count, too few consecutive bars
    });

    it('should generate SELL signal on bearish breakout', async () => {
      const prices = createMockPrices(40);
      prices[39].avg = 85; // Below middle band
      prices[38].avg = 100;

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
        if (i >= 25 && i < 39) {
          bandwidth[i] = 0.03;
        } else {
          bandwidth[i] = 0.15;
        }
      }
      bandwidth[39] = 0.05;
      pb[39] = 0.25; // Below middle

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
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.SELL);
      expect(result.signals[0].reason).toContain('Bearish squeeze breakout');
    });

    it('should return no signals when breakout confirmation fails', async () => {
      const prices = createMockPrices(40);
      // Price above middle (bullish direction) but declining (fails confirmation)
      prices[39].avg = 102;
      prices[38].avg = 110;

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
        if (i >= 25 && i < 39) {
          bandwidth[i] = 0.03;
        } else {
          bandwidth[i] = 0.15;
        }
      }
      bandwidth[39] = 0.05;
      pb[39] = 0.55; // Above middle → bullish, but price declining

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
      expect(result.signals).toHaveLength(0);
    });

    it('should handle calculateBollingerBands failure gracefully', async () => {
      const prices = createMockPrices(40);

      indicatorService.calculateBollingerBands.mockRejectedValue(new Error('Calculation failed'));

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

    it('should skip coins with insufficient price data', async () => {
      const prices = createMockPrices(10); // Need period(20) + minSqueezeBars(6) + 5 = 31

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: {}
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
      expect(indicatorService.calculateBollingerBands).not.toHaveBeenCalled();
    });

    it('processes multiple coins concurrently rather than sequentially', async () => {
      const prices = createMockPrices(40);

      let inFlight = 0;
      let maxInFlight = 0;
      indicatorService.calculateBollingerBands.mockImplementation(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 30));
        inFlight--;
        return {
          upper: Array(40).fill(NaN),
          middle: Array(40).fill(NaN),
          lower: Array(40).fill(NaN),
          pb: Array(40).fill(NaN),
          bandwidth: Array(40).fill(NaN),
          validCount: 0,
          period: 20,
          stdDev: 2,
          fromCache: false
        };
      });

      const context: AlgorithmContext = {
        coins: [
          { id: 'btc', symbol: 'BTC', name: 'Bitcoin' },
          { id: 'eth', symbol: 'ETH', name: 'Ethereum' },
          { id: 'sol', symbol: 'SOL', name: 'Solana' }
        ] as any,
        priceData: { btc: prices as any, eth: prices as any, sol: prices as any },
        timestamp: new Date(),
        config: {}
      };

      await strategy.execute(context);

      expect(indicatorService.calculateBollingerBands).toHaveBeenCalledTimes(3);
      expect(maxInFlight).toBeGreaterThan(1);
    });

    it('logs cache=skipped when indicator cache is bypassed (live-replay)', async () => {
      const prices = createMockPrices(40);
      const warnSpy = jest.spyOn(strategy['logger'], 'warn').mockImplementation(() => undefined);

      indicatorService.calculateBollingerBands.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1100));
        return {
          upper: Array(40).fill(NaN),
          middle: Array(40).fill(NaN),
          lower: Array(40).fill(NaN),
          pb: Array(40).fill(NaN),
          bandwidth: Array(40).fill(NaN),
          validCount: 0,
          period: 20,
          stdDev: 2,
          fromCache: false
        };
      });

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: {},
        metadata: { isLiveReplay: true, backtestId: 'bt-1' }
      };

      await strategy.execute(context);

      const skippedLogged = warnSpy.mock.calls.some(
        (args) => typeof args[0] === 'string' && (args[0] as string).includes('cache=skipped')
      );
      expect(skippedLogged).toBe(true);

      warnSpy.mockRestore();
    });

    it('logs cache=miss when cache is consulted but missed (live/paper)', async () => {
      const prices = createMockPrices(40);
      const warnSpy = jest.spyOn(strategy['logger'], 'warn').mockImplementation(() => undefined);

      indicatorService.calculateBollingerBands.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1100));
        return {
          upper: Array(40).fill(NaN),
          middle: Array(40).fill(NaN),
          lower: Array(40).fill(NaN),
          pb: Array(40).fill(NaN),
          bandwidth: Array(40).fill(NaN),
          validCount: 0,
          period: 20,
          stdDev: 2,
          fromCache: false
        };
      });

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: {}
      };

      await strategy.execute(context);

      const missLogged = warnSpy.mock.calls.some(
        (args) => typeof args[0] === 'string' && (args[0] as string).includes('cache=miss')
      );
      expect(missLogged).toBe(true);

      warnSpy.mockRestore();
    });

    it('logs cache=hit when calculator reports fromCache=true', async () => {
      const prices = createMockPrices(40);
      const warnSpy = jest.spyOn(strategy['logger'], 'warn').mockImplementation(() => undefined);

      indicatorService.calculateBollingerBands.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1100));
        return {
          upper: Array(40).fill(NaN),
          middle: Array(40).fill(NaN),
          lower: Array(40).fill(NaN),
          pb: Array(40).fill(NaN),
          bandwidth: Array(40).fill(NaN),
          validCount: 0,
          period: 20,
          stdDev: 2,
          fromCache: true
        };
      });

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: {}
      };

      await strategy.execute(context);

      const hitLogged = warnSpy.mock.calls.some(
        (args) => typeof args[0] === 'string' && (args[0] as string).includes('cache=hit')
      );
      expect(hitLogged).toBe(true);

      warnSpy.mockRestore();
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
});
