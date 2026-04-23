import type Redis from 'ioredis';

import { KrakenAnnouncementClient } from './kraken-announcement.client';

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

const BOOTSTRAP_SENTINEL_KEY = 'listing-tracker:kraken:seeded';
const LAST_SEEN_KEY = 'listing-tracker:last-seen:kraken';

const SAMPLE_ASSET_PAIRS = {
  result: {
    // Real Kraken payload: legacy `base`/`quote` codes + user-facing `wsname`
    XXBTZUSD: { base: 'XXBT', quote: 'ZUSD', status: 'online', altname: 'XBTUSD', wsname: 'XBT/USD' },
    ETHUSDC: { base: 'ETH', quote: 'USDC', status: 'online', altname: 'ETHUSDC', wsname: 'ETH/USDC' },
    LEGACYZUSD: { base: 'LEGACY', quote: 'ZUSD', status: 'delisted', altname: 'LEGACYUSD', wsname: 'LEGACY/USD' },
    FOOEUR: { base: 'FOO', quote: 'ZEUR', status: 'online', altname: 'FOOEUR', wsname: 'FOO/EUR' },
    XXBTUSDC: { base: 'XXBT', quote: 'USDC', status: 'online', altname: 'XBTUSDC', wsname: 'XBT/USDC' }
  }
};

describe('KrakenAnnouncementClient', () => {
  let circuitBreaker: CircuitBreakerService;
  let redis: RedisMock;
  let client: KrakenAnnouncementClient;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    circuitBreaker = new CircuitBreakerService();
    redis = makeRedisMock();
    client = new KrakenAnnouncementClient(circuitBreaker, redis as unknown as Redis);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('getLatest', () => {
    it('filters to online pairs with USD/USDC quotes (via wsname)', async () => {
      fetchSpy.mockResolvedValue(makeFetchResponse(SAMPLE_ASSET_PAIRS));

      const result = await client.getLatest();

      const symbols = result.map((r) => r.announcedSymbol).sort();
      expect(symbols).toEqual(['BTC', 'ETH']);
    });

    it('emits stable synthetic externalIds and source URLs for each base', async () => {
      fetchSpy.mockResolvedValue(
        makeFetchResponse({
          result: {
            XXBTZUSD: { base: 'XXBT', quote: 'ZUSD', status: 'online', altname: 'XBTUSD', wsname: 'XBT/USD' }
          }
        })
      );

      const [announcement] = await client.getLatest();

      expect(announcement).toMatchObject({
        exchangeSlug: 'kraken',
        externalId: 'kraken-listing:BTC',
        sourceUrl: 'https://pro.kraken.com/app/trade/btc-usd',
        announcedSymbol: 'BTC',
        announcementType: ListingAnnouncementType.TRADING_LIVE
      });
      expect(announcement.rawPayload).toEqual({ base: 'BTC', source: 'products-diff' });
      expect(announcement.detectedAt).toBeInstanceOf(Date);
    });

    it('normalizes XXBT → BTC and XDG → DOGE via wsname + alias map', async () => {
      fetchSpy.mockResolvedValue(
        makeFetchResponse({
          result: {
            XXBTZUSD: { base: 'XXBT', quote: 'ZUSD', status: 'online', altname: 'XBTUSD', wsname: 'XBT/USD' },
            XDGZUSD: { base: 'XDG', quote: 'ZUSD', status: 'online', altname: 'XDGUSD', wsname: 'XDG/USD' }
          }
        })
      );

      const result = await client.getLatest();

      const symbols = result.map((r) => r.announcedSymbol).sort();
      expect(symbols).toEqual(['BTC', 'DOGE']);
    });

    it('dedupes bases when both ZUSD and USDC pairs exist for the same coin', async () => {
      fetchSpy.mockResolvedValue(
        makeFetchResponse({
          result: {
            XXBTZUSD: { base: 'XXBT', quote: 'ZUSD', status: 'online', altname: 'XBTUSD', wsname: 'XBT/USD' },
            XXBTUSDC: { base: 'XXBT', quote: 'USDC', status: 'online', altname: 'XBTUSDC', wsname: 'XBT/USDC' }
          }
        })
      );

      const result = await client.getLatest();

      expect(result).toHaveLength(1);
      expect(result[0].announcedSymbol).toBe('BTC');
    });

    it('skips pairs without wsname (ambiguous base/quote boundary)', async () => {
      fetchSpy.mockResolvedValue(
        makeFetchResponse({
          result: {
            // No wsname, base concatenated with quote — the old parser mis-extracted this as `APXUSD`.
            APXUSD: { base: 'APXUSD', quote: 'ZUSD', status: 'online', altname: 'APXUSD' },
            XXBTZUSD: { base: 'XXBT', quote: 'ZUSD', status: 'online', altname: 'XBTUSD', wsname: 'XBT/USD' }
          }
        })
      );

      const result = await client.getLatest();

      const symbols = result.map((r) => r.announcedSymbol).sort();
      // APXUSD without wsname is dropped; the BTC pair still comes through.
      expect(symbols).toEqual(['BTC']);
    });

    it('records circuit-breaker failure and throws on HTTP error', async () => {
      fetchSpy.mockResolvedValue(makeFetchResponse(null, false, 500));
      const recordFailureSpy = jest.spyOn(circuitBreaker, 'recordFailure');

      await expect(client.getLatest()).rejects.toThrow(/HTTP 500/);
      expect(recordFailureSpy).toHaveBeenCalledWith('listing-tracker:kraken');
    });

    it('throws CircuitOpenError when circuit is open without calling fetch', async () => {
      for (let i = 0; i < 5; i++) circuitBreaker.recordFailure('listing-tracker:kraken');

      await expect(client.getLatest()).rejects.toBeInstanceOf(CircuitOpenError);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('onModuleInit bootstrap seeding', () => {
    it('seeds the poller last-seen set and sentinel when sentinel is absent', async () => {
      redis.get.mockResolvedValue(null);
      fetchSpy.mockResolvedValue(makeFetchResponse(SAMPLE_ASSET_PAIRS));

      await client.onModuleInit();

      expect(redis.get).toHaveBeenCalledWith(BOOTSTRAP_SENTINEL_KEY);
      expect(redis.__pipeline.sadd).toHaveBeenCalledWith(LAST_SEEN_KEY, 'kraken-listing:BTC');
      expect(redis.__pipeline.sadd).toHaveBeenCalledWith(LAST_SEEN_KEY, 'kraken-listing:ETH');
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
      fetchSpy.mockResolvedValue(makeFetchResponse({ result: {} }));

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
      fetchSpy.mockResolvedValue(makeFetchResponse(SAMPLE_ASSET_PAIRS));

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
