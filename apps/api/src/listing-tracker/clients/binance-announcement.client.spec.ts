import type Redis from 'ioredis';

import { BinanceAnnouncementClient } from './binance-announcement.client';

import { CircuitBreakerService, CircuitOpenError } from '../../shared/circuit-breaker.service';
import { ListingAnnouncementType } from '../entities/listing-announcement.entity';

interface PipelineMock {
  sadd: jest.Mock;
  expire: jest.Mock;
  set: jest.Mock;
  exec: jest.Mock;
}

interface RedisMock {
  get: jest.Mock;
  set: jest.Mock;
  sadd: jest.Mock;
  pipeline: jest.Mock;
  __pipeline: PipelineMock;
}

function makeRedisMock(overrides: Partial<Pick<RedisMock, 'get'>> = {}): RedisMock {
  const pipelineMock: PipelineMock = {
    sadd: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([])
  };
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    sadd: jest.fn().mockResolvedValue(1),
    pipeline: jest.fn().mockReturnValue(pipelineMock),
    __pipeline: pipelineMock,
    ...overrides
  };
}

function makeFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body
  } as unknown as Response;
}

const BOOTSTRAP_SENTINEL_KEY = 'listing-tracker:binance:seeded';
const LAST_SEEN_KEY = 'listing-tracker:last-seen:binance';

