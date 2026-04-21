import { Logger } from '@nestjs/common';

import { PaperTradingMarketDataService, type PriceData } from './paper-trading-market-data.service';

import type { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import type { BatchedTicker } from '../../exchange/ticker-batcher/ticker-batcher.types';
import * as retryUtil from '../../shared/retry.util';

const createCircuitBreaker = (overrides: Partial<Record<string, jest.Mock>> = {}) => ({
  isOpen: jest.fn().mockReturnValue(false),
  recordSuccess: jest.fn(),
  recordFailure: jest.fn(),
  checkCircuit: jest.fn(),
  ...overrides
});

const createService = (
  overrides: Partial<{
    cacheManager: any;
    exchangeManager: any;
    config: any;
    coinSelectionService: any;
    coinService: any;
    circuitBreaker: any;
    tickerBatcher: any;
  }> = {}
) => {
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

  const coinSelectionService = overrides.coinSelectionService ?? {
    getCoinSelectionsByUser: jest.fn().mockResolvedValue([])
  };

  const coinService = overrides.coinService ?? {
    getCoinsByRiskLevel: jest.fn().mockResolvedValue([])
  };

  const circuitBreaker = overrides.circuitBreaker ?? createCircuitBreaker();

  const tickerBatcher = overrides.tickerBatcher ?? {
    getTicker: jest.fn(),
    getTickers: jest.fn()
  };

  return {
    service: new PaperTradingMarketDataService(
      config as any,
      cacheManager,
      exchangeManager as ExchangeManagerService,
      coinSelectionService as any,
      coinService as any,
      circuitBreaker as any,
      tickerBatcher as any
    ),
    cacheManager,
    exchangeManager,
    coinSelectionService,
    coinService,
    circuitBreaker,
    tickerBatcher
  };
};

const mkBatched = (overrides: Partial<BatchedTicker> = {}): BatchedTicker => ({
  symbol: 'BTC/USDT',
  price: 45000,
  bid: 44950,
  ask: 45050,
  timestamp: new Date(1700000000000),
  source: 'binance_us',
  ...overrides
});

describe('PaperTradingMarketDataService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns cached price data when available', async () => {
    const cached = {
      symbol: 'BTC/USD',
      price: 42000,
      timestamp: new Date(),
      source: 'binance'
    };

    const { service, cacheManager, tickerBatcher } = createService({
      cacheManager: {
        get: jest.fn().mockResolvedValue(cached),
        set: jest.fn()
      }
    });

    const result = await service.getCurrentPrice('binance', 'BTC/USD');

    expect(result).toBe(cached);
    expect(tickerBatcher.getTicker).not.toHaveBeenCalled();
    expect(cacheManager.set).not.toHaveBeenCalled();
  });

  it('fetches via batcher and caches price + stale entries on miss', async () => {
    const cacheManager = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    const tickerBatcher = {
      getTicker: jest.fn().mockResolvedValue(mkBatched({ symbol: 'BTC/USDT', price: 45000, source: 'binance' })),
      getTickers: jest.fn()
    };

    const { service } = createService({ cacheManager, tickerBatcher });
    const result = await service.getCurrentPrice('binance', 'BTC/USDT');

    expect(tickerBatcher.getTicker).toHaveBeenCalledWith('binance', 'BTC/USDT');
    expect(cacheManager.set).toHaveBeenCalledWith(
      'paper-trading:price:binance:BTC/USDT',
      expect.objectContaining({ symbol: 'BTC/USDT', price: 45000, source: 'binance' }),
      1000
    );
    expect(cacheManager.set).toHaveBeenCalledWith(
      'paper-trading:price:binance:BTC/USDT:stale',
      expect.objectContaining({ price: 45000 }),
      1800000
    );
    expect(result.price).toBe(45000);
  });

  describe('getCurrentPrice fallback chain', () => {
    it('falls back to stale cache when batcher returns undefined (symbol not on exchange)', async () => {
      const staleData: PriceData = {
        symbol: 'BTC/USDT',
        price: 44000,
        timestamp: new Date(),
        source: 'binance'
      };
      const cacheManager = {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'paper-trading:price:binance:BTC/USDT:stale') return Promise.resolve(staleData);
          return Promise.resolve(null);
        }),
        set: jest.fn()
      };
      const tickerBatcher = { getTicker: jest.fn().mockResolvedValue(undefined), getTickers: jest.fn() };

      const { service } = createService({ cacheManager, tickerBatcher });
      const result = await service.getCurrentPrice('binance', 'BTC/USDT');

      expect(result.price).toBe(44000);
      expect(result.source).toBe('binance:stale');
    });

    it('falls back to alternate exchange when batcher throws and no stale cache exists', async () => {
      const cacheManager = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
      const tickerBatcher = {
        getTicker: jest
          .fn()
          .mockImplementation((slug: string) =>
            slug === 'gdax'
              ? Promise.resolve(mkBatched({ symbol: 'BTC/USD', price: 43500, source: 'gdax' }))
              : Promise.reject(new Error('ETIMEDOUT'))
          ),
        getTickers: jest.fn()
      };

      const { service } = createService({ cacheManager, tickerBatcher });
      const result = await service.getCurrentPrice('binance', 'BTC/USDT');

      expect(result.price).toBe(43500);
      expect(result.source).toBe('gdax:fallback');
      expect(cacheManager.set).toHaveBeenCalledWith(
        'paper-trading:price:binance:BTC/USDT:stale',
        expect.objectContaining({ source: 'gdax:fallback' }),
        1800000
      );
    });

    it('falls back to DB coin price when all exchanges fail via batcher', async () => {
      const cacheManager = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
      const tickerBatcher = {
        getTicker: jest.fn().mockRejectedValue(new Error('ETIMEDOUT')),
        getTickers: jest.fn()
      };
      const coinService = {
        getCoinsByRiskLevel: jest.fn(),
        getCoinBySymbol: jest.fn().mockResolvedValue({ id: 'coin-1', currentPrice: 42000 })
      };

      const { service } = createService({ cacheManager, tickerBatcher, coinService });
      const result = await service.getCurrentPrice('binance', 'BTC/USDT');

      expect(result.price).toBe(42000);
      expect(result.source).toBe('db:coin.currentPrice');
    });

    it('throws when batcher, fallback exchanges, and DB all fail', async () => {
      const cacheManager = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
      const tickerBatcher = {
        getTicker: jest.fn().mockRejectedValue(new Error('ETIMEDOUT')),
        getTickers: jest.fn()
      };
      const coinService = {
        getCoinsByRiskLevel: jest.fn(),
        getCoinBySymbol: jest.fn().mockResolvedValue(null)
      };

      const { service } = createService({ cacheManager, tickerBatcher, coinService });

      await expect(service.getCurrentPrice('binance', 'BTC/USDT')).rejects.toThrow('ETIMEDOUT');
    });

    it('short-circuits to stale cache without hitting the batcher when circuit is open', async () => {
      const stale: PriceData = {
        symbol: 'BTC/USDT',
        price: 44000,
        timestamp: new Date(),
        source: 'binance_us'
      };
      const cacheManager = {
        get: jest.fn().mockImplementation((key: string) => {
          if (key.endsWith(':stale')) return Promise.resolve(stale);
          return Promise.resolve(null);
        }),
        set: jest.fn()
      };
      const tickerBatcher = { getTicker: jest.fn(), getTickers: jest.fn() };
      const circuitBreaker = createCircuitBreaker({ isOpen: jest.fn().mockReturnValue(true) });

      const { service } = createService({ cacheManager, tickerBatcher, circuitBreaker });
      const result = await service.getCurrentPrice('binance_us', 'BTC/USDT');

      expect(result.source).toBe('binance_us:stale');
      expect(tickerBatcher.getTicker).not.toHaveBeenCalled();
    });
  });

  describe('getPrices fallback chain', () => {
    it('delegates to batcher.getTickers and caches each returned price', async () => {
      const cacheManager = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
      const tickerBatcher = {
        getTicker: jest.fn(),
        getTickers: jest.fn().mockResolvedValue(
          new Map<string, BatchedTicker>([
            ['BTC/USDT', mkBatched({ symbol: 'BTC/USDT', price: 45000, source: 'binance' })],
            ['ETH/USDT', mkBatched({ symbol: 'ETH/USDT', price: 2500, source: 'binance' })]
          ])
        )
      };

      const { service } = createService({ cacheManager, tickerBatcher });
      const result = await service.getPrices('binance', ['BTC/USDT', 'ETH/USDT']);

      expect(tickerBatcher.getTickers).toHaveBeenCalledWith('binance', ['BTC/USDT', 'ETH/USDT']);
      expect(result.get('BTC/USDT')?.price).toBe(45000);
      expect(result.get('ETH/USDT')?.price).toBe(2500);
      // Each symbol: normal + stale cache write.
      expect(cacheManager.set).toHaveBeenCalledTimes(4);
    });

    it('returns cached symbols without fetching, and only fetches uncached', async () => {
      const cachedPrice: PriceData = {
        symbol: 'BTC/USDT',
        price: 44000,
        timestamp: new Date(),
        source: 'binance'
      };

      const cacheManager = {
        get: jest
          .fn()
          .mockImplementation((key: string) =>
            key === 'paper-trading:price:binance:BTC/USDT' ? Promise.resolve(cachedPrice) : Promise.resolve(null)
          ),
        set: jest.fn()
      };
      const tickerBatcher = {
        getTicker: jest.fn(),
        getTickers: jest
          .fn()
          .mockResolvedValue(
            new Map<string, BatchedTicker>([
              ['ETH/USDT', mkBatched({ symbol: 'ETH/USDT', price: 2500, source: 'binance' })]
            ])
          )
      };

      const { service } = createService({ cacheManager, tickerBatcher });
      const result = await service.getPrices('binance', ['BTC/USDT', 'ETH/USDT']);

      expect(result.get('BTC/USDT')).toBe(cachedPrice);
      expect(result.get('ETH/USDT')?.price).toBe(2500);
      expect(tickerBatcher.getTickers).toHaveBeenCalledWith('binance', ['ETH/USDT']);
      // Only ETH: normal + stale.
      expect(cacheManager.set).toHaveBeenCalledTimes(2);
    });

    it('silently omits symbols the batcher does not return on successful fetch', async () => {
      const cacheManager = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
      const tickerBatcher = {
        getTicker: jest.fn(),
        getTickers: jest
          .fn()
          .mockResolvedValue(
            new Map<string, BatchedTicker>([
              ['BTC/USDT', mkBatched({ symbol: 'BTC/USDT', price: 45000, source: 'binance' })]
            ])
          )
      };

      const { service } = createService({ cacheManager, tickerBatcher });
      const result = await service.getPrices('binance', ['BTC/USDT', 'ETH/USDT']);

      expect(result.get('BTC/USDT')?.price).toBe(45000);
      expect(result.has('ETH/USDT')).toBe(false);
    });

    it('falls back to stale cache when batcher rejects', async () => {
      const stalebtc: PriceData = { symbol: 'BTC/USDT', price: 44000, timestamp: new Date(), source: 'binance' };
      const staleeth: PriceData = { symbol: 'ETH/USDT', price: 2400, timestamp: new Date(), source: 'binance' };

      const cacheManager = {
        get: jest.fn().mockImplementation((key: string) => {
          if (!key.endsWith(':stale')) return Promise.resolve(null);
          if (key.includes('BTC/USDT')) return Promise.resolve(stalebtc);
          if (key.includes('ETH/USDT')) return Promise.resolve(staleeth);
          return Promise.resolve(null);
        }),
        set: jest.fn()
      };
      const tickerBatcher = {
        getTicker: jest.fn(),
        getTickers: jest.fn().mockRejectedValue(new Error('ETIMEDOUT'))
      };

      const { service } = createService({ cacheManager, tickerBatcher });
      const result = await service.getPrices('binance', ['BTC/USDT', 'ETH/USDT']);

      expect(result.get('BTC/USDT')?.price).toBe(44000);
      expect(result.get('BTC/USDT')?.source).toBe('binance:stale');
      expect(result.get('ETH/USDT')?.price).toBe(2400);
      expect(result.get('ETH/USDT')?.source).toBe('binance:stale');
    });

    it('uses fallback exchange for symbols missing stale cache', async () => {
      const stalebtc: PriceData = { symbol: 'BTC/USDT', price: 44000, timestamp: new Date(), source: 'binance' };
      const cacheManager = {
        get: jest.fn().mockImplementation((key: string) => {
          if (!key.endsWith(':stale')) return Promise.resolve(null);
          if (key.includes('BTC/USDT')) return Promise.resolve(stalebtc);
          return Promise.resolve(null);
        }),
        set: jest.fn()
      };

      const tickerBatcher = {
        getTicker: jest
          .fn()
          .mockImplementation((slug: string) =>
            slug === 'gdax'
              ? Promise.resolve(mkBatched({ symbol: 'ETH/USD', price: 2400, source: 'gdax' }))
              : Promise.resolve(undefined)
          ),
        getTickers: jest.fn().mockRejectedValue(new Error('ETIMEDOUT'))
      };

      const { service } = createService({ cacheManager, tickerBatcher });
      const result = await service.getPrices('binance', ['BTC/USDT', 'ETH/USDT']);

      expect(result.get('BTC/USDT')?.source).toBe('binance:stale');
      expect(result.get('ETH/USDT')?.price).toBe(2400);
      expect(result.get('ETH/USDT')?.source).toBe('gdax:fallback');
    });

    it('throws when batcher rejects and no stale / fallback / DB price exists', async () => {
      const cacheManager = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
      const tickerBatcher = {
        getTicker: jest.fn().mockRejectedValue(new Error('ETIMEDOUT')),
        getTickers: jest.fn().mockRejectedValue(new Error('ETIMEDOUT'))
      };
      const coinService = {
        getCoinsByRiskLevel: jest.fn(),
        getCoinBySymbol: jest.fn().mockResolvedValue(null)
      };

      const { service } = createService({ cacheManager, tickerBatcher, coinService });

      await expect(service.getPrices('binance', ['BTC/USDT', 'ETH/USDT'])).rejects.toThrow(
        /2 symbol\(s\) have no stale cache, fallback exchange, or DB fallback/
      );
    });

    it('short-circuits to stale cache when breaker is open — does not hit the batcher', async () => {
      const stalebtc: PriceData = { symbol: 'BTC/USDT', price: 44000, timestamp: new Date(), source: 'binance_us' };
      const cacheManager = {
        get: jest.fn().mockImplementation((key: string) => {
          if (!key.endsWith(':stale')) return Promise.resolve(null);
          if (key.includes('BTC/USDT')) return Promise.resolve(stalebtc);
          return Promise.resolve(null);
        }),
        set: jest.fn()
      };
      const tickerBatcher = { getTicker: jest.fn(), getTickers: jest.fn() };
      const circuitBreaker = createCircuitBreaker({ isOpen: jest.fn().mockReturnValue(true) });

      const { service } = createService({ cacheManager, tickerBatcher, circuitBreaker });
      const result = await service.getPrices('binance_us', ['BTC/USDT']);

      expect(result.get('BTC/USDT')?.source).toBe('binance_us:stale');
      expect(tickerBatcher.getTickers).not.toHaveBeenCalled();
      expect(circuitBreaker.recordFailure).not.toHaveBeenCalled();
    });
  });

  describe('checkExchangeHealth', () => {
    let withExchangeRetrySpy: jest.SpyInstance;

    beforeEach(() => {
      withExchangeRetrySpy = jest.spyOn(retryUtil, 'withExchangeRetry');
    });

    afterEach(() => {
      withExchangeRetrySpy.mockRestore();
    });

    it('returns healthy with latency when exchange responds', async () => {
      const exchangeManager = {
        formatSymbol: jest.fn(),
        getPublicClient: jest.fn().mockResolvedValue({ fetchTime: jest.fn() })
      };

      jest.spyOn(Date, 'now').mockReturnValueOnce(1_000_000).mockReturnValueOnce(1_000_042);

      withExchangeRetrySpy.mockResolvedValue({ success: true, result: 1700000000000, attempts: 1, totalDelayMs: 0 });

      const { service } = createService({ exchangeManager });
      const result = await service.checkExchangeHealth('binance');

      expect(result.healthy).toBe(true);
      expect(result.latencyMs).toBe(42);
      expect(result.error).toBeUndefined();
    });

    it('returns unhealthy when retry wrapper reports failure', async () => {
      const exchangeManager = {
        formatSymbol: jest.fn(),
        getPublicClient: jest.fn().mockResolvedValue({ fetchTime: jest.fn() })
      };

      withExchangeRetrySpy.mockResolvedValue({
        success: false,
        error: new Error('connection refused'),
        attempts: 4,
        totalDelayMs: 14000
      });

      const { service } = createService({ exchangeManager });
      const result = await service.checkExchangeHealth('binance');

      expect(result.healthy).toBe(false);
      expect(result.error).toBe('connection refused');
    });

    it('returns unhealthy when getPublicClient throws', async () => {
      const exchangeManager = {
        formatSymbol: jest.fn(),
        getPublicClient: jest.fn().mockRejectedValue(new Error('no such exchange'))
      };

      const { service } = createService({ exchangeManager });
      const result = await service.checkExchangeHealth('binance');

      expect(result.healthy).toBe(false);
      expect(result.error).toBe('no such exchange');
    });
  });

  describe('resolveSymbolUniverse', () => {
    const makeSession = (id = 'sess-1', userId = 'user-1'): any => ({ id, user: { id: userId } });

    it('returns coin selection symbols and caches them', async () => {
      const coinSelectionService = {
        getCoinSelectionsByUser: jest.fn().mockResolvedValue([{ coin: { symbol: 'btc' } }, { coin: { symbol: 'eth' } }])
      };
      const { service, coinSelectionService: mockCs } = createService({ coinSelectionService });
      const session = makeSession();

      const result = await service.resolveSymbolUniverse(session, 'USD');

      expect(result).toEqual(['BTC/USD', 'ETH/USD']);
      expect(mockCs.getCoinSelectionsByUser).toHaveBeenCalledTimes(1);

      await service.resolveSymbolUniverse(session, 'USD');
      expect(mockCs.getCoinSelectionsByUser).toHaveBeenCalledTimes(1);
    });

    it('falls back to risk-level coins when selections empty', async () => {
      const coinSelectionService = { getCoinSelectionsByUser: jest.fn().mockResolvedValue([]) };
      const coinService = { getCoinsByRiskLevel: jest.fn().mockResolvedValue([{ symbol: 'sol' }, { symbol: 'dot' }]) };
      const { service } = createService({ coinSelectionService, coinService });

      const result = await service.resolveSymbolUniverse(makeSession(), 'USD');

      expect(result).toEqual(['SOL/USD', 'DOT/USD']);
    });

    it('re-queries after cache TTL expires', async () => {
      let fakeNow = 1_000_000;
      jest.spyOn(Date, 'now').mockImplementation(() => fakeNow);

      const coinSelectionService = {
        getCoinSelectionsByUser: jest.fn().mockResolvedValue([{ coin: { symbol: 'btc' } }])
      };
      const { service, coinSelectionService: mockCs } = createService({ coinSelectionService });
      const session = makeSession();

      await service.resolveSymbolUniverse(session, 'USD');
      fakeNow += 5 * 60 * 1000 + 1;
      await service.resolveSymbolUniverse(session, 'USD');

      expect(mockCs.getCoinSelectionsByUser).toHaveBeenCalledTimes(2);
    });

    it('does not cache the BTC/ETH fallback — re-queries DB on every tick', async () => {
      const coinSelectionService = { getCoinSelectionsByUser: jest.fn().mockResolvedValue([]) };
      const coinService = { getCoinsByRiskLevel: jest.fn().mockResolvedValue([]) };
      const {
        service,
        coinSelectionService: mockCs,
        coinService: mockCv
      } = createService({
        coinSelectionService,
        coinService
      });
      const session = makeSession('s-x', 'u-99');

      const result = await service.resolveSymbolUniverse(session, 'USD');
      await service.resolveSymbolUniverse(session, 'USD');

      expect(result).toEqual(['BTC/USD', 'ETH/USD']);
      expect(mockCs.getCoinSelectionsByUser).toHaveBeenCalledTimes(2);
      expect(mockCv.getCoinsByRiskLevel).toHaveBeenCalledTimes(2);
    });

    it('clearSymbolCache removes the cached entry so next call re-queries', async () => {
      const coinSelectionService = {
        getCoinSelectionsByUser: jest.fn().mockResolvedValue([{ coin: { symbol: 'btc' } }])
      };
      const { service, coinSelectionService: mockCs } = createService({ coinSelectionService });
      const session = makeSession();

      await service.resolveSymbolUniverse(session, 'USD');
      service.clearSymbolCache(session.id);
      await service.resolveSymbolUniverse(session, 'USD');

      expect(mockCs.getCoinSelectionsByUser).toHaveBeenCalledTimes(2);
    });

    it('returns BTC/ETH fallback when session.user is null', async () => {
      const { service, coinSelectionService: mockCs } = createService();
      const session = { id: 'sess-no-user', user: null } as any;

      const result = await service.resolveSymbolUniverse(session, 'USD');

      expect(result).toEqual(['BTC/USD', 'ETH/USD']);
      expect(mockCs.getCoinSelectionsByUser).not.toHaveBeenCalled();
    });

    it('falls through to risk-level coins when coin selection service throws', async () => {
      const coinSelectionService = {
        getCoinSelectionsByUser: jest.fn().mockRejectedValue(new Error('DB connection lost'))
      };
      const coinService = { getCoinsByRiskLevel: jest.fn().mockResolvedValue([{ symbol: 'sol' }]) };
      const { service } = createService({ coinSelectionService, coinService });

      const result = await service.resolveSymbolUniverse(makeSession(), 'USD');
      expect(result).toEqual(['SOL/USD']);
    });

    it('returns BTC/ETH fallback when both services throw', async () => {
      const coinSelectionService = { getCoinSelectionsByUser: jest.fn().mockRejectedValue(new Error('DB down')) };
      const coinService = { getCoinsByRiskLevel: jest.fn().mockRejectedValue(new Error('DB down')) };
      const { service } = createService({ coinSelectionService, coinService });

      const result = await service.resolveSymbolUniverse(makeSession(), 'USD');
      expect(result).toEqual(['BTC/USD', 'ETH/USD']);
    });
  });

  describe('sweepOrphaned', () => {
    const makeSession = (id: string): any => ({ id, user: { id: 'u-1' } });

    it('removes cached entries for sessions not in active set', async () => {
      const coinSelectionService = {
        getCoinSelectionsByUser: jest.fn().mockResolvedValue([{ coin: { symbol: 'btc' } }])
      };
      const { service } = createService({ coinSelectionService });

      await service.resolveSymbolUniverse(makeSession('s-1'), 'USD');
      await service.resolveSymbolUniverse(makeSession('s-2'), 'USD');
      await service.resolveSymbolUniverse(makeSession('s-3'), 'USD');

      const swept = service.sweepOrphaned(new Set(['s-2']));
      expect(swept).toBe(2);

      coinSelectionService.getCoinSelectionsByUser.mockClear();
      await service.resolveSymbolUniverse(makeSession('s-2'), 'USD');
      expect(coinSelectionService.getCoinSelectionsByUser).not.toHaveBeenCalled();

      await service.resolveSymbolUniverse(makeSession('s-1'), 'USD');
      expect(coinSelectionService.getCoinSelectionsByUser).toHaveBeenCalledTimes(1);
    });

    it('returns 0 when all sessions are active', async () => {
      const coinSelectionService = {
        getCoinSelectionsByUser: jest.fn().mockResolvedValue([{ coin: { symbol: 'btc' } }])
      };
      const { service } = createService({ coinSelectionService });

      await service.resolveSymbolUniverse(makeSession('s-1'), 'USD');
      expect(service.sweepOrphaned(new Set(['s-1']))).toBe(0);
    });
  });

  describe('clearCache', () => {
    it('deletes price, stale, and orderbook keys for a given symbol', async () => {
      const cacheManager = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
      const { service } = createService({ cacheManager });
      await service.clearCache('binance', 'BTC/USDT');

      expect(cacheManager.del).toHaveBeenCalledWith('paper-trading:price:binance:BTC/USDT');
      expect(cacheManager.del).toHaveBeenCalledWith('paper-trading:price:binance:BTC/USDT:stale');
      expect(cacheManager.del).toHaveBeenCalledWith('paper-trading:orderbook:binance:BTC/USDT');
    });

    it('does not delete anything when no symbol provided', async () => {
      const cacheManager = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
      const { service } = createService({ cacheManager });
      await service.clearCache('binance');

      expect(cacheManager.del).not.toHaveBeenCalled();
    });
  });
});
