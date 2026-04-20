import { Logger } from '@nestjs/common';

import { PaperTradingHistoricalCandleService } from './paper-trading-historical-candle.service';

import type { ExchangeManagerService } from '../../../exchange/exchange-manager.service';
import * as retryUtil from '../../../shared/retry.util';

const createService = (
  overrides: Partial<{
    cacheManager: any;
    exchangeManager: any;
    coinService: any;
    ohlcService: any;
    ohlcBackfillService: any;
  }> = {}
) => {
  const cacheManager = overrides.cacheManager ?? {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn()
  };

  const exchangeManager = overrides.exchangeManager ?? {
    formatSymbol: jest.fn().mockImplementation((_slug: string, symbol: string) => symbol),
    getExchangeClient: jest.fn(),
    getPublicClient: jest.fn()
  };

  const coinService = overrides.coinService ?? {
    getCoinBySymbol: jest.fn().mockResolvedValue({ id: 'coin-1' })
  };

  const ohlcService = overrides.ohlcService ?? {
    getCandlesByDateRange: jest.fn().mockResolvedValue([])
  };

  const ohlcBackfillService = overrides.ohlcBackfillService ?? {
    startBackfill: jest.fn().mockResolvedValue('job-1')
  };

  return {
    service: new PaperTradingHistoricalCandleService(
      cacheManager,
      exchangeManager as ExchangeManagerService,
      coinService as any,
      ohlcService as any,
      ohlcBackfillService as any
    ),
    cacheManager,
    exchangeManager,
    coinService,
    ohlcService,
    ohlcBackfillService
  };
};

const makeDbCandle = (tsMs: number, close: number) => ({
  coinId: 'coin-1',
  timestamp: new Date(tsMs),
  open: close - 1,
  high: close + 2,
  low: close - 2,
  close,
  volume: 100
});

const makeExchangeFetcher = (ohlcv: unknown[]) => ({
  formatSymbol: jest.fn().mockReturnValue('BTC/USD'),
  getPublicClient: jest.fn().mockResolvedValue({ fetchOHLCV: jest.fn().mockResolvedValue(ohlcv) }),
  getExchangeClient: jest.fn().mockResolvedValue({ fetchOHLCV: jest.fn().mockResolvedValue(ohlcv) })
});