const SAMPLE_EXCHANGE_INFO = {
  symbols: [
    { symbol: 'BTCUSD', baseAsset: 'BTC', quoteAsset: 'USD', status: 'TRADING' },
    { symbol: 'ETHUSDC', baseAsset: 'ETH', quoteAsset: 'USDC', status: 'TRADING' },
    { symbol: 'LEGACYUSD', baseAsset: 'LEGACY', quoteAsset: 'USD', status: 'BREAK' },
    { symbol: 'FOOEUR', baseAsset: 'FOO', quoteAsset: 'EUR', status: 'TRADING' },
    { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING' }
  ]
};

describe('BinanceAnnouncementClient', () => {
  let circuitBreaker: CircuitBreakerService;
  let redis: RedisMock;
  let client: BinanceAnnouncementClient;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    circuitBreaker = new CircuitBreakerService();
    redis = makeRedisMock();
    client = new BinanceAnnouncementClient(circuitBreaker, redis as unknown as Redis);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('getLatest', () => {
    it('filters to TRADING symbols with USD/USDT/USDC quote assets', async () => {
      fetchSpy.mockResolvedValue(makeFetchResponse(SAMPLE_EXCHANGE_INFO));

      const result = await client.getLatest();

      const symbols = result.map((r) => r.announcedSymbol).sort();
      expect(symbols).toEqual(['BTC', 'ETH']);
    });

    it('emits stable synthetic externalIds and source URLs for each base', async () => {
      fetchSpy.mockResolvedValue(
        makeFetchResponse({
          symbols: [{ symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING' }]
        })
      );

      const [announcement] = await client.getLatest();

      expect(announcement).toMatchObject({
        exchangeSlug: 'binance',
        externalId: 'binance-listing:BTC',
        sourceUrl: 'https://www.binance.us/trade/BTC_USDT',
        announcedSymbol: 'BTC',
        announcementType: ListingAnnouncementType.TRADING_LIVE
      });
      expect(announcement.rawPayload).toEqual({ base: 'BTC', source: 'products-diff' });
      expect(announcement.detectedAt).toBeInstanceOf(Date);
    });

    it('dedupes bases when multiple eligible quote pairs exist for the same coin', async () => {
      fetchSpy.mockResolvedValue(
        makeFetchResponse({
          symbols: [
            { symbol: 'BTCUSD', baseAsset: 'BTC', quoteAsset: 'USD', status: 'TRADING' },
            { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING' },
            { symbol: 'BTCUSDC', baseAsset: 'BTC', quoteAsset: 'USDC', status: 'TRADING' }
          ]
        })
      );

      const result = await client.getLatest();

      expect(result).toHaveLength(1);
      expect(result[0].announcedSymbol).toBe('BTC');
    });

    it('records circuit-breaker failure and throws on HTTP error', async () => {
      fetchSpy.mockResolvedValue(makeFetchResponse(null, false, 500));
      const recordFailureSpy = jest.spyOn(circuitBreaker, 'recordFailure');

      await expect(client.getLatest()).rejects.toThrow(/HTTP 500/);
      expect(recordFailureSpy).toHaveBeenCalledWith('listing-tracker:binance');
    });

    it('throws CircuitOpenError when circuit is open without calling fetch', async () => {
      for (let i = 0; i < 5; i++) circuitBreaker.recordFailure('listing-tracker:binance');

      await expect(client.getLatest()).rejects.toBeInstanceOf(CircuitOpenError);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('onModuleInit bootstrap seeding', () => {
    it('seeds the poller last-seen set and sentinel when sentinel is absent', async () => {
      redis.get.mockResolvedValue(null);
      fetchSpy.mockResolvedValue(makeFetchResponse(SAMPLE_EXCHANGE_INFO));

      await client.onModuleInit();

      expect(redis.get).toHaveBeenCalledWith(BOOTSTRAP_SENTINEL_KEY);
      expect(redis.__pipeline.sadd).toHaveBeenCalledWith(LAST_SEEN_KEY, 'binance-listing:BTC');
      expect(redis.__pipeline.sadd).toHaveBeenCalledWith(LAST_SEEN_KEY, 'binance-listing:ETH');
      expect(redis.__pipeline.sadd).toHaveBeenCalledTimes(2);
      expect(redis.__pipeline.expire).toHaveBeenCalledWith(LAST_SEEN_KEY, 30 * 24 * 60 * 60);
      expect(redis.__pipeline.set).toHaveBeenCalledWith(BOOTSTRAP_SENTINEL_KEY, expect.any(String));
      expect(redis.__pipeline.exec).toHaveBeenCalled();
    });

    it('skips seeding when sentinel is already set', async () => {
      redis.get.mockResolvedValue('2026-04-16T00:00:00.000Z');

      await client.onModuleInit();

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(redis.pipeline).not.toHaveBeenCalled();
    });

    it('swallows errors so boot never crashes on bootstrap failure', async () => {
      redis.get.mockResolvedValue(null);
      fetchSpy.mockResolvedValue(makeFetchResponse(null, false, 503));

      await expect(client.onModuleInit()).resolves.toBeUndefined();
      expect(redis.pipeline).not.toHaveBeenCalled();
    });

    it('returns early when eligible products list is empty without touching Redis pipeline', async () => {
      redis.get.mockResolvedValue(null);
      fetchSpy.mockResolvedValue(makeFetchResponse({ symbols: [] }));

      await client.onModuleInit();

      expect(redis.pipeline).not.toHaveBeenCalled();
    });
  });

  describe('bootstrapIfNeeded', () => {
    it('returns true when sentinel already set', async () => {
      redis.get.mockResolvedValue('2026-04-16T00:00:00.000Z');

      await expect(client.bootstrapIfNeeded()).resolves.toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns true and seeds when sentinel is absent and fetch succeeds', async () => {
      redis.get.mockResolvedValue(null);
      fetchSpy.mockResolvedValue(makeFetchResponse(SAMPLE_EXCHANGE_INFO));

      await expect(client.bootstrapIfNeeded()).resolves.toBe(true);
      expect(redis.__pipeline.set).toHaveBeenCalledWith(BOOTSTRAP_SENTINEL_KEY, expect.any(String));
    });

    it('returns false when fetch fails so pollers can fail-closed', async () => {
      redis.get.mockResolvedValue(null);
      fetchSpy.mockResolvedValue(makeFetchResponse(null, false, 503));

      await expect(client.bootstrapIfNeeded()).resolves.toBe(false);
    });
  });
});
