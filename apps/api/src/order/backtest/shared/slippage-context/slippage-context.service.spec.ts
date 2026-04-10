import { SlippageContextService } from './slippage-context.service';

import { type OHLCCandle } from '../../../../ohlc/ohlc-candle.entity';

describe('SlippageContextService', () => {
  let service: SlippageContextService;

  beforeEach(() => {
    service = new SlippageContextService();
  });

  const makeCandle = (overrides: Partial<OHLCCandle> = {}): OHLCCandle => {
    return {
      id: 'candle-1',
      coinId: 'coin-1',
      exchangeId: 'exchange-1',
      timestamp: new Date('2024-01-01'),
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 1000,
      quoteVolume: null,
      createdAt: new Date(),
      ...overrides
    } as OHLCCandle;
  };

  describe('extractDailyVolume', () => {
    it('should return quoteVolume when available', () => {
      const candles = [makeCandle({ quoteVolume: 50000 })];
      expect(service.extractDailyVolume(candles, 'coin-1')).toBe(50000);
    });

    it('should return volume * close as fallback', () => {
      const candles = [makeCandle({ quoteVolume: undefined, volume: 1000, close: 105 })];
      expect(service.extractDailyVolume(candles, 'coin-1')).toBe(105000);
    });

    it('should return undefined for missing coin', () => {
      const candles = [makeCandle({ coinId: 'coin-1' })];
      expect(service.extractDailyVolume(candles, 'coin-999')).toBeUndefined();
    });
  });

  describe('buildSpreadContext', () => {
    it('should return undefined when no candle found', () => {
      const candles = [makeCandle({ coinId: 'coin-1' })];
      const prevMap = new Map<string, OHLCCandle>();
      expect(service.buildSpreadContext(candles, 'coin-999', prevMap)).toBeUndefined();
    });

    it('should return undefined for invalid OHLC data (high <= low)', () => {
      const candles = [makeCandle({ high: 90, low: 90, close: 90 })];
      const prevMap = new Map<string, OHLCCandle>();
      expect(service.buildSpreadContext(candles, 'coin-1', prevMap)).toBeUndefined();
    });

    it('should return undefined when high is zero', () => {
      const candles = [makeCandle({ high: 0, low: 0, close: 0 })];
      const prevMap = new Map<string, OHLCCandle>();
      expect(service.buildSpreadContext(candles, 'coin-1', prevMap)).toBeUndefined();
    });

    it('should include prevHigh/prevLow from previous candle', () => {
      const candles = [makeCandle()];
      const prevCandle = makeCandle({ high: 108, low: 88 });
      const prevMap = new Map<string, OHLCCandle>([['coin-1', prevCandle]]);

      const result = service.buildSpreadContext(candles, 'coin-1', prevMap);
      expect(result).toEqual({
        high: 110,
        low: 90,
        close: 105,
        volume: 1000,
        prevHigh: 108,
        prevLow: 88
      });
    });

    it('should set prevHigh/prevLow to undefined when no previous candle', () => {
      const candles = [makeCandle()];
      const prevMap = new Map<string, OHLCCandle>();

      const result = service.buildSpreadContext(candles, 'coin-1', prevMap);
      expect(result).toEqual({
        high: 110,
        low: 90,
        close: 105,
        volume: 1000,
        prevHigh: undefined,
        prevLow: undefined
      });
    });

    it('should set prevHigh to undefined when previous high is not finite', () => {
      const candles = [makeCandle()];
      const prevCandle = makeCandle({ high: NaN, low: 88 });
      const prevMap = new Map<string, OHLCCandle>([['coin-1', prevCandle]]);

      const result = service.buildSpreadContext(candles, 'coin-1', prevMap);
      expect(result?.prevHigh).toBeUndefined();
      expect(result?.prevLow).toBe(88);
    });

    it('should set prevLow to undefined when previous low is not finite', () => {
      const candles = [makeCandle()];
      const prevCandle = makeCandle({ high: 108, low: Infinity });
      const prevMap = new Map<string, OHLCCandle>([['coin-1', prevCandle]]);

      const result = service.buildSpreadContext(candles, 'coin-1', prevMap);
      expect(result?.prevHigh).toBe(108);
      expect(result?.prevLow).toBeUndefined();
    });
  });

  describe('updatePrevCandleMap', () => {
    it('should update the map correctly', () => {
      const prevMap = new Map<string, OHLCCandle>();
      const candle1 = makeCandle({ coinId: 'coin-1' });
      const candle2 = makeCandle({ coinId: 'coin-2', high: 200, low: 180, close: 190 });

      service.updatePrevCandleMap(prevMap, [candle1, candle2]);

      expect(prevMap.size).toBe(2);
      expect(prevMap.get('coin-1')).toBe(candle1);
      expect(prevMap.get('coin-2')).toBe(candle2);
    });

    it('should overwrite existing entries', () => {
      const oldCandle = makeCandle({ coinId: 'coin-1', close: 100 });
      const newCandle = makeCandle({ coinId: 'coin-1', close: 200 });
      const prevMap = new Map<string, OHLCCandle>([['coin-1', oldCandle]]);

      service.updatePrevCandleMap(prevMap, [newCandle]);

      expect(prevMap.get('coin-1')).toBe(newCandle);
    });
  });

  describe('getParticipationDefaults', () => {
    it.each([
      [1, 0.02, 0.25],
      [2, 0.03, 0.3],
      [3, 0.05, 0.5],
      [4, 0.08, 0.6],
      [5, 0.1, 0.75]
    ])('should return correct values for risk level %i', (level, participationRateLimit, rejectParticipationRate) => {
      expect(service.getParticipationDefaults(level)).toEqual({
        participationRateLimit,
        rejectParticipationRate
      });
    });

    it('should clamp risk level below 1 to level 1', () => {
      const result = service.getParticipationDefaults(0);
      expect(result).toEqual({ participationRateLimit: 0.02, rejectParticipationRate: 0.25 });
    });

    it('should clamp risk level above 5 to level 5', () => {
      const result = service.getParticipationDefaults(10);
      expect(result).toEqual({ participationRateLimit: 0.1, rejectParticipationRate: 0.75 });
    });

    it('should default to risk level 3 when riskLevel is null/undefined', () => {
      const result = service.getParticipationDefaults(undefined as unknown as number);
      expect(result).toEqual({ participationRateLimit: 0.05, rejectParticipationRate: 0.5 });
    });
  });
});
