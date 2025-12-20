import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { RSIMACDComboStrategy } from './rsi-macd-combo.strategy';

import { IndicatorService } from '../indicators';
import { AlgorithmContext, SignalType } from '../interfaces';

describe('RSIMACDComboStrategy', () => {
  let strategy: RSIMACDComboStrategy;
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
        RSIMACDComboStrategy,
        { provide: SchedulerRegistry, useValue: mockSchedulerRegistry },
        { provide: IndicatorService, useValue: mockIndicatorService }
      ]
    }).compile();

    strategy = module.get<RSIMACDComboStrategy>(RSIMACDComboStrategy);
    indicatorService = module.get(IndicatorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const buildContext = (config: Record<string, any> = {}) =>
    ({
      coins: [{ id: 'btc', symbol: 'BTC', name: 'Bitcoin' }] as any,
      priceData: { btc: createMockPrices(50) as any },
      timestamp: new Date(),
      config
    }) as AlgorithmContext;

  const mockRSI = (latest: number, prev: number) => {
    const rsiValues = Array(50).fill(NaN);
    rsiValues[48] = prev;
    rsiValues[49] = latest;
    indicatorService.calculateRSI.mockResolvedValue({
      values: rsiValues,
      validCount: 15,
      period: 14,
      fromCache: false
    });
  };

  const mockMACD = (macdPrev: number, macdCurr: number, signalPrev: number, signalCurr: number, histCurr: number) => {
    const macdValues = Array(50).fill(NaN);
    const signalValues = Array(50).fill(NaN);
    const histogramValues = Array(50).fill(NaN);
    macdValues[48] = macdPrev;
    macdValues[49] = macdCurr;
    signalValues[48] = signalPrev;
    signalValues[49] = signalCurr;
    histogramValues[49] = histCurr;

    indicatorService.calculateMACD.mockResolvedValue({
      macd: macdValues,
      signal: signalValues,
      histogram: histogramValues,
      validCount: 15,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      fromCache: false
    });
  };

  describe('strategy properties', () => {
    it('should have correct id', () => {
      expect(strategy.id).toBe('rsi-macd-combo-001');
    });
  });

  describe('execute', () => {
    it('should generate BUY signal when RSI oversold AND MACD bullish crossover', async () => {
      mockRSI(30, 45);
      mockMACD(-0.001, 0.002, 0.001, 0.001, 0.001);

      const result = await strategy.execute(buildContext({ rsiOversold: 35, rsiOverbought: 65 }));

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe(SignalType.BUY);
      expect(result.signals[0].reason).toContain('RSI+MACD Combo BUY');
    });

    it('should return no signals when only RSI condition met', async () => {
      mockRSI(25, 35);
      mockMACD(0.002, 0.003, 0.001, 0.001, 0.002);

      const result = await strategy.execute(buildContext());

      expect(result.success).toBe(true);
      expect(result.signals).toHaveLength(0);
    });
  });

  describe('getConfigSchema', () => {
    it('should return valid configuration schema', () => {
      const schema = strategy.getConfigSchema();

      expect(schema).toHaveProperty('rsiPeriod');
      expect(schema).toHaveProperty('rsiOversold');
      expect(schema).toHaveProperty('rsiOverbought');
      expect(schema).toHaveProperty('macdFast');
      expect(schema).toHaveProperty('confirmationWindow');
    });
  });
});
