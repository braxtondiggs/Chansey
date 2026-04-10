import { PriceWindowService } from './price-window.service';

import { OHLCCandle } from '../../../../ohlc/ohlc-candle.entity';
import { IncrementalSma } from '../../incremental-sma';

describe('PriceWindowService', () => {
  let service: PriceWindowService;

  beforeEach(() => {
    service = new PriceWindowService();
  });

  const makeCandle = (coinId: string, ts: number, close = 100): OHLCCandle =>
    new OHLCCandle({
      coinId,
      timestamp: new Date(ts),
      open: close - 5,
      high: close + 10,
      low: close - 10,
      close,
      volume: 1000
    });

  describe('buildPriceSummary', () => {
    it('maps candle fields to PriceSummary with close as avg', () => {
      const candle = makeCandle('btc', 1000, 50000);
      const summary = service.buildPriceSummary(candle);
      expect(summary).toEqual({
        avg: 50000,
        coin: 'btc',
        date: new Date(1000),
        high: 50010,
        low: 49990
      });
    });
  });

  describe('initPriceTracking', () => {
    it('groups, sorts, and initializes tracking context for multiple coins', () => {
      const candles = [makeCandle('btc', 2000), makeCandle('btc', 1000), makeCandle('eth', 1500)];
      const ctx = service.initPriceTracking(candles, ['btc', 'eth']);

      expect(ctx.timestampsByCoin.get('btc')).toHaveLength(2);
      expect(ctx.timestampsByCoin.get('btc')?.[0].getTime()).toBe(1000); // sorted ascending
      expect(ctx.timestampsByCoin.get('btc')?.[1].getTime()).toBe(2000);
      expect(ctx.timestampsByCoin.get('eth')).toHaveLength(1);
      expect(ctx.indexByCoin.get('btc')).toBe(-1);
      expect(ctx.indexByCoin.get('eth')).toBe(-1);
      expect(ctx.windowsByCoin.get('btc')).toBeDefined();
      expect(ctx.windowsByCoin.get('eth')).toBeDefined();
    });

    it('initializes empty arrays for coins with no candle data', () => {
      const ctx = service.initPriceTracking([], ['btc']);
      expect(ctx.timestampsByCoin.get('btc')).toEqual([]);
      expect(ctx.summariesByCoin.get('btc')).toEqual([]);
      expect(ctx.indexByCoin.get('btc')).toBe(-1);
    });
  });

  describe('buildImmutablePriceData', () => {
    it('builds data without mutable tracking state', () => {
      const candles = [makeCandle('btc', 2000), makeCandle('btc', 1000)];
      const data = service.buildImmutablePriceData(candles, ['btc']);
      expect(data.timestampsByCoin.get('btc')).toHaveLength(2);
      expect(data.timestampsByCoin.get('btc')?.[0].getTime()).toBe(1000); // sorted
      expect(data.summariesByCoin.get('btc')).toHaveLength(2);
      expect((data as any).indexByCoin).toBeUndefined();
      expect((data as any).windowsByCoin).toBeUndefined();
    });
  });

  describe('initPriceTrackingFromPrecomputed', () => {
    it('creates fresh mutable state sharing immutable references', () => {
      const immutable = service.buildImmutablePriceData([makeCandle('btc', 1000)], ['btc']);
      const ctx = service.initPriceTrackingFromPrecomputed(immutable);
      expect(ctx.indexByCoin.get('btc')).toBe(-1);
      expect(ctx.windowsByCoin.get('btc')).toBeDefined();
      expect(ctx.timestampsByCoin).toBe(immutable.timestampsByCoin); // shared ref
      expect(ctx.summariesByCoin).toBe(immutable.summariesByCoin); // shared ref
    });
  });

  describe('advancePriceWindows', () => {
    it('advances windows up to given timestamp inclusively', () => {
      const candles = [makeCandle('btc', 1000, 100), makeCandle('btc', 2000, 200), makeCandle('btc', 3000, 300)];
      const ctx = service.initPriceTracking(candles, ['btc']);
      const coins = [{ id: 'btc' }] as any[];

      const result = service.advancePriceWindows(ctx, coins, new Date(2000));
      expect(result['btc']).toHaveLength(2);
      expect(result['btc'][0].avg).toBe(100);
      expect(result['btc'][1].avg).toBe(200);
      expect(ctx.indexByCoin.get('btc')).toBe(1);
    });

    it('does not advance past the given timestamp', () => {
      const candles = [makeCandle('btc', 1000), makeCandle('btc', 3000)];
      const ctx = service.initPriceTracking(candles, ['btc']);
      const coins = [{ id: 'btc' }] as any[];

      const result = service.advancePriceWindows(ctx, coins, new Date(2000));
      expect(result['btc']).toHaveLength(1);
      expect(ctx.indexByCoin.get('btc')).toBe(0);
    });

    it('skips coins not present in windowsByCoin', () => {
      const candles = [makeCandle('btc', 1000)];
      const ctx = service.initPriceTracking(candles, ['btc']);
      const coins = [{ id: 'btc' }, { id: 'unknown' }] as any[];

      const result = service.advancePriceWindows(ctx, coins, new Date(2000));
      expect(result['btc']).toHaveLength(1);
      expect(result['unknown']).toBeUndefined();
    });

    it('pushes BTC close price to btcRegimeSma when configured', () => {
      const candles = [makeCandle('btc', 1000, 50000), makeCandle('btc', 2000, 51000)];
      const ctx = service.initPriceTracking(candles, ['btc']);
      ctx.btcCoinId = 'btc';
      ctx.btcRegimeSma = new IncrementalSma(200);
      const coins = [{ id: 'btc' }] as any[];

      service.advancePriceWindows(ctx, coins, new Date(2000));
      // SMA should reflect average of two pushed close prices
      expect(ctx.btcRegimeSma.value).toBe((50000 + 51000) / 2);
    });

    it('excludes coin from result when window remains empty', () => {
      const candles = [makeCandle('btc', 5000)];
      const ctx = service.initPriceTracking(candles, ['btc']);
      const coins = [{ id: 'btc' }] as any[];

      const result = service.advancePriceWindows(ctx, coins, new Date(1000));
      expect(result['btc']).toBeUndefined();
    });
  });

  describe('clearPriceData', () => {
    it('clears all data structures including BTC regime fields', () => {
      const candles = [makeCandle('btc', 1000)];
      const pricesByTimestamp: Record<string, OHLCCandle[]> = { '2024-01-01': candles };
      const ctx = service.initPriceTracking(candles, ['btc']);
      ctx.btcCoinId = 'btc';
      ctx.btcRegimeSma = new IncrementalSma(200);

      service.clearPriceData(pricesByTimestamp, ctx);
      expect(Object.keys(pricesByTimestamp)).toHaveLength(0);
      expect(ctx.timestampsByCoin.size).toBe(0);
      expect(ctx.summariesByCoin.size).toBe(0);
      expect(ctx.windowsByCoin.size).toBe(0);
      expect(ctx.indexByCoin.size).toBe(0);
      expect(ctx.btcRegimeSma).toBeUndefined();
      expect(ctx.btcCoinId).toBeUndefined();
    });
  });

  describe('groupPricesByTimestamp', () => {
    it('groups candles by ISO timestamp string', () => {
      const ts = new Date('2024-01-01T00:00:00Z');
      const candles = [
        new OHLCCandle({ coinId: 'btc', timestamp: ts, open: 1, high: 2, low: 0, close: 1, volume: 1 }),
        new OHLCCandle({ coinId: 'eth', timestamp: ts, open: 1, high: 2, low: 0, close: 1, volume: 1 })
      ];
      const grouped = service.groupPricesByTimestamp(candles);
      expect(grouped[ts.toISOString()]).toHaveLength(2);
    });
  });

  describe('filterCoinsWithSufficientData', () => {
    const mockRegistry = {
      getStrategyForAlgorithm: jest.fn()
    };

    const makeCoins = (...ids: string[]) => ids.map((id) => ({ id, symbol: id.toUpperCase() })) as any[];

    it('returns all coins when strategy has no getMinDataPoints', async () => {
      mockRegistry.getStrategyForAlgorithm.mockResolvedValue({});
      const coins = makeCoins('btc');
      const result = await service.filterCoinsWithSufficientData('alg1', coins, {}, new Map(), mockRegistry);
      expect(result).toEqual({ filtered: coins, excludedCount: 0 });
    });

    it('returns all coins when minRequired is 0', async () => {
      mockRegistry.getStrategyForAlgorithm.mockResolvedValue({
        getMinDataPoints: () => 0
      });
      const coins = makeCoins('btc');
      const result = await service.filterCoinsWithSufficientData('alg1', coins, {}, new Map(), mockRegistry);
      expect(result).toEqual({ filtered: coins, excludedCount: 0 });
    });

    it('filters coins with insufficient data points', async () => {
      mockRegistry.getStrategyForAlgorithm.mockResolvedValue({
        getMinDataPoints: () => 100
      });
      const summaries = new Map<string, any[]>();
      summaries.set('btc', new Array(200));
      summaries.set('eth', new Array(50));
      const coins = makeCoins('btc', 'eth');

      const result = await service.filterCoinsWithSufficientData('alg1', coins, {}, summaries, mockRegistry);
      expect(result.filtered).toHaveLength(1);
      expect(result.filtered[0].id).toBe('btc');
      expect(result.excludedCount).toBe(1);
    });
  });
});
