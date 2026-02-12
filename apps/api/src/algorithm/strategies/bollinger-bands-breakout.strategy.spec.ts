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

  describe('confirmation direction validation', () => {
    const setupConfirmationTest = (
      confirmationPrices: { avg: number; upper: number; lower: number }[],
      currentPB: number
    ) => {
      const prices = createMockPrices(30);
      const upper = Array(30).fill(NaN);
      const middle = Array(30).fill(NaN);
      const lower = Array(30).fill(NaN);
      const pb = Array(30).fill(NaN);
      const bandwidth = Array(30).fill(NaN);

      // Populate BB values for last bars
      for (let i = 20; i < 30; i++) {
        upper[i] = 115;
        middle[i] = 100;
        lower[i] = 85;
        pb[i] = 0.5;
        bandwidth[i] = 0.2 + (i - 20) * 0.01;
      }

      // Set confirmation bar data (bars 28 and 29 for confirmationBars=2)
      for (let i = 0; i < confirmationPrices.length; i++) {
        const idx = 30 - confirmationPrices.length + i;
        prices[idx].avg = confirmationPrices[i].avg;
        upper[idx] = confirmationPrices[i].upper;
        lower[idx] = confirmationPrices[i].lower;
      }

      pb[29] = currentPB;
      bandwidth[29] = 0.3;

      return { prices, upper, middle, lower, pb, bandwidth };
    };

    it('should produce BUY when confirmation is bullish and %B > 1', async () => {
      // Both confirmation bars have price above upper band → bullish confirmation
      const { prices, upper, middle, lower, pb, bandwidth } = setupConfirmationTest(
        [
          { avg: 120, upper: 115, lower: 85 },
          { avg: 122, upper: 115, lower: 85 }
        ],
        1.33
      );

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
        config: { requireConfirmation: true, confirmationBars: 2, minConfidence: 0 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.BUY);
    });

    it('should block signal when confirmation direction mismatches breakout', async () => {
      // Both confirmation bars have price above upper band → bullish confirmation
      // But %B on last bar is < 0 → bearish breakout — direction mismatch should block
      const { prices, upper, middle, lower, pb, bandwidth } = setupConfirmationTest(
        [
          { avg: 120, upper: 115, lower: 85 },
          { avg: 120, upper: 115, lower: 85 }
        ],
        -0.33
      );
      // Confirmation checks prices[i].avg vs upper[i]/lower[i] directly,
      // while signal generation uses the independent pb[] array.
      // Both bars: price 120 > upper 115 → bullish confirmed
      // But pb[29] = -0.33 → bearish breakout → should be blocked

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
        config: { requireConfirmation: true, confirmationBars: 2, minConfidence: 0 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });
  });

  describe('confidence filtering', () => {
    it('should filter signal when confidence is below minConfidence', async () => {
      const prices = createMockPrices(30);
      prices[29].avg = 120;

      const upper = Array(30).fill(NaN);
      const middle = Array(30).fill(NaN);
      const lower = Array(30).fill(NaN);
      const pb = Array(30).fill(NaN);
      const bandwidth = Array(30).fill(NaN);

      // Flat bandwidth and no momentum consistency → low confidence
      for (let i = 20; i < 30; i++) {
        upper[i] = 115;
        middle[i] = 100;
        lower[i] = 85;
        pb[i] = 0.5; // No upward momentum trend
        bandwidth[i] = 0.2; // Flat, not expanding
      }
      pb[29] = 1.33; // Breakout on last bar only
      bandwidth[29] = 0.2; // Still flat

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
        config: { minConfidence: 0.6 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      // With flat bandwidth (0 expanding) and flat %B (only last bar jumps = 1/5 momentum),
      // confidence = (0/5 + 1/5) / 2 + 0.3 = 0.1 + 0.3 = 0.4 < 0.6
      expect(result.signals).toHaveLength(0);
    });
  });
});