describe('PaperTradingHistoricalCandleService', () => {
  let withExchangeRetryThrowSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    withExchangeRetryThrowSpy = jest.spyOn(retryUtil, 'withExchangeRetryThrow');
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    withExchangeRetryThrowSpy.mockRestore();
    loggerWarnSpy.mockRestore();
  });

  it('returns cached candles when cache hit (no DB or exchange call)', async () => {
    const cachedCandles = [
      { avg: 105, high: 110, low: 90, date: new Date(1000), open: 100, close: 105, volume: 500 },
      { avg: 110, high: 115, low: 95, date: new Date(2000), open: 105, close: 110, volume: 600 }
    ];

    const { service, exchangeManager, ohlcService, coinService } = createService({
      cacheManager: { get: jest.fn().mockResolvedValue(cachedCandles), set: jest.fn() }
    });

    const result = await service.getHistoricalCandles('binance', 'BTC/USD');

    expect(result).toBe(cachedCandles);
    expect(exchangeManager.getPublicClient).not.toHaveBeenCalled();
    expect(ohlcService.getCandlesByDateRange).not.toHaveBeenCalled();
    expect(coinService.getCoinBySymbol).not.toHaveBeenCalled();
  });

  it('serves from DB when it has >= limit candles (no exchange call, no backfill)', async () => {
    const dbCandles = Array.from({ length: 100 }, (_, i) => makeDbCandle(i * 1000, 100 + i));

    const { service, cacheManager, exchangeManager, ohlcBackfillService, ohlcService, coinService } = createService({
      ohlcService: { getCandlesByDateRange: jest.fn().mockResolvedValue(dbCandles) }
    });

    const result = await service.getHistoricalCandles('binance', 'BTC/USD', '1h', 100);

    expect(result).toHaveLength(100);
    expect(result[0]).toEqual(
      expect.objectContaining({ avg: 100, high: 102, low: 98, open: 99, close: 100, volume: 100 })
    );
    expect(result[99]).toEqual(expect.objectContaining({ avg: 199, close: 199 }));
    expect(coinService.getCoinBySymbol).toHaveBeenCalledWith('BTC', undefined, false);
    expect(ohlcService.getCandlesByDateRange).toHaveBeenCalledTimes(1);
    expect(exchangeManager.getPublicClient).not.toHaveBeenCalled();
    expect(ohlcBackfillService.startBackfill).not.toHaveBeenCalled();
    expect(cacheManager.set).toHaveBeenCalledWith('paper-trading:ohlcv:binance:BTC/USD:1h:100', result, 300000);
  });

  it('returns exactly the most-recent limit candles when DB has more than needed', async () => {
    const dbCandles = Array.from({ length: 80 }, (_, i) => makeDbCandle(i * 1000, i));

    const { service } = createService({
      ohlcService: { getCandlesByDateRange: jest.fn().mockResolvedValue(dbCandles) }
    });

    const result = await service.getHistoricalCandles('binance', 'BTC/USD', '1h', 50);

    expect(result).toHaveLength(50);
    // Most recent 50 — original indexes 30..79 → close 30..79
    expect(result[0].close).toBe(30);
    expect(result[49].close).toBe(79);
  });

  it('falls back to exchange and triggers backfill when DB has < limit candles', async () => {
    const dbCandles = [makeDbCandle(1000, 100), makeDbCandle(2000, 101)]; // only 2 — < limit=10
    const exchangeOhlcv = Array.from({ length: 10 }, (_, i) => [i * 1000, 100 + i, 105 + i, 95 + i, 102 + i, 500]);

    withExchangeRetryThrowSpy.mockResolvedValue(exchangeOhlcv);

    const { service, cacheManager, ohlcBackfillService } = createService({
      ohlcService: { getCandlesByDateRange: jest.fn().mockResolvedValue(dbCandles) },
      exchangeManager: makeExchangeFetcher(exchangeOhlcv)
    });

    const result = await service.getHistoricalCandles('binance', 'BTC/USD', '1h', 10);

    expect(result).toHaveLength(10);
    expect(ohlcBackfillService.startBackfill).toHaveBeenCalledWith('coin-1');
    expect(cacheManager.set).toHaveBeenCalledWith('paper-trading:backfill-triggered:coin-1', true, 6 * 60 * 60 * 1000);
    expect(cacheManager.set).toHaveBeenCalledWith('paper-trading:ohlcv:binance:BTC/USD:1h:10', result, 300000);
  });

  it('uses the authenticated exchange client (not public) when a user is provided', async () => {
    const exchangeOhlcv = Array.from({ length: 10 }, (_, i) => [i * 1000, 100, 105, 95, 102, 500]);
    withExchangeRetryThrowSpy.mockResolvedValue(exchangeOhlcv);

    const { service, exchangeManager } = createService({
      ohlcService: { getCandlesByDateRange: jest.fn().mockResolvedValue([]) },
      exchangeManager: makeExchangeFetcher(exchangeOhlcv)
    });

    await service.getHistoricalCandles('binance', 'BTC/USD', '1h', 10, { id: 'user-1' } as any);

    expect(exchangeManager.getExchangeClient).toHaveBeenCalledWith(
      'binance',
      expect.objectContaining({ id: 'user-1' })
    );
    expect(exchangeManager.getPublicClient).not.toHaveBeenCalled();
  });

  it('dedups backfill triggers within the dedup TTL', async () => {
    const exchangeOhlcv = Array.from({ length: 10 }, (_, i) => [i * 1000, 100, 105, 95, 102, 500]);

    // Dedup cache returns truthy on 2nd call
    let dedupSet = false;
    const cacheManager = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key.startsWith('paper-trading:backfill-triggered:')) {
          return Promise.resolve(dedupSet);
        }
        return Promise.resolve(null);
      }),
      set: jest.fn().mockImplementation((key: string) => {
        if (key.startsWith('paper-trading:backfill-triggered:')) {
          dedupSet = true;
        }
        return Promise.resolve();
      })
    };

    withExchangeRetryThrowSpy.mockResolvedValue(exchangeOhlcv);

    const { service, ohlcBackfillService } = createService({
      cacheManager,
      ohlcService: { getCandlesByDateRange: jest.fn().mockResolvedValue([]) },
      exchangeManager: makeExchangeFetcher(exchangeOhlcv)
    });

    await service.getHistoricalCandles('binance', 'BTC/USD', '1h', 10);
    await service.getHistoricalCandles('binance', 'BTC/USD', '1h', 10);

    expect(ohlcBackfillService.startBackfill).toHaveBeenCalledTimes(1);
  });

  it('emits a threshold warning after 5 exchange fallbacks within the 1-hour window', async () => {
    const exchangeOhlcv = Array.from({ length: 10 }, (_, i) => [i * 1000, 100, 105, 95, 102, 500]);
    withExchangeRetryThrowSpy.mockResolvedValue(exchangeOhlcv);

    const { service } = createService({
      ohlcService: { getCandlesByDateRange: jest.fn().mockResolvedValue([]) },
      exchangeManager: makeExchangeFetcher(exchangeOhlcv)
    });

    for (let i = 0; i < 5; i += 1) {
      await service.getHistoricalCandles('binance', 'BTC/USD', '1h', 10);
    }

    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('hit exchange fallback 5 times in the last hour')
    );
  });

  it('returns partial DB candles when exchange fetch fails and DB has < limit', async () => {
    const dbCandles = [makeDbCandle(1000, 100), makeDbCandle(2000, 101)];

    withExchangeRetryThrowSpy.mockRejectedValue(new Error('network error'));

    const { service, cacheManager } = createService({
      ohlcService: { getCandlesByDateRange: jest.fn().mockResolvedValue(dbCandles) },
      exchangeManager: {
        formatSymbol: jest.fn().mockReturnValue('BTC/USD'),
        getPublicClient: jest.fn().mockResolvedValue({ fetchOHLCV: jest.fn() })
      }
    });

    const result = await service.getHistoricalCandles('binance', 'BTC/USD', '1h', 10);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(
      expect.objectContaining({ avg: 100, high: 102, low: 98, open: 99, close: 100, volume: 100 })
    );
    // Short 60s cache TTL on partial result
    expect(cacheManager.set).toHaveBeenCalledWith('paper-trading:ohlcv:binance:BTC/USD:1h:10', result, 60 * 1000);
  });

  it('continues with empty DB candles when the DB query throws', async () => {
    const exchangeOhlcv = Array.from({ length: 10 }, (_, i) => [i * 1000, 100, 105, 95, 102, 500]);
    withExchangeRetryThrowSpy.mockResolvedValue(exchangeOhlcv);

    const { service, ohlcBackfillService } = createService({
      ohlcService: { getCandlesByDateRange: jest.fn().mockRejectedValue(new Error('db down')) },
      exchangeManager: makeExchangeFetcher(exchangeOhlcv)
    });

    const result = await service.getHistoricalCandles('binance', 'BTC/USD', '1h', 10);

    expect(result).toHaveLength(10);
    expect(ohlcBackfillService.startBackfill).toHaveBeenCalledWith('coin-1');
    expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('DB candle query failed'));
  });

  it('returns partial DB candles when exchange times out (5s race)', async () => {
    jest.useFakeTimers();

    const dbCandles = [makeDbCandle(1000, 100)];

    // Exchange fetch never resolves — Promise.race should lose to the 5s timeout
    withExchangeRetryThrowSpy.mockReturnValue(new Promise(() => undefined));

    const { service } = createService({
      ohlcService: { getCandlesByDateRange: jest.fn().mockResolvedValue(dbCandles) },
      exchangeManager: {
        formatSymbol: jest.fn().mockReturnValue('BTC/USD'),
        getPublicClient: jest.fn().mockResolvedValue({ fetchOHLCV: jest.fn() })
      }
    });

    const promise = service.getHistoricalCandles('binance', 'BTC/USD', '1h', 10);

    // Advance past the timeout
    await jest.advanceTimersByTimeAsync(5001);

    const result = await promise;

    expect(result).toHaveLength(1);
    expect(result[0].close).toBe(100);

    jest.useRealTimers();
  });

  it('cache key is scoped per exchange — binance_us and gdax do not share cached candles', async () => {
    const dbCandles = Array.from({ length: 100 }, (_, i) => makeDbCandle(i * 1000, 100 + i));
    const { service, cacheManager } = createService({
      ohlcService: { getCandlesByDateRange: jest.fn().mockResolvedValue(dbCandles) }
    });

    await service.getHistoricalCandles('binance_us', 'BTC/USDT', '1h', 100);
    await service.getHistoricalCandles('gdax', 'BTC/USDT', '1h', 100);

    const keys = cacheManager.set.mock.calls.map((c: any[]) => c[0]);
    expect(keys).toContain('paper-trading:ohlcv:binance_us:BTC/USDT:1h:100');
    expect(keys).toContain('paper-trading:ohlcv:gdax:BTC/USDT:1h:100');
  });

  it("coerces unsupported timeframe to '1h' for cache key and exchange fetch", async () => {
    const exchangeOhlcv = Array.from({ length: 10 }, (_, i) => [i * 1000, 100, 105, 95, 102, 500]);
    const fetchOHLCV = jest.fn().mockResolvedValue(exchangeOhlcv);

    withExchangeRetryThrowSpy.mockImplementation(async (op: () => Promise<unknown>) => op());

    const { service, cacheManager } = createService({
      ohlcService: { getCandlesByDateRange: jest.fn().mockResolvedValue([]) },
      exchangeManager: {
        formatSymbol: jest.fn().mockReturnValue('BTC/USD'),
        getPublicClient: jest.fn().mockResolvedValue({ fetchOHLCV }),
        getExchangeClient: jest.fn()
      }
    });

    await service.getHistoricalCandles('binance', 'BTC/USD', '15m', 10);

    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("timeframe=15m for BTC/USD; only '1h' is supported. Coercing to '1h'.")
    );
    expect(fetchOHLCV).toHaveBeenCalledWith('BTC/USD', '1h', undefined, 10);
    const keys = cacheManager.set.mock.calls.map((c: any[]) => c[0]);
    expect(keys).toContain('paper-trading:ohlcv:binance:BTC/USD:1h:10');
  });

  it('returns [] when the symbol maps to no coin (no DB, no exchange, no backfill)', async () => {
    const { service, cacheManager, exchangeManager, ohlcBackfillService, ohlcService } = createService({
      coinService: { getCoinBySymbol: jest.fn().mockResolvedValue(null) }
    });

    const result = await service.getHistoricalCandles('binance', 'ZZZ/USD', '1h', 10);

    expect(result).toEqual([]);
    expect(ohlcService.getCandlesByDateRange).not.toHaveBeenCalled();
    expect(exchangeManager.getPublicClient).not.toHaveBeenCalled();
    expect(ohlcBackfillService.startBackfill).not.toHaveBeenCalled();
    expect(cacheManager.set).not.toHaveBeenCalled();
  });
});
