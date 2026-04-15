import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, type TestingModule } from '@nestjs/testing';

import { RSIDivergenceStrategy } from './rsi-divergence.strategy';

import { IndicatorService } from '../indicators';
import { type AlgorithmContext, SignalType } from '../interfaces';

describe('RSIDivergenceStrategy', () => {
  let strategy: RSIDivergenceStrategy;
  let indicatorService: jest.Mocked<IndicatorService>;

  const mockSchedulerRegistry = {
    addCronJob: jest.fn(),
    deleteCronJob: jest.fn(),
    doesExist: jest.fn().mockReturnValue(false)
  };

  /**
   * Build a flat price array — all bars identical so no accidental pivots form.
   * Override specific indices to create intentional pivots.
   */
  const createFlatPrices = (count: number, basePrice = 100) => {
    return Array.from({ length: count }, (_, i) => ({
      id: `price-${i}`,
      avg: basePrice,
      high: basePrice + 2,
      low: basePrice - 2,
      date: new Date(Date.now() - (count - i) * 24 * 60 * 60 * 1000),
      coin: { id: 'btc', symbol: 'BTC' }
    }));
  };

  const baseConfig = {
    rsiPeriod: 14,
    emaPeriod: 20,
    lookbackPeriod: 30,
    pivotTolerance: 0.3,
    minDivergencePercent: 2,
    rsiOversold: 40,
    rsiOverbought: 60,
    minConfidence: 0.3
  };

  const createMockRSI = (count: number, defaultValue: number) => {
    const values = Array(count).fill(NaN);
    for (let i = 14; i < count; i++) values[i] = defaultValue;
    return values;
  };

  const createMockEMA = (count: number, value: number) => Array(count).fill(value);

  const createMockATR = (count: number, value: number) => {
    const values = Array(count).fill(NaN);
    for (let i = 14; i < count; i++) values[i] = value;
    return values;
  };

  const setupIndicatorMocks = (rsiValues: number[], emaValues: number[], atrValues: number[]) => {
    indicatorService.calculateRSI.mockResolvedValue({
      values: rsiValues,
      validCount: rsiValues.filter(Number.isFinite).length,
      period: 14,
      fromCache: false
    });
    indicatorService.calculateEMA.mockResolvedValue({
      values: emaValues,
      validCount: emaValues.length,
      period: 20,
      fromCache: false
    });
    indicatorService.calculateATR.mockResolvedValue({
      values: atrValues,
      validCount: atrValues.filter(Number.isFinite).length,
      period: 14,
      fromCache: false
    });
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

  describe('execute', () => {
    it('should generate BUY signal on bullish divergence with RSI in oversold zone', async () => {
      const prices = createFlatPrices(90);

      // Pivot low #1 at index 70: price dips to 80
      for (let j = -3; j <= 3; j++) {
        if (j === 0) {
          prices[70].low = 80;
          prices[70].avg = 83;
        } else {
          prices[70 + j].low = 95;
        }
      }

      // Pivot low #2 at index 83: lower price (74) → price makes lower low
      for (let j = -3; j <= 3; j++) {
        if (j === 0) {
          prices[83].low = 74;
          prices[83].avg = 77;
        } else {
          prices[83 + j].low = 95;
        }
      }

      const rsiValues = createMockRSI(90, 50);
      rsiValues[70] = 22; // RSI low at pivot #1
      rsiValues[83] = 30; // RSI higher low at pivot #2 → bullish divergence
      rsiValues[89] = 32; // Current RSI in oversold zone (< 40)

      const emaValues = createMockEMA(90, 100); // Price at 100, EMA at 100 → price ≤ EMA
      const atrValues = createMockATR(90, 5); // ATR = 5

      setupIndicatorMocks(rsiValues, emaValues, atrValues);

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: baseConfig
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.BUY);
      expect(result.signals[0].reason).toContain('Bullish RSI divergence');
      expect(result.signals[0].exitConfig).toBeDefined();
    });

    it('should generate SELL signal on bearish divergence with RSI in overbought zone', async () => {
      const prices = createFlatPrices(90);

      // Pivot high #1 at index 70
      for (let j = -3; j <= 3; j++) {
        if (j === 0) {
          prices[70].high = 120;
          prices[70].avg = 117;
        } else {
          prices[70 + j].high = 100;
        }
      }

      // Pivot high #2 at index 83: higher price → price makes higher high
      for (let j = -3; j <= 3; j++) {
        if (j === 0) {
          prices[83].high = 130;
          prices[83].avg = 127;
        } else {
          prices[83 + j].high = 100;
        }
      }

      const rsiValues = createMockRSI(90, 50);
      rsiValues[70] = 78; // RSI high at pivot #1
      rsiValues[83] = 68; // RSI lower high at pivot #2 → bearish divergence
      rsiValues[89] = 65; // Current RSI in overbought zone (> 60)

      const emaValues = createMockEMA(90, 100); // Price at 100, EMA at 100 → price ≥ EMA
      const atrValues = createMockATR(90, 5);

      setupIndicatorMocks(rsiValues, emaValues, atrValues);

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: baseConfig
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.SELL);
      expect(result.signals[0].reason).toContain('Bearish RSI divergence');
      expect(result.signals[0].exitConfig).toBeDefined();
    });

    it('should return no signal when RSI is in neutral zone (zone gate works)', async () => {
      const prices = createFlatPrices(90);

      // Create a valid bullish divergence in price/RSI
      for (let j = -3; j <= 3; j++) {
        if (j === 0) {
          prices[70].low = 80;
          prices[70].avg = 83;
        } else {
          prices[70 + j].low = 95;
        }
      }
      for (let j = -3; j <= 3; j++) {
        if (j === 0) {
          prices[83].low = 74;
          prices[83].avg = 77;
        } else {
          prices[83 + j].low = 95;
        }
      }

      const rsiValues = createMockRSI(90, 50);
      rsiValues[70] = 35;
      rsiValues[83] = 42;
      rsiValues[89] = 50; // RSI at 50 — NOT in oversold zone (needs < 40)

      const emaValues = createMockEMA(90, 100);
      const atrValues = createMockATR(90, 5);

      setupIndicatorMocks(rsiValues, emaValues, atrValues);

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: baseConfig
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });

    it('should return no signal when price is trending away from EMA (trend filter works)', async () => {
      const prices = createFlatPrices(90, 120); // Price at 120

      // Bullish divergence setup at high prices
      for (let j = -3; j <= 3; j++) {
        if (j === 0) {
          prices[70].low = 100;
          prices[70].avg = 103;
        } else {
          prices[70 + j].low = 115;
        }
      }
      for (let j = -3; j <= 3; j++) {
        if (j === 0) {
          prices[83].low = 94;
          prices[83].avg = 97;
        } else {
          prices[83 + j].low = 115;
        }
      }

      const rsiValues = createMockRSI(90, 50);
      rsiValues[70] = 25;
      rsiValues[83] = 32;
      rsiValues[89] = 35; // RSI in oversold zone

      const emaValues = createMockEMA(90, 100); // EMA at 100, but price at 120 → far above EMA
      const atrValues = createMockATR(90, 5);

      setupIndicatorMocks(rsiValues, emaValues, atrValues);

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: baseConfig
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });

    it('should find pivots that strict comparison would miss (ATR tolerance)', async () => {
      const prices = createFlatPrices(90);

      // Pivot low at index 70 with a neighbor that has EQUAL low value
      // Strict >= comparison would reject this, but ATR tolerance should accept it
      prices[70].low = 80;
      prices[70].avg = 83;
      prices[67].low = 95;
      prices[68].low = 93;
      prices[69].low = 93; // Close to neighbor but within ATR tolerance
      prices[71].low = 93;
      prices[72].low = 93;
      prices[73].low = 95;

      // Second pivot low at index 83
      prices[83].low = 74;
      prices[83].avg = 77;
      prices[80].low = 95;
      prices[81].low = 93;
      prices[82].low = 93;
      prices[84].low = 93;
      prices[85].low = 93;
      prices[86].low = 95;

      const rsiValues = createMockRSI(90, 50);
      rsiValues[70] = 22;
      rsiValues[83] = 30;
      rsiValues[89] = 32;

      const emaValues = createMockEMA(90, 100);
      // ATR = 5, tolerance = 0.3 → threshold = low + 5*0.3 = low + 1.5
      // Pivot at index 70: low=80, threshold=80+1.5=81.5. Neighbors at 93 > 81.5 → still pivot
      const atrValues = createMockATR(90, 5);

      setupIndicatorMocks(rsiValues, emaValues, atrValues);

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: baseConfig
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.BUY);
    });

    it('should select strongest divergence when multiple exist', async () => {
      const prices = createFlatPrices(90);

      // Weak divergence: pivots at 60 and 70
      for (let j = -3; j <= 3; j++) {
        if (j === 0) {
          prices[60].low = 85;
          prices[60].avg = 87;
        } else {
          prices[60 + j].low = 95;
        }
      }
      for (let j = -3; j <= 3; j++) {
        if (j === 0) {
          prices[70].low = 82;
          prices[70].avg = 84;
        } else {
          prices[70 + j].low = 95;
        }
      }

      // Stronger divergence: pivots at 60 and 83 (larger price drop, larger RSI increase)
      for (let j = -3; j <= 3; j++) {
        if (j === 0) {
          prices[83].low = 74;
          prices[83].avg = 77;
        } else {
          prices[83 + j].low = 95;
        }
      }

      const rsiValues = createMockRSI(90, 50);
      rsiValues[60] = 20; // RSI at weak pivot #1
      rsiValues[70] = 24; // RSI at weak pivot #2 (small RSI divergence: +4)
      rsiValues[83] = 32; // RSI at strong pivot #2 (large RSI divergence from 60: +12)
      rsiValues[89] = 35;

      const emaValues = createMockEMA(90, 100);
      const atrValues = createMockATR(90, 5);

      setupIndicatorMocks(rsiValues, emaValues, atrValues);

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: baseConfig
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      // The strongest divergence (60→83) should be selected
      const signal = result.signals[0];
      expect(signal.metadata?.['priceDivergence']).toBeLessThan(-10); // ~-12.9%
      expect(signal.metadata?.['rsiDivergence']).toBeGreaterThan(10); // +12
    });

    it('should have exit config with stop-loss, take-profit, and trailing stop enabled', async () => {
      const prices = createFlatPrices(90);

      for (let j = -3; j <= 3; j++) {
        if (j === 0) {
          prices[70].low = 80;
          prices[70].avg = 83;
        } else {
          prices[70 + j].low = 95;
        }
      }
      for (let j = -3; j <= 3; j++) {
        if (j === 0) {
          prices[83].low = 74;
          prices[83].avg = 77;
        } else {
          prices[83 + j].low = 95;
        }
      }

      const rsiValues = createMockRSI(90, 50);
      rsiValues[70] = 22;
      rsiValues[83] = 30;
      rsiValues[89] = 32;

      const emaValues = createMockEMA(90, 100);
      const atrValues = createMockATR(90, 5);

      setupIndicatorMocks(rsiValues, emaValues, atrValues);

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: baseConfig
      };

      const result = await strategy.execute(context);

      expect(result.signals).toHaveLength(1);
      const exitConfig = result.signals[0].exitConfig ?? {};
      expect(exitConfig.enableStopLoss).toBe(true);
      expect(exitConfig.stopLossValue).toBeGreaterThanOrEqual(2);
      expect(exitConfig.stopLossValue).toBeLessThanOrEqual(6);
      expect(exitConfig.enableTakeProfit).toBe(true);
      expect(exitConfig.takeProfitValue).toBeGreaterThanOrEqual(3);
      expect(exitConfig.takeProfitValue).toBeLessThanOrEqual(10);
      expect(exitConfig.enableTrailingStop).toBe(true);
      expect(exitConfig.trailingActivationValue).toBe(1.5);
      expect(exitConfig.useOco).toBe(true);
    });

    it('should return no signals when no divergence detected', async () => {
      const prices = createFlatPrices(90);

      const rsiValues = createMockRSI(90, 50);
      const emaValues = createMockEMA(90, 100);
      const atrValues = createMockATR(90, 5);

      setupIndicatorMocks(rsiValues, emaValues, atrValues);

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: baseConfig
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });

    it('should handle insufficient data gracefully', async () => {
      const prices = createFlatPrices(20);

      const context: AlgorithmContext = {
        coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
        priceData: { btc: prices as any },
        timestamp: new Date(),
        config: baseConfig
      };

      const result = await strategy.execute(context);

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });
  });

  describe('getIndicatorRequirements', () => {
    it('should require RSI, EMA, and ATR indicators', () => {
      const requirements = strategy.getIndicatorRequirements({});
      const types = requirements.map((r) => r.type);
      expect(types).toContain('RSI');
      expect(types).toContain('EMA');
      expect(types).toContain('ATR');
    });
  });

  describe('getConfigSchema', () => {
    it('should include all new parameters', () => {
      const schema = strategy.getConfigSchema();
      expect(schema).toHaveProperty('rsiPeriod');
      expect(schema).toHaveProperty('emaPeriod');
      expect(schema).toHaveProperty('lookbackPeriod');
      expect(schema).toHaveProperty('pivotTolerance');
      expect(schema).toHaveProperty('minDivergencePercent');
      expect(schema).toHaveProperty('rsiOversold');
      expect(schema).toHaveProperty('rsiOverbought');
      expect(schema).toHaveProperty('minConfidence');
    });
  });
});
