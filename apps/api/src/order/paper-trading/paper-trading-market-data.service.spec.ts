import { Logger } from '@nestjs/common';

import { PaperTradingMarketDataService, PriceData } from './paper-trading-market-data.service';

import type { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import * as retryUtil from '../../shared/retry.util';

const createService = (overrides: Partial<{ cacheManager: any; exchangeManager: any; config: any }> = {}) => {
  const cacheManager = overrides.cacheManager ?? {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn()
  };

  const exchangeManager = overrides.exchangeManager ?? {
    formatSymbol: jest.fn().mockImplementation((_slug: string, symbol: string) => symbol),
    getExchangeClient: jest.fn(),
    getPublicClient: jest.fn()
  };

  const config = overrides.config ?? { priceCacheTtlMs: 1000 };

  return {
    service: new PaperTradingMarketDataService(config as any, cacheManager, exchangeManager as ExchangeManagerService),
    cacheManager,
    exchangeManager
  };
};

describe('PaperTradingMarketDataService', () => {
  let withRetrySpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    // Spy on withRetry to avoid real delays in tests
    withRetrySpy = jest.spyOn(retryUtil, 'withRetry');
  });

  afterEach(() => {
    withRetrySpy.mockRestore();
  });

  it('returns cached price data when available', async () => {
    const cached = {
      symbol: 'BTC/USD',
      price: 42000,
      timestamp: new Date(),
      source: 'binance'
    };

    const { service, cacheManager, exchangeManager } = createService({
      cacheManager: {
        get: jest.fn().mockResolvedValue(cached),
        set: jest.fn()
      }
    });

    const result = await service.getCurrentPrice('binance', 'BTC/USD');

    expect(result).toBe(cached);
    expect(exchangeManager.getPublicClient).not.toHaveBeenCalled();
    expect(cacheManager.set).not.toHaveBeenCalled();
  });

  it('fetches and caches price data when not cached', async () => {
    const ticker = {
      last: 45000,
      bid: 44950,
      ask: 45050,
      timestamp: 1700000000000
    };

    const client = { fetchTicker: jest.fn().mockResolvedValue(ticker) };

    const cacheManager = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn()
    };

    const exchangeManager = {
      formatSymbol: jest.fn().mockReturnValue('BTC/USDT'),
      getPublicClient: jest.fn().mockResolvedValue(client)
    };

    withRetrySpy.mockResolvedValue({
      success: true,
      result: ticker,
      attempts: 1,
      totalDelayMs: 0
    });

    const { service } = createService({ cacheManager, exchangeManager });

    const result = await service.getCurrentPrice('binance', 'BTC/USDT');

    expect(exchangeManager.formatSymbol).toHaveBeenCalledWith('binance', 'BTC/USDT');
    // Normal cache write
    expect(cacheManager.set).toHaveBeenCalledWith(
      'paper-trading:price:binance:BTC/USDT',
      expect.objectContaining({
        symbol: 'BTC/USDT',
        price: 45000,
        bid: 44950,
        ask: 45050,
        source: 'binance'
      }),
      1000
    );
    // Stale cache write
    expect(cacheManager.set).toHaveBeenCalledWith(
      'paper-trading:price:binance:BTC/USDT:stale',
      expect.objectContaining({ symbol: 'BTC/USDT', price: 45000 }),
      300000
    );
    expect(result.price).toBe(45000);
  });

  it('calculates slippage from order book depth', async () => {
    const { service } = createService();

    jest.spyOn(service, 'getOrderBook').mockResolvedValue({
      symbol: 'BTC/USD',
      bids: [],
      asks: [
        { price: 100, quantity: 1 },
        { price: 110, quantity: 1 }
      ],
      timestamp: new Date()
    });

    const result = await service.calculateRealisticSlippage('binance', 'BTC/USD', 1.5, 'BUY');

    expect(result.estimatedPrice).toBeCloseTo(103.333, 3);
    expect(result.slippageBps).toBeCloseTo(337.333, 3);
    expect(result.marketImpact).toBe(4);
  });

  it('falls back to fixed slippage when order book lookup fails', async () => {
    const loggerSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { service } = createService();

    jest.spyOn(service, 'getOrderBook').mockRejectedValue(new Error('boom'));

    const result = await service.calculateRealisticSlippage('binance', 'BTC/USD', 1, 'BUY');

    expect(result).toEqual({ estimatedPrice: 0, slippageBps: 10, marketImpact: 0 });
    loggerSpy.mockRestore();
  });

  describe('getHistoricalCandles', () => {
    it('returns cached candles when cache hit', async () => {
      const cachedCandles = [
        { avg: 105, high: 110, low: 90, date: new Date(1000), open: 100, close: 105, volume: 500 },
        { avg: 110, high: 115, low: 95, date: new Date(2000), open: 105, close: 110, volume: 600 }
      ];

      const { service, exchangeManager } = createService({
        cacheManager: {
          get: jest.fn().mockResolvedValue(cachedCandles),
          set: jest.fn()
        }
      });

      const result = await service.getHistoricalCandles('binance', 'BTC/USD');

      expect(result).toBe(cachedCandles);
      expect(exchangeManager.getPublicClient).not.toHaveBeenCalled();
    });

    it('fetches and caches candles on cache miss', async () => {
      const rawOHLCV = [
        [1000, 100, 110, 90, 105, 500],
        [2000, 105, 115, 95, 110, 600],
        [3000, 110, 120, 100, 115, 700]
      ];

      const client = {
        fetchOHLCV: jest.fn().mockResolvedValue(rawOHLCV)
      };

      const cacheManager = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn()
      };

      const exchangeManager = {
        formatSymbol: jest.fn().mockReturnValue('BTC/USD'),
        getPublicClient: jest.fn().mockResolvedValue(client)
      };

      const { service } = createService({ cacheManager, exchangeManager });

      const result = await service.getHistoricalCandles('binance', 'BTC/USD', '1h', 100);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(
        expect.objectContaining({ avg: 105, high: 110, low: 90, open: 100, close: 105, volume: 500 })
      );

      // Verify cached with 5-minute TTL
      expect(cacheManager.set).toHaveBeenCalledWith('paper-trading:ohlcv:binance:BTC/USD:1h:public', result, 300000);
    });

    it('returns empty array when fetch throws', async () => {
      const loggerSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const client = {
        fetchOHLCV: jest.fn().mockRejectedValue(new Error('network error'))
      };

      const cacheManager = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn()
      };

      const exchangeManager = {
        formatSymbol: jest.fn().mockReturnValue('BTC/USD'),
        getPublicClient: jest.fn().mockResolvedValue(client)
      };

      const { service } = createService({ cacheManager, exchangeManager });

      const result = await service.getHistoricalCandles('binance', 'BTC/USD');

      expect(result).toEqual([]);
      expect(cacheManager.set).not.toHaveBeenCalled();
      loggerSpy.mockRestore();
    });
  });

  describe('getCurrentPrice retry + stale-cache fallback', () => {
    it('retries on transient error and succeeds on 2nd attempt', async () => {
      const ticker = { last: 45000, bid: 44950, ask: 45050, timestamp: 1700000000000 };

      const client = { fetchTicker: jest.fn() };

      const cacheManager = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn()
      };

      const exchangeManager = {
        formatSymbol: jest.fn().mockReturnValue('BTC/USDT'),
        getPublicClient: jest.fn().mockResolvedValue(client)
      };

      withRetrySpy.mockResolvedValue({
        success: true,
        result: ticker,
        attempts: 2,
        totalDelayMs: 2000
      });

      const { service } = createService({ cacheManager, exchangeManager });
      const result = await service.getCurrentPrice('binance', 'BTC/USDT');

      expect(result.price).toBe(45000);
      expect(withRetrySpy).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          maxRetries: 3,
          initialDelayMs: 2000,
          isRetryable: retryUtil.isTransientError
        })
      );
    });

    it('falls back to stale cache when all retries exhausted', async () => {
      const loggerSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const staleData = {
        symbol: 'BTC/USDT',
        price: 44000,
        bid: 43950,
        ask: 44050,
        timestamp: new Date(),
        source: 'binance'
      };

      const cacheManager = {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'paper-trading:price:binance:BTC/USDT') return Promise.resolve(null);
          if (key === 'paper-trading:price:binance:BTC/USDT:stale') return Promise.resolve(staleData);
          return Promise.resolve(null);
        }),
        set: jest.fn()
      };

      const exchangeManager = {
        formatSymbol: jest.fn().mockReturnValue('BTC/USDT'),
        getPublicClient: jest.fn().mockResolvedValue({ fetchTicker: jest.fn() })
      };

      withRetrySpy.mockResolvedValue({
        success: false,
        error: new Error('ETIMEDOUT'),
        attempts: 4,
        totalDelayMs: 14000
      });

      const { service } = createService({ cacheManager, exchangeManager });
      const result = await service.getCurrentPrice('binance', 'BTC/USDT');

      expect(result.price).toBe(44000);
      expect(result.source).toBe('binance:stale');
      loggerSpy.mockRestore();
    });

    it('throws when retries exhausted AND no stale cache exists', async () => {
      const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      const cacheManager = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn()
      };

      const exchangeManager = {
        formatSymbol: jest.fn().mockReturnValue('BTC/USDT'),
        getPublicClient: jest.fn().mockResolvedValue({ fetchTicker: jest.fn() })
      };

      const timeoutError = new Error('ETIMEDOUT');
      withRetrySpy.mockResolvedValue({
        success: false,
        error: timeoutError,
        attempts: 4,
        totalDelayMs: 14000
      });

      const { service } = createService({ cacheManager, exchangeManager });

      await expect(service.getCurrentPrice('binance', 'BTC/USDT')).rejects.toThrow('ETIMEDOUT');
      loggerSpy.mockRestore();
    });
  });

  describe('getPrices retry + stale-cache fallback', () => {
    it('retries on transient error and succeeds on 2nd attempt', async () => {
      const tickers = {
        'BTC/USDT': { last: 45000, bid: 44950, ask: 45050, timestamp: 1700000000000 },
        'ETH/USDT': { last: 2500, bid: 2490, ask: 2510, timestamp: 1700000000000 }
      };

      const client = { fetchTickers: jest.fn() };

      const cacheManager = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn()
      };

      const exchangeManager = {
        formatSymbol: jest.fn().mockImplementation((_: string, s: string) => s),
        getPublicClient: jest.fn().mockResolvedValue(client)
      };

      withRetrySpy.mockResolvedValue({
        success: true,
        result: tickers,
        attempts: 2,
        totalDelayMs: 2000
      });

      const { service } = createService({ cacheManager, exchangeManager });
      const result = await service.getPrices('binance', ['BTC/USDT', 'ETH/USDT']);

      expect(result.get('BTC/USDT')?.price).toBe(45000);
      expect(result.get('ETH/USDT')?.price).toBe(2500);
      // Each symbol should have both normal + stale cache writes
      expect(cacheManager.set).toHaveBeenCalledTimes(4);
    });

    it('falls back to stale cache when all retries exhausted', async () => {
      const loggerSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const stalebtc = {
        symbol: 'BTC/USDT',
        price: 44000,
        timestamp: new Date(),
        source: 'binance'
      };
      const staleeth = {
        symbol: 'ETH/USDT',
        price: 2400,
        timestamp: new Date(),
        source: 'binance'
      };

      const cacheManager = {
        get: jest.fn().mockImplementation((key: string) => {
          // No normal cache
          if (!key.endsWith(':stale')) return Promise.resolve(null);
          if (key.includes('BTC/USDT')) return Promise.resolve(stalebtc);
          if (key.includes('ETH/USDT')) return Promise.resolve(staleeth);
          return Promise.resolve(null);
        }),
        set: jest.fn()
      };

      const exchangeManager = {
        formatSymbol: jest.fn().mockImplementation((_: string, s: string) => s),
        getPublicClient: jest.fn().mockResolvedValue({ fetchTickers: jest.fn() })
      };

      withRetrySpy.mockResolvedValue({
        success: false,
        error: new Error('ETIMEDOUT'),
        attempts: 4,
        totalDelayMs: 14000
      });

      const { service } = createService({ cacheManager, exchangeManager });
      const result = await service.getPrices('binance', ['BTC/USDT', 'ETH/USDT']);

      expect(result.get('BTC/USDT')?.price).toBe(44000);
      expect(result.get('BTC/USDT')?.source).toBe('binance:stale');
      expect(result.get('ETH/USDT')?.price).toBe(2400);
      expect(result.get('ETH/USDT')?.source).toBe('binance:stale');
      loggerSpy.mockRestore();
    });

    it('throws when retries exhausted AND some symbols have no stale cache', async () => {
      const loggerSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const stalebtc = {
        symbol: 'BTC/USDT',
        price: 44000,
        timestamp: new Date(),
        source: 'binance'
      };

      const cacheManager = {
        get: jest.fn().mockImplementation((key: string) => {
          if (!key.endsWith(':stale')) return Promise.resolve(null);
          if (key.includes('BTC/USDT')) return Promise.resolve(stalebtc);
          // ETH has no stale cache
          return Promise.resolve(null);
        }),
        set: jest.fn()
      };

      const exchangeManager = {
        formatSymbol: jest.fn().mockImplementation((_: string, s: string) => s),
        getPublicClient: jest.fn().mockResolvedValue({ fetchTickers: jest.fn() })
      };

      withRetrySpy.mockResolvedValue({
        success: false,
        error: new Error('ETIMEDOUT'),
        attempts: 4,
        totalDelayMs: 14000
      });

      const { service } = createService({ cacheManager, exchangeManager });

      await expect(service.getPrices('binance', ['BTC/USDT', 'ETH/USDT'])).rejects.toThrow(
        /1 symbol\(s\) have no stale cache fallback/
      );
      loggerSpy.mockRestore();
    });

    it('returns cached symbols without fetching and only fetches uncached', async () => {
      const cachedPrice: PriceData = {
        symbol: 'BTC/USDT',
        price: 44000,
        bid: 43950,
        ask: 44050,
        timestamp: new Date(),
        source: 'binance'
      };

      const tickers = {
        'ETH/USDT': { last: 2500, bid: 2490, ask: 2510, timestamp: 1700000000000 }
      };

      const cacheManager = {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'paper-trading:price:binance:BTC/USDT') return Promise.resolve(cachedPrice);
          return Promise.resolve(null);
        }),
        set: jest.fn()
      };

      const exchangeManager = {
        formatSymbol: jest.fn().mockImplementation((_: string, s: string) => s),
        getPublicClient: jest.fn().mockResolvedValue({ fetchTickers: jest.fn() })
      };

      withRetrySpy.mockResolvedValue({
        success: true,
        result: tickers,
        attempts: 1,
        totalDelayMs: 0
      });

      const { service } = createService({ cacheManager, exchangeManager });
      const result = await service.getPrices('binance', ['BTC/USDT', 'ETH/USDT']);

      expect(result.get('BTC/USDT')).toBe(cachedPrice);
      expect(result.get('ETH/USDT')?.price).toBe(2500);
      // Only ETH should have cache writes (BTC was cached)
      expect(cacheManager.set).toHaveBeenCalledTimes(2);
    });

    it('skips symbols missing from ticker response', async () => {
      const tickers = {
        'BTC/USDT': { last: 45000, bid: 44950, ask: 45050, timestamp: 1700000000000 }
        // ETH/USDT intentionally missing from response
      };

      const cacheManager = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn()
      };

      const exchangeManager = {
        formatSymbol: jest.fn().mockImplementation((_: string, s: string) => s),
        getPublicClient: jest.fn().mockResolvedValue({ fetchTickers: jest.fn() })
      };

      withRetrySpy.mockResolvedValue({
        success: true,
        result: tickers,
        attempts: 1,
        totalDelayMs: 0
      });

      const { service } = createService({ cacheManager, exchangeManager });
      const result = await service.getPrices('binance', ['BTC/USDT', 'ETH/USDT']);

      expect(result.get('BTC/USDT')?.price).toBe(45000);
      expect(result.has('ETH/USDT')).toBe(false);
    });
  });

  describe('getOrderBook', () => {
    it('returns cached order book when available', async () => {
      const cached = {
        symbol: 'BTC/USD',
        bids: [{ price: 100, quantity: 1 }],
        asks: [{ price: 101, quantity: 1 }],
        timestamp: new Date()
      };

      const { service, exchangeManager } = createService({
        cacheManager: {
          get: jest.fn().mockResolvedValue(cached),
          set: jest.fn()
        }
      });

      const result = await service.getOrderBook('binance', 'BTC/USD');

      expect(result).toBe(cached);
      expect(exchangeManager.getPublicClient).not.toHaveBeenCalled();
    });

    it('fetches, maps, and caches order book on cache miss', async () => {
      const rawOrderBook = {
        bids: [
          [100, 5],
          [99, 10]
        ],
        asks: [
          [101, 3],
          [102, 7]
        ],
        timestamp: 1700000000000
      };

      const client = { fetchOrderBook: jest.fn().mockResolvedValue(rawOrderBook) };

      const cacheManager = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn()
      };

      const exchangeManager = {
        formatSymbol: jest.fn().mockReturnValue('BTC/USD'),
        getPublicClient: jest.fn().mockResolvedValue(client)
      };

      const { service } = createService({ cacheManager, exchangeManager });
      const result = await service.getOrderBook('binance', 'BTC/USD', 10);

      expect(client.fetchOrderBook).toHaveBeenCalledWith('BTC/USD', 10);
      expect(result.bids).toEqual([
        { price: 100, quantity: 5 },
        { price: 99, quantity: 10 }
      ]);
      expect(result.asks).toEqual([
        { price: 101, quantity: 3 },
        { price: 102, quantity: 7 }
      ]);
      // Cache TTL capped at min(cacheTtlMs, 2000)
      expect(cacheManager.set).toHaveBeenCalledWith('paper-trading:orderbook:binance:BTC/USD', result, 1000);
    });

    it('throws and logs on fetch failure', async () => {
      const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      const client = { fetchOrderBook: jest.fn().mockRejectedValue(new Error('exchange down')) };

      const cacheManager = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn()
      };

      const exchangeManager = {
        formatSymbol: jest.fn().mockReturnValue('BTC/USD'),
        getPublicClient: jest.fn().mockResolvedValue(client)
      };

      const { service } = createService({ cacheManager, exchangeManager });

      await expect(service.getOrderBook('binance', 'BTC/USD')).rejects.toThrow('exchange down');
      expect(loggerSpy).toHaveBeenCalled();
      loggerSpy.mockRestore();
    });
  });

  describe('calculateRealisticSlippage edge cases', () => {
    it('returns fixed slippage when order book has empty levels', async () => {
      const { service } = createService();

      jest.spyOn(service, 'getOrderBook').mockResolvedValue({
        symbol: 'BTC/USD',
        bids: [],
        asks: [],
        timestamp: new Date()
      });

      const result = await service.calculateRealisticSlippage('binance', 'BTC/USD', 1, 'BUY');

      expect(result).toEqual({ estimatedPrice: 0, slippageBps: 10, marketImpact: 0 });
    });

    it('returns high slippage when quantity exceeds available liquidity', async () => {
      const { service } = createService();

      jest.spyOn(service, 'getOrderBook').mockResolvedValue({
        symbol: 'BTC/USD',
        bids: [{ price: 100, quantity: 0 }],
        asks: [{ price: 101, quantity: 0 }],
        timestamp: new Date()
      });

      const result = await service.calculateRealisticSlippage('binance', 'BTC/USD', 10, 'BUY');

      expect(result.slippageBps).toBe(50);
      expect(result.estimatedPrice).toBe(101);
    });

    it('uses bids for SELL side slippage', async () => {
      const { service } = createService();

      jest.spyOn(service, 'getOrderBook').mockResolvedValue({
        symbol: 'BTC/USD',
        bids: [
          { price: 100, quantity: 2 },
          { price: 90, quantity: 2 }
        ],
        asks: [],
        timestamp: new Date()
      });

      const result = await service.calculateRealisticSlippage('binance', 'BTC/USD', 3, 'SELL');

      // VWAP = (2*100 + 1*90) / 3 = 96.667
      expect(result.estimatedPrice).toBeCloseTo(96.667, 2);
      // Slippage from best bid (100): |96.667 - 100| / 100 * 10000 = 333.33 bps + 4 impact
      expect(result.slippageBps).toBeCloseTo(337.333, 0);
    });
  });

  describe('checkExchangeHealth', () => {
    it('returns healthy with latency when exchange responds', async () => {
      const client = { fetchTime: jest.fn().mockResolvedValue(1700000000000) };

      const exchangeManager = {
        formatSymbol: jest.fn(),
        getPublicClient: jest.fn().mockResolvedValue(client)
      };

      const { service } = createService({ exchangeManager });
      const result = await service.checkExchangeHealth('binance');

      expect(result.healthy).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it('returns unhealthy with error message when exchange fails', async () => {
      const client = { fetchTime: jest.fn().mockRejectedValue(new Error('connection refused')) };

      const exchangeManager = {
        formatSymbol: jest.fn(),
        getPublicClient: jest.fn().mockResolvedValue(client)
      };

      const { service } = createService({ exchangeManager });
      const result = await service.checkExchangeHealth('binance');

      expect(result.healthy).toBe(false);
      expect(result.error).toBe('connection refused');
      expect(result.latencyMs).toBeUndefined();
    });
  });

  describe('clearCache', () => {
    it('deletes price, stale, and orderbook keys for a given symbol', async () => {
      const cacheManager = {
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn()
      };

      const { service } = createService({ cacheManager });
      await service.clearCache('binance', 'BTC/USDT');

      expect(cacheManager.del).toHaveBeenCalledWith('paper-trading:price:binance:BTC/USDT');
      expect(cacheManager.del).toHaveBeenCalledWith('paper-trading:price:binance:BTC/USDT:stale');
      expect(cacheManager.del).toHaveBeenCalledWith('paper-trading:orderbook:binance:BTC/USDT');
    });

    it('does not delete anything when no symbol provided', async () => {
      const cacheManager = {
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn()
      };

      const { service } = createService({ cacheManager });
      await service.clearCache('binance');

      expect(cacheManager.del).not.toHaveBeenCalled();
    });
  });
});
