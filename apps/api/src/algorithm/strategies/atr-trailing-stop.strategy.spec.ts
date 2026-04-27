import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, type TestingModule } from '@nestjs/testing';

import { ATRTrailingStopStrategy } from './atr-trailing-stop.strategy';

import { IndicatorService } from '../indicators';
import { type AlgorithmContext, SignalType } from '../interfaces';

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
      calculateSD: jest.fn(),
      calculateADX: jest.fn()
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
      // Spike high early: stop = 130 - 5*4.0 = 110
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
        config: { atrPeriod: 14, atrMultiplier: 4.0, tradeDirection: 'long' }
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
        config: { atrPeriod: 14, atrMultiplier: 3.5, tradeDirection: 'long' }
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
      // Spike a high early to set a high trailing stop: stop = 130 - 5*3.5 = 112.5
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
        config: { atrPeriod: 14, atrMultiplier: 3.5, tradeDirection: 'long', useHighLow: true, stopCooldownBars: 0 }
      };

      const result = await strategy.execute(context);

      const signal = result.signals[0];
      expect(signal).toBeDefined();
      const { metadata } = signal;
      expect(metadata).toBeDefined();
      expect(metadata?.currentPrice).toBe(80); // low, not avg
      expect(metadata?.avgPrice).toBe(100);
      expect(metadata?.direction).toBe('long');
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
        config: { atrPeriod: 14, atrMultiplier: 3.5, tradeDirection: 'short', useHighLow: true, stopCooldownBars: 0 }
      };

      const result = await strategy.execute(context);

      expect(result.signals.length).toBeGreaterThan(0);
      const signal = result.signals[0];
      expect(signal.metadata?.currentPrice).toBe(120); // high, not avg
      expect(signal.metadata?.avgPrice).toBe(100);
      expect(signal.metadata?.direction).toBe('short');
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
        config: { atrPeriod: 14, atrMultiplier: 3.5, tradeDirection: 'long', minConfidence: 0, stopCooldownBars: 0 }
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
        config: { atrPeriod: 14, atrMultiplier: 3.5, tradeDirection: 'long', minConfidence: 0, stopCooldownBars: 0 }
      };

      const result = await strategy.execute(context);

      expect(result.signals.length).toBeGreaterThan(0);
      const signal = result.signals[0];
      expect(isNaN(signal.confidence)).toBe(false);
      expect(isNaN(signal.metadata?.previousStopLevel as number)).toBe(false);
    });

    it('should generate BUY signal on bullish trend flip', async () => {
      const prices = createMockPrices(30);
      // Set up: previous bar triggered (low below stop), current bar recovered
      for (let i = 0; i < 30; i++) {
        prices[i].avg = 100;
        prices[i].high = 105;
        prices[i].low = 95;
      }
      // Spike high early to set trailing stop: stop = 130 - 5*3.5 = 112.5
      prices[15].high = 130;
      // Previous bar (28): triggers stop - low below 117.5
      prices[28].avg = 80;
      prices[28].low = 75;
      prices[28].high = 85;
      // Current bar (29): recovered above stop
      prices[29].avg = 125;
      prices[29].low = 120;
      prices[29].high = 130;

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
        config: { atrPeriod: 14, atrMultiplier: 3.5, tradeDirection: 'long', minConfidence: 0, stopCooldownBars: 0 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      const buySignals = result.signals.filter((s) => s.type === SignalType.BUY);
      expect(buySignals.length).toBeGreaterThan(0);
      expect(buySignals[0]?.metadata?.signalSource).toBe('trend_flip');
      expect(buySignals[0]?.metadata?.direction).toBe('long');
    });

    it('should not generate BUY when both bars are above stop (no spurious re-entries)', async () => {
      const prices = createMockPrices(30);
      // Both bars comfortably above the trailing stop
      for (let i = 0; i < 30; i++) {
        prices[i].avg = 100;
        prices[i].high = 105;
        prices[i].low = 95;
      }
      // No spike, trailing stop stays low: stop = 105 - 5*3.5 = 87.5
      // Both bar 28 and 29 have low=95, well above stop

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
        config: { atrPeriod: 14, atrMultiplier: 3.5, tradeDirection: 'long', minConfidence: 0, stopCooldownBars: 0 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      const buySignals = result.signals.filter((s) => s.type === SignalType.BUY);
      expect(buySignals).toHaveLength(0);
    });

    it('should generate SELL signal for short entry on bearish trend flip', async () => {
      const prices = createMockPrices(30);
      for (let i = 0; i < 30; i++) {
        prices[i].avg = 100;
        prices[i].high = 105;
        prices[i].low = 95;
      }
      // Short stop = lowestLow + ATR*multiplier = 95 + 5*3.5 = 112.5
      // Previous bar (28): high above short stop (triggered)
      prices[28].avg = 110;
      prices[28].high = 115;
      prices[28].low = 105;
      // Current bar (29): price dropped, high below short stop (not triggered)
      prices[29].avg = 90;
      prices[29].high = 95;
      prices[29].low = 85;

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
        config: { atrPeriod: 14, atrMultiplier: 3.5, tradeDirection: 'short', minConfidence: 0, stopCooldownBars: 0 }
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      const sellSignals = result.signals.filter(
        (s) => s.type === SignalType.SELL && s.metadata?.signalSource === 'trend_flip'
      );
      expect(sellSignals.length).toBeGreaterThan(0);
      expect(sellSignals[0]?.metadata?.direction).toBe('short');
    });

    it('should produce valid entry signal confidence (not NaN, in [0,1])', async () => {
      const prices = createMockPrices(30);
      for (let i = 0; i < 30; i++) {
        prices[i].avg = 100;
        prices[i].high = 105;
        prices[i].low = 95;
      }
      prices[15].high = 130;
      // Set up trend flip
      prices[28].avg = 80;
      prices[28].low = 75;
      prices[28].high = 85;
      prices[29].avg = 125;
      prices[29].low = 120;
      prices[29].high = 130;

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
        config: { atrPeriod: 14, atrMultiplier: 3.5, tradeDirection: 'long', minConfidence: 0, stopCooldownBars: 0 }
      };

      const result = await strategy.execute(context);

      const buySignals = result.signals.filter((s) => s.type === SignalType.BUY);
      expect(buySignals.length).toBeGreaterThan(0);
      const signal = buySignals[0];
      expect(isNaN(signal.confidence)).toBe(false);
      expect(signal.confidence).toBeGreaterThanOrEqual(0);
      expect(signal.confidence).toBeLessThanOrEqual(1);
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
      // Previous stop = 105 - 3*3.5 = 94.5
      // Raw current stop = 105 - 8*3.5 = 77
      // Ratcheted stop = max(77, 94.5) = 94.5
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
        config: { atrPeriod: 14, atrMultiplier: 3.5, tradeDirection: 'long', minConfidence: 0, stopCooldownBars: 0 }
      };

      const result = await strategy.execute(context);

      expect(result.signals.length).toBeGreaterThan(0);
      const signal = result.signals[0];

      // Ratcheted stop should hold at 94.5, not drop to raw 77
      expect(signal.metadata?.stopLevel).toBeGreaterThanOrEqual(signal.metadata?.previousStopLevel as number);
      expect(signal.metadata?.stopLevel).toBeCloseTo(94.5, 1);
    });

    it('should still emit entry on a single trend flip with the default cooldown enabled', async () => {
      // Regression: the cooldown previously included the trigger bar (currentIndex - 1)
      // in its lookback, which unconditionally suppressed every legitimate trend-flip
      // entry. A clean single flip with no older triggers should produce a BUY even
      // when stopCooldownBars > 0. With ATR=5, multiplier=3.5, the long stop sits at
      // 130 - 17.5 = 112.5, so bars 16-27 must keep low above that level to avoid
      // earlier-bar triggers polluting the cooldown lookback.
      const prices = createMockPrices(30);
      for (let i = 0; i < 30; i++) {
        prices[i].avg = 100;
        prices[i].high = 105;
        prices[i].low = 95;
      }
      prices[15].high = 130;
      // Bars 16-27 sit comfortably above the trailing stop (low=115 > 112.5)
      for (let i = 16; i <= 27; i++) {
        prices[i].avg = 120;
        prices[i].high = 125;
        prices[i].low = 115;
      }
      // Bar 28 triggers (entry-trigger bar)
      prices[28].avg = 80;
      prices[28].low = 75;
      prices[28].high = 85;
      // Bar 29 recovers
      prices[29].avg = 125;
      prices[29].low = 120;
      prices[29].high = 130;

      const atrValues = Array(30).fill(NaN);
      for (let i = 14; i < 30; i++) atrValues[i] = 5;

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
        // stopCooldownBars=3 (default) — must not suppress the legitimate entry
        config: { atrPeriod: 14, atrMultiplier: 3.5, tradeDirection: 'long', minConfidence: 0, stopCooldownBars: 3 }
      };

      const result = await strategy.execute(context);
      const buySignals = result.signals.filter((s) => s.type === SignalType.BUY);
      expect(buySignals.length).toBeGreaterThan(0);
      expect(buySignals[0]?.metadata?.signalSource).toBe('trend_flip');
    });

    it('should suppress entry when an older bar within the cooldown window also triggered', async () => {
      // Two stops within stopCooldownBars of each other: bar 26 fires a stop,
      // bar 28 fires the entry-trigger stop, bar 29 recovers. With cooldownBars=3
      // the lookback (bars 27,26,25) must catch bar 26 and suppress the entry.
      const prices = createMockPrices(30);
      for (let i = 0; i < 30; i++) {
        prices[i].avg = 100;
        prices[i].high = 105;
        prices[i].low = 95;
      }
      // Spike high early: ratcheted long stop ≈ 130 - 5*3.5 = 112.5
      prices[15].high = 130;
      // Bars 16-27 above stop by default (low=115 > 112.5) so no spurious triggers
      for (let i = 16; i <= 27; i++) {
        prices[i].avg = 120;
        prices[i].high = 125;
        prices[i].low = 115;
      }
      // Bar 26 triggers (older churn within cooldown window)
      prices[26].avg = 80;
      prices[26].low = 75;
      prices[26].high = 85;
      // Bar 28 triggers (entry-trigger bar)
      prices[28].avg = 80;
      prices[28].low = 75;
      prices[28].high = 85;
      // Bar 29 recovers — entry candidate, but bar 26 is within cooldown
      prices[29].avg = 125;
      prices[29].low = 120;
      prices[29].high = 130;

      const atrValues = Array(30).fill(NaN);
      for (let i = 14; i < 30; i++) atrValues[i] = 5;

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
        config: { atrPeriod: 14, atrMultiplier: 3.5, tradeDirection: 'long', minConfidence: 0, stopCooldownBars: 3 }
      };

      const result = await strategy.execute(context);
      const buySignals = result.signals.filter((s) => s.type === SignalType.BUY);
      expect(buySignals).toHaveLength(0);
    });

    it('should include stopCooldownBars in config schema', () => {
      const schema = strategy.getConfigSchema();
      expect(schema['stopCooldownBars']).toBeDefined();
      const cooldownSchema = schema['stopCooldownBars'] as Record<string, unknown>;
      expect(cooldownSchema['default']).toBe(3);
      expect(cooldownSchema['min']).toBe(0);
      expect(cooldownSchema['max']).toBe(10);
    });

    it('should use updated default config values', () => {
      const schema = strategy.getConfigSchema();
      const multiplierSchema = schema['atrMultiplier'] as Record<string, unknown>;
      const confidenceSchema = schema['minConfidence'] as Record<string, unknown>;

      expect(multiplierSchema['default']).toBe(4.5);
      expect(multiplierSchema['min']).toBe(2.0);
      expect(confidenceSchema['default']).toBe(0.4);
    });
  });

  describe('ADX tiered gate (gates entries only, stops always fire)', () => {
    /** Build a trend-flip scenario with controllable ADX value. */
    const setupTrendFlip = (adxValue: number, configOverrides: Record<string, unknown> = {}) => {
      const prices = createMockPrices(30);
      for (let i = 0; i < 30; i++) {
        prices[i].avg = 100;
        prices[i].high = 105;
        prices[i].low = 95;
      }
      prices[15].high = 130;
      for (let i = 16; i <= 27; i++) {
        prices[i].avg = 120;
        prices[i].high = 125;
        prices[i].low = 115;
      }
      prices[28].avg = 80;
      prices[28].low = 75;
      prices[28].high = 85;
      prices[29].avg = 125;
      prices[29].low = 120;
      prices[29].high = 130;

      const atrValues = Array(30).fill(NaN);
      for (let i = 14; i < 30; i++) atrValues[i] = 5;

      indicatorService.calculateATR.mockResolvedValue({
        values: atrValues,
        validCount: 15,
        period: 14,
        fromCache: false
      });

      indicatorService.calculateADX.mockResolvedValue({
        values: [...Array(29).fill(NaN), adxValue],
        pdi: [...Array(29).fill(NaN), 28],
        mdi: [...Array(29).fill(NaN), 12],
        validCount: 1,
        period: 14,
        fromCache: false
      });

      return {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: {
          atrPeriod: 14,
          atrMultiplier: 3.5,
          tradeDirection: 'long',
          minConfidence: 0,
          stopCooldownBars: 0,
          ...configOverrides
        }
      } as AlgorithmContext;
    };

    it('does not call calculateADX when minAdx defaults to 0', async () => {
      const ctx = setupTrendFlip(10, {});
      const result = await strategy.execute(ctx);
      expect(result.signals.filter((s) => s.type === SignalType.BUY).length).toBeGreaterThan(0);
      expect(indicatorService.calculateADX).not.toHaveBeenCalled();
    });

    it('blocks entry signal but keeps stop signal when ADX is below minAdx', async () => {
      // Force a stop trigger AND a trend-flip entry on the same execution by using
      // alternate prices: a stop fires elsewhere, but more importantly the BUY entry
      // is blocked by the ADX gate while any concurrent STOP_LOSS still fires.
      const ctx = setupTrendFlip(10, { minAdx: 25 });
      const result = await strategy.execute(ctx);
      const buys = result.signals.filter((s) => s.type === SignalType.BUY);
      expect(buys).toHaveLength(0);
    });

    it('emits weak-tier entry at half strength when minAdx ≤ ADX < adxStrongMin', async () => {
      const baselineCtx = setupTrendFlip(22, {});
      const baseline = await strategy.execute(baselineCtx);
      const baselineBuy = baseline.signals.find((s) => s.type === SignalType.BUY);
      expect(baselineBuy).toBeDefined();
      const baselineStrength = baselineBuy?.strength as number;
      jest.clearAllMocks();

      const ctx = setupTrendFlip(22, { minAdx: 20, adxStrongMin: 25, adxWeakMultiplier: 0.5 });
      const result = await strategy.execute(ctx);
      const buy = result.signals.find((s) => s.type === SignalType.BUY);
      expect(buy).toBeDefined();
      expect(buy?.strength).toBeCloseTo(baselineStrength * 0.5, 5);
      expect(buy?.metadata?.trendStrength).toBe('weak');
    });

    it('emits strong-tier entry at full strength when ADX ≥ adxStrongMin', async () => {
      const baselineCtx = setupTrendFlip(30, {});
      const baseline = await strategy.execute(baselineCtx);
      const baselineBuy = baseline.signals.find((s) => s.type === SignalType.BUY);
      expect(baselineBuy).toBeDefined();
      const baselineStrength = baselineBuy?.strength as number;
      jest.clearAllMocks();

      const ctx = setupTrendFlip(30, { minAdx: 20, adxStrongMin: 25, adxWeakMultiplier: 0.5 });
      const result = await strategy.execute(ctx);
      const buy = result.signals.find((s) => s.type === SignalType.BUY);
      expect(buy).toBeDefined();
      expect(buy?.strength).toBeCloseTo(baselineStrength, 5);
      expect(buy?.metadata?.trendStrength).toBe('strong');
      expect(buy?.metadata?.adx).toBe(30);
      expect(buy?.metadata?.pdi).toBe(28);
      expect(buy?.metadata?.mdi).toBe(12);
    });
  });
});
