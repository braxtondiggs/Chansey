import { Logger } from '@nestjs/common';

import { TickerBatcherService } from './ticker-batcher.service';

import { CircuitOpenError } from '../../shared/circuit-breaker.service';
import type { CircuitBreakerService } from '../../shared/circuit-breaker.service';
import type { ExchangeManagerService } from '../exchange-manager.service';

const DEFAULT_CONFIG = {
  flushMs: 50,
  maxBatchSize: 100,
  memCacheTtlMs: 550
};

const createCircuitBreaker = (overrides: Partial<Record<string, jest.Mock>> = {}) => ({
  isOpen: jest.fn().mockReturnValue(false),
  recordSuccess: jest.fn(),
  recordFailure: jest.fn(),
  checkCircuit: jest.fn(),
  ...overrides
});

const createExchangeManager = (client: unknown) => ({
  getPublicClient: jest.fn().mockResolvedValue(client),
  formatSymbol: jest.fn().mockImplementation((_slug: string, sym: string) => sym)
});

const baseTicker = (overrides: Partial<Record<string, unknown>> = {}) => ({
  last: 45000,
  bid: 44950,
  ask: 45050,
  high: 45500,
  low: 44000,
  change: 100,
  percentage: 0.22,
  baseVolume: 1000,
  quoteVolume: 45000000,
  timestamp: 1700000000000,
  ...overrides
});

const makeService = (
  overrides: Partial<{
    config: typeof DEFAULT_CONFIG;
    exchangeManager: any;
    circuitBreaker: any;
  }> = {}
) => {
  const config = overrides.config ?? DEFAULT_CONFIG;
  const exchangeManager = overrides.exchangeManager ?? createExchangeManager({});
  const circuitBreaker = overrides.circuitBreaker ?? createCircuitBreaker();

  const service = new TickerBatcherService(
    config as any,
    exchangeManager as ExchangeManagerService,
    circuitBreaker as unknown as CircuitBreakerService
  );

  return { service, config, exchangeManager, circuitBreaker };
};

describe('TickerBatcherService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('coalesces concurrent callers for the same symbol into a single exchange call', async () => {
    const tickers = { 'BTC/USDT': baseTicker({ last: 42000 }) };
    const fetchTickers = jest.fn().mockResolvedValue(tickers);
    const client = {
      markets: { 'BTC/USDT': {} },
      loadMarkets: jest.fn().mockResolvedValue(undefined),
      fetchTickers
    };

    const { service } = makeService({ exchangeManager: createExchangeManager(client) });

    const p1 = service.getTicker('binance_us', 'BTC/USDT');
    const p2 = service.getTicker('binance_us', 'BTC/USDT');

    await jest.advanceTimersByTimeAsync(DEFAULT_CONFIG.flushMs + 1);

    const [t1, t2] = await Promise.all([p1, p2]);
    expect(t1?.price).toBe(42000);
    expect(t2?.price).toBe(42000);
    expect(fetchTickers).toHaveBeenCalledTimes(1);
    expect(fetchTickers).toHaveBeenCalledWith(['BTC/USDT']);
  });

  it('batches distinct symbols enqueued in the same flush window into one call', async () => {
    const tickers = {
      'BTC/USDT': baseTicker({ last: 42000 }),
      'ETH/USDT': baseTicker({ last: 2500 }),
      'SOL/USDT': baseTicker({ last: 100 })
    };
    const fetchTickers = jest.fn().mockResolvedValue(tickers);
    const client = {
      markets: { 'BTC/USDT': {}, 'ETH/USDT': {}, 'SOL/USDT': {} },
      loadMarkets: jest.fn().mockResolvedValue(undefined),
      fetchTickers
    };
    const { service } = makeService({ exchangeManager: createExchangeManager(client) });

    const pending = Promise.all([
      service.getTicker('binance_us', 'BTC/USDT'),
      service.getTicker('binance_us', 'ETH/USDT'),
      service.getTicker('binance_us', 'SOL/USDT')
    ]);

    await jest.advanceTimersByTimeAsync(DEFAULT_CONFIG.flushMs + 1);
    const [btc, eth, sol] = await pending;

    expect(btc?.price).toBe(42000);
    expect(eth?.price).toBe(2500);
    expect(sol?.price).toBe(100);
    expect(fetchTickers).toHaveBeenCalledTimes(1);
    expect(fetchTickers).toHaveBeenCalledWith(expect.arrayContaining(['BTC/USDT', 'ETH/USDT', 'SOL/USDT']));
  });

  it('flushes immediately when pending reaches maxBatchSize', async () => {
    const config = { ...DEFAULT_CONFIG, maxBatchSize: 3 };
    const tickers = {
      'A/USDT': baseTicker({ last: 1 }),
      'B/USDT': baseTicker({ last: 2 }),
      'C/USDT': baseTicker({ last: 3 })
    };
    const fetchTickers = jest.fn().mockResolvedValue(tickers);
    const client = {
      markets: { 'A/USDT': {}, 'B/USDT': {}, 'C/USDT': {} },
      loadMarkets: jest.fn().mockResolvedValue(undefined),
      fetchTickers
    };
    const { service } = makeService({ config, exchangeManager: createExchangeManager(client) });

    const pending = Promise.all([
      service.getTicker('binance_us', 'A/USDT'),
      service.getTicker('binance_us', 'B/USDT'),
      service.getTicker('binance_us', 'C/USDT')
    ]);

    // Do NOT advance timers — max-size trip should flush synchronously.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const results = await pending;

    expect(results.every((t) => t != null)).toBe(true);
    expect(fetchTickers).toHaveBeenCalledTimes(1);
  });

  it('serves a symbol from memCache within TTL without hitting the exchange', async () => {
    const tickers = { 'BTC/USDT': baseTicker({ last: 42000 }) };
    const fetchTickers = jest.fn().mockResolvedValue(tickers);
    const client = {
      markets: { 'BTC/USDT': {} },
      loadMarkets: jest.fn().mockResolvedValue(undefined),
      fetchTickers
    };
    const { service } = makeService({ exchangeManager: createExchangeManager(client) });

    // First fetch populates the memCache.
    const first = service.getTicker('binance_us', 'BTC/USDT');
    await jest.advanceTimersByTimeAsync(DEFAULT_CONFIG.flushMs + 1);
    await first;

    fetchTickers.mockClear();

    // Second call (within TTL) bypasses exchange entirely.
    const cached = await service.getTicker('binance_us', 'BTC/USDT');

    expect(cached?.price).toBe(42000);
    expect(fetchTickers).not.toHaveBeenCalled();
  });

  it('rejects all pending callers with CircuitOpenError when circuit is open at flush time', async () => {
    const circuitBreaker = createCircuitBreaker({
      checkCircuit: jest.fn().mockImplementation(() => {
        throw new CircuitOpenError('exchange:binance_us:ticker', 30000);
      })
    });
    const fetchTickers = jest.fn();
    const exchangeManager = createExchangeManager({
      markets: { 'BTC/USDT': {} },
      loadMarkets: jest.fn().mockResolvedValue(undefined),
      fetchTickers
    });

    const { service } = makeService({ circuitBreaker, exchangeManager });

    // Attach catch handlers up front so rejections during advance don't flag as unhandled.
    const p1 = service.getTicker('binance_us', 'BTC/USDT').catch((e: Error) => e);
    const p2 = service.getTicker('binance_us', 'ETH/USDT').catch((e: Error) => e);

    await jest.advanceTimersByTimeAsync(DEFAULT_CONFIG.flushMs + 1);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBeInstanceOf(Error);
    expect((r1 as Error).message).toMatch(/Circuit breaker .* is OPEN/);
    expect(r2).toBeInstanceOf(Error);
    expect((r2 as Error).message).toMatch(/Circuit breaker .* is OPEN/);
    expect(fetchTickers).not.toHaveBeenCalled();
    expect(exchangeManager.getPublicClient).not.toHaveBeenCalled();
  });

  it('throttles client-error logs to once per 5 minutes per exchange', async () => {
    const minusElevenOhTwo = new Error(
      'binanceus 400 Bad Request {"code":-1102,"msg":"Mandatory parameter \'symbols\' was not sent, was empty/null, or malformed."}'
    );
    const fetchTickers = jest.fn().mockRejectedValue(minusElevenOhTwo);
    const client = {
      markets: { 'BTC/USDT': {} },
      loadMarkets: jest.fn().mockResolvedValue(undefined),
      fetchTickers
    };

    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    const { service } = makeService({ exchangeManager: createExchangeManager(client) });

    const flushOnce = async () => {
      const p = service.getTicker('binance_us', 'BTC/USDT').catch((e) => e);
      await jest.advanceTimersByTimeAsync(DEFAULT_CONFIG.flushMs + 1);
      await p;
    };

    const matchRejection = (c: unknown[]) =>
      typeof c[0] === 'string' && c[0].includes('rejected by exchange as client error');

    await flushOnce();
    const firstCallCount = errorSpy.mock.calls.filter(matchRejection).length;

    // Second firing within the 5-min window should NOT log another rejected event.
    await flushOnce();
    const secondCallCount = errorSpy.mock.calls.filter(matchRejection).length;

    expect(firstCallCount).toBe(1);
    expect(secondCallCount).toBe(1);
  });

  it('retries transient fetchTickers errors via the exchange retry wrapper and resolves', async () => {
    const tickers = { 'BTC/USDT': baseTicker({ last: 42000 }) };
    const fetchTickers = jest.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(tickers);
    const client = {
      markets: { 'BTC/USDT': {} },
      loadMarkets: jest.fn().mockResolvedValue(undefined),
      fetchTickers
    };
    const { service } = makeService({ exchangeManager: createExchangeManager(client) });

    const p = service.getTicker('binance_us', 'BTC/USDT');
    await jest.advanceTimersByTimeAsync(DEFAULT_CONFIG.flushMs + 1);
    // Let the retry wrapper burn through its internal sleep cycle.
    await jest.runAllTimersAsync();
    const result = await p;

    expect(result?.price).toBe(42000);
    expect(fetchTickers).toHaveBeenCalledTimes(2);
  });

  it('isolates state across slugs — a failure on one does not reject the other', async () => {
    const fail = new Error('ECONNRESET');
    const binanceFetch = jest.fn().mockRejectedValue(fail);
    const krakenFetch = jest.fn().mockResolvedValue({ 'XBT/ZUSD': baseTicker({ last: 43000 }) });

    const exchangeManager = {
      getPublicClient: jest.fn().mockImplementation((slug: string) => {
        if (slug === 'binance_us') {
          return Promise.resolve({
            markets: { 'BTC/USDT': {} },
            loadMarkets: jest.fn().mockResolvedValue(undefined),
            fetchTickers: binanceFetch
          });
        }
        return Promise.resolve({
          markets: { 'XBT/ZUSD': {} },
          loadMarkets: jest.fn().mockResolvedValue(undefined),
          fetchTickers: krakenFetch
        });
      }),
      formatSymbol: jest.fn().mockImplementation((_slug: string, sym: string) => sym)
    };

    const { service } = makeService({ exchangeManager });

    const pBinance = service.getTicker('binance_us', 'BTC/USDT').catch((e) => e);
    const pKraken = service.getTicker('kraken', 'BTC/USD');

    await jest.advanceTimersByTimeAsync(DEFAULT_CONFIG.flushMs + 1);
    await jest.runAllTimersAsync();

    const [binanceResult, krakenResult] = await Promise.all([pBinance, pKraken]);
    expect(binanceResult).toBeInstanceOf(Error);
    expect(krakenResult?.price).toBe(43000);
  });

  it('opens a fresh batch when a new enqueue arrives mid-flush', async () => {
    const tickers1 = { 'BTC/USDT': baseTicker({ last: 42000 }) };
    const tickers2 = { 'ETH/USDT': baseTicker({ last: 2500 }) };
    const fetchTickers = jest
      .fn()
      .mockImplementationOnce(async () => {
        // Arrival mid-flush: enqueue happens synchronously after this `await` starts.
        return tickers1;
      })
      .mockResolvedValueOnce(tickers2);
    const client = {
      markets: { 'BTC/USDT': {}, 'ETH/USDT': {} },
      loadMarkets: jest.fn().mockResolvedValue(undefined),
      fetchTickers
    };
    const { service } = makeService({ exchangeManager: createExchangeManager(client) });

    const p1 = service.getTicker('binance_us', 'BTC/USDT');
    await jest.advanceTimersByTimeAsync(DEFAULT_CONFIG.flushMs + 1);

    // Arriving mid-flush: since flush() cleared state.pending before awaiting,
    // this opens a brand-new batch with its own timer.
    const p2 = service.getTicker('binance_us', 'ETH/USDT');

    await jest.runAllTimersAsync();
    const [btc, eth] = await Promise.all([p1, p2]);

    expect(btc?.price).toBe(42000);
    expect(eth?.price).toBe(2500);
    expect(fetchTickers).toHaveBeenCalledTimes(2);
  });

  it('resolves with undefined for a symbol not in client.markets', async () => {
    const tickers = { 'BTC/USDT': baseTicker({ last: 42000 }) };
    const fetchTickers = jest.fn().mockResolvedValue(tickers);
    const client = {
      markets: { 'BTC/USDT': {} }, // no ETH/USDT
      loadMarkets: jest.fn().mockResolvedValue(undefined),
      fetchTickers
    };
    const { service } = makeService({ exchangeManager: createExchangeManager(client) });

    const pBtc = service.getTicker('binance_us', 'BTC/USDT');
    const pEth = service.getTicker('binance_us', 'ETH/USDT');
    await jest.advanceTimersByTimeAsync(DEFAULT_CONFIG.flushMs + 1);

    const [btc, eth] = await Promise.all([pBtc, pEth]);

    expect(btc?.price).toBe(42000);
    expect(eth).toBeUndefined();
    expect(fetchTickers).toHaveBeenCalledWith(['BTC/USDT']);
  });

  it('falls through without filtering when loadMarkets throws', async () => {
    const tickers = {
      'BTC/USDT': baseTicker({ last: 42000 }),
      'ETH/USDT': baseTicker({ last: 2500 })
    };
    const fetchTickers = jest.fn().mockResolvedValue(tickers);
    const client = {
      markets: {},
      loadMarkets: jest.fn().mockRejectedValue(new Error('markets endpoint down')),
      fetchTickers
    };
    const { service } = makeService({ exchangeManager: createExchangeManager(client) });

    const pBtc = service.getTicker('binance_us', 'BTC/USDT');
    const pEth = service.getTicker('binance_us', 'ETH/USDT');

    await jest.advanceTimersByTimeAsync(DEFAULT_CONFIG.flushMs + 1);
    const [btc, eth] = await Promise.all([pBtc, pEth]);

    expect(btc?.price).toBe(42000);
    expect(eth?.price).toBe(2500);
    expect(fetchTickers).toHaveBeenCalledWith(expect.arrayContaining(['BTC/USDT', 'ETH/USDT']));
  });

  it('re-fetches from the exchange after the memCache entry expires', async () => {
    const tickers = { 'BTC/USDT': baseTicker({ last: 42000 }) };
    const fetchTickers = jest.fn().mockResolvedValue(tickers);
    const client = {
      markets: { 'BTC/USDT': {} },
      loadMarkets: jest.fn().mockResolvedValue(undefined),
      fetchTickers
    };
    const { service } = makeService({ exchangeManager: createExchangeManager(client) });

    // Populate cache.
    const first = service.getTicker('binance_us', 'BTC/USDT');
    await jest.advanceTimersByTimeAsync(DEFAULT_CONFIG.flushMs + 1);
    await first;
    expect(fetchTickers).toHaveBeenCalledTimes(1);

    // Advance past the TTL; the next call must hit the exchange again.
    await jest.advanceTimersByTimeAsync(DEFAULT_CONFIG.memCacheTtlMs + 1);

    const second = service.getTicker('binance_us', 'BTC/USDT');
    await jest.advanceTimersByTimeAsync(DEFAULT_CONFIG.flushMs + 1);
    await second;

    expect(fetchTickers).toHaveBeenCalledTimes(2);
  });

  it('logs non-client fetch failures as warn without triggering the client-error throttle', async () => {
    const fetchTickers = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const client = {
      markets: { 'BTC/USDT': {} },
      loadMarkets: jest.fn().mockResolvedValue(undefined),
      fetchTickers
    };
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    const { service } = makeService({ exchangeManager: createExchangeManager(client) });

    const p = service.getTicker('binance_us', 'BTC/USDT').catch((e: Error) => e);
    await jest.advanceTimersByTimeAsync(DEFAULT_CONFIG.flushMs + 1);
    await jest.runAllTimersAsync();
    const result = await p;

    expect(result).toBeInstanceOf(Error);
    const warned = warnSpy.mock.calls.some((c) =>
      typeof c[0] === 'string' ? c[0].includes('ticker_batch_error') : false
    );
    const erroredAsRejected = errorSpy.mock.calls.some((c) =>
      typeof c[0] === 'string' ? c[0].includes('ticker_batch_rejected') : false
    );
    expect(warned).toBe(true);
    expect(erroredAsRejected).toBe(false);
  });

  describe('getTickers()', () => {
    it('serves a mix of cached and freshly fetched symbols with a single batched call', async () => {
      const tickers = {
        'BTC/USDT': baseTicker({ last: 42000 }),
        'ETH/USDT': baseTicker({ last: 2500 })
      };
      const fetchTickers = jest.fn().mockResolvedValue(tickers);
      const client = {
        markets: { 'BTC/USDT': {}, 'ETH/USDT': {} },
        loadMarkets: jest.fn().mockResolvedValue(undefined),
        fetchTickers
      };
      const { service } = makeService({ exchangeManager: createExchangeManager(client) });

      // Prime the cache for BTC only.
      const prime = service.getTicker('binance_us', 'BTC/USDT');
      await jest.advanceTimersByTimeAsync(DEFAULT_CONFIG.flushMs + 1);
      await prime;
      fetchTickers.mockClear();

      const bulk = service.getTickers('binance_us', ['BTC/USDT', 'ETH/USDT']);
      await jest.advanceTimersByTimeAsync(DEFAULT_CONFIG.flushMs + 1);
      const result = await bulk;

      expect(result.get('BTC/USDT')?.price).toBe(42000);
      expect(result.get('ETH/USDT')?.price).toBe(2500);
      expect(fetchTickers).toHaveBeenCalledTimes(1);
      expect(fetchTickers).toHaveBeenCalledWith(['ETH/USDT']);
    });

    it('returns partial results without throwing when some symbols succeed and others fail', async () => {
      // First enqueue triggers the flush; we reject that batch, but BTC is already cached from a prior call.
      const tickers = { 'BTC/USDT': baseTicker({ last: 42000 }) };
      const fetchTickers = jest.fn().mockResolvedValueOnce(tickers).mockRejectedValue(new Error('ECONNRESET'));
      const client = {
        markets: { 'BTC/USDT': {}, 'ETH/USDT': {} },
        loadMarkets: jest.fn().mockResolvedValue(undefined),
        fetchTickers
      };
      const { service } = makeService({ exchangeManager: createExchangeManager(client) });

      // Prime BTC into the cache.
      const prime = service.getTicker('binance_us', 'BTC/USDT');
      await jest.advanceTimersByTimeAsync(DEFAULT_CONFIG.flushMs + 1);
      await prime;

      const bulk = service.getTickers('binance_us', ['BTC/USDT', 'ETH/USDT']);
      await jest.advanceTimersByTimeAsync(DEFAULT_CONFIG.flushMs + 1);
      await jest.runAllTimersAsync();
      const result = await bulk;

      expect(result.get('BTC/USDT')?.price).toBe(42000);
      expect(result.has('ETH/USDT')).toBe(false);
    });

    it('throws the first fetch error when every requested symbol fails', async () => {
      const fetchTickers = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
      const client = {
        markets: { 'BTC/USDT': {}, 'ETH/USDT': {} },
        loadMarkets: jest.fn().mockResolvedValue(undefined),
        fetchTickers
      };
      const { service } = makeService({ exchangeManager: createExchangeManager(client) });

      const bulk = service.getTickers('binance_us', ['BTC/USDT', 'ETH/USDT']).catch((e: Error) => e);
      await jest.advanceTimersByTimeAsync(DEFAULT_CONFIG.flushMs + 1);
      await jest.runAllTimersAsync();
      const result = await bulk;

      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/ECONNRESET/);
    });
  });

  it('rejects pending callers with shutdown error on onModuleDestroy', async () => {
    const fetchTickers = jest.fn();
    const client = {
      markets: { 'BTC/USDT': {} },
      loadMarkets: jest.fn().mockResolvedValue(undefined),
      fetchTickers
    };
    const { service } = makeService({ exchangeManager: createExchangeManager(client) });

    const p = service.getTicker('binance_us', 'BTC/USDT');

    // Destroy BEFORE the flush timer fires.
    await service.onModuleDestroy();

    await expect(p).rejects.toThrow(/shutting down/);
    expect(fetchTickers).not.toHaveBeenCalled();
  });
});
