import { AnnouncementPollerService } from './announcement-poller.service';

import { type AnnouncementClient } from '../clients/announcement-client.interface';
import { type BinanceAnnouncementClient } from '../clients/binance-announcement.client';
import { type CoinbaseAnnouncementClient } from '../clients/coinbase-announcement.client';
import { type KrakenAnnouncementClient } from '../clients/kraken-announcement.client';
import { ListingAnnouncementType } from '../entities/listing-announcement.entity';

function makeClient(slug: string, items: any[], bootstrapReady = true): AnnouncementClient {
  return {
    exchangeSlug: slug,
    getLatest: jest.fn().mockResolvedValue(items),
    bootstrapIfNeeded: jest.fn().mockResolvedValue(bootstrapReady)
  } as unknown as AnnouncementClient;
}

describe('AnnouncementPollerService', () => {
  let announcementRepo: any;
  let coinRepo: any;
  let redis: any;
  let gecko: any;
  let circuitBreaker: any;

  beforeEach(() => {
    announcementRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((x) => x),
      save: jest.fn().mockImplementation((x) => ({ id: 'ann-id', ...x }))
    };
    coinRepo = {
      find: jest.fn().mockResolvedValue([{ id: 'coin-id' }]),
      findOne: jest.fn().mockResolvedValue({ id: 'coin-id' })
    };
    redis = {
      smembers: jest.fn().mockResolvedValue([]),
      pipeline: jest.fn().mockReturnValue({
        sadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([])
      }),
      scard: jest.fn().mockResolvedValue(0),
      spop: jest.fn().mockResolvedValue(0),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK')
    };
    gecko = {
      client: {
        coins: {
          list: {
            get: jest.fn().mockResolvedValue([])
          }
        }
      }
    };
    circuitBreaker = {
      checkCircuit: jest.fn(),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn()
    };
  });

  function build(clients: AnnouncementClient[]) {
    return new AnnouncementPollerService(
      announcementRepo,
      coinRepo,
      redis,
      gecko,
      circuitBreaker,
      clients[0] as unknown as BinanceAnnouncementClient,
      clients[1] as unknown as CoinbaseAnnouncementClient,
      clients[2] as unknown as KrakenAnnouncementClient
    );
  }

  const sample = {
    exchangeSlug: 'binance',
    externalId: 'ext-1',
    sourceUrl: 'https://binance.com/x',
    title: 'Will List FOO',
    announcedSymbol: 'FOO',
    announcementType: ListingAnnouncementType.NEW_LISTING,
    detectedAt: new Date('2026-04-01T00:00:00Z'),
    rawPayload: { foo: 'bar' }
  };

  it('persists new items that are not in the Redis last-seen set', async () => {
    const binance = makeClient('binance', [sample]);
    const poller = build([binance, makeClient('coinbase', []), makeClient('kraken', [])]);

    const results = await poller.pollAll();
    expect(results).toHaveLength(3);
    expect(results[0].inserted).toHaveLength(1);
    expect(announcementRepo.save).toHaveBeenCalled();
  });

  it('skips items already present in the last-seen set', async () => {
    redis.smembers = jest.fn().mockResolvedValue(['ext-1']);
    const binance = makeClient('binance', [sample]);
    const poller = build([binance, makeClient('coinbase', []), makeClient('kraken', [])]);
    const results = await poller.pollAll();
    expect(results[0].inserted).toHaveLength(0);
    expect(announcementRepo.save).not.toHaveBeenCalled();
  });

  it('isolates per-client failures without halting the batch', async () => {
    const failing = {
      exchangeSlug: 'binance',
      bootstrapIfNeeded: jest.fn().mockResolvedValue(true),
      getLatest: jest.fn().mockRejectedValue(new Error('boom'))
    } as any;
    const ok = makeClient('coinbase', [{ ...sample, exchangeSlug: 'coinbase', externalId: 'cb-1' }]);
    const poller = build([failing, ok, makeClient('kraken', [])]);

    const results = await poller.pollAll();
    expect(results[0].error).toBe('boom');
    expect(results[0].inserted).toHaveLength(0);
    expect(results[1].inserted).toHaveLength(1);
  });

  it('does not insert duplicates even when Redis missed the ID', async () => {
    announcementRepo.findOne = jest.fn().mockResolvedValue({ id: 'existing' });
    const binance = makeClient('binance', [sample]);
    const poller = build([binance, makeClient('coinbase', []), makeClient('kraken', [])]);
    const results = await poller.pollAll();
    expect(results[0].inserted).toHaveLength(0);
    expect(announcementRepo.save).not.toHaveBeenCalled();
  });

  it('skips clients whose bootstrap sentinel is not yet set (fail-closed)', async () => {
    // Bootstrap failed: pollOne must not call getLatest and must not persist anything.
    const pending = makeClient('binance', [sample], false);
    const ok = makeClient('coinbase', [{ ...sample, exchangeSlug: 'coinbase', externalId: 'cb-1' }]);
    const poller = build([pending, ok, makeClient('kraken', [])]);

    const results = await poller.pollAll();

    expect(pending.getLatest).not.toHaveBeenCalled();
    expect(results[0]).toEqual(
      expect.objectContaining({
        exchangeSlug: 'binance',
        fetched: 0,
        inserted: [],
        error: 'bootstrap_pending'
      })
    );
    // Sibling clients keep working.
    expect(results[1].inserted).toHaveLength(1);
  });

  describe('local symbol resolution', () => {
    it('skips delisted/[OLD] candidates and falls through to CoinGecko', async () => {
      // Repository filters delistedAt + name ILIKE '%[old]%' for us — simulate that by returning [].
      coinRepo.find = jest.fn().mockResolvedValue([]);
      coinRepo.findOne = jest.fn().mockResolvedValue({ id: 'mapped-coin-id' });
      gecko.client.coins.list.get = jest.fn().mockResolvedValue([{ id: 'war-token', symbol: 'war' }]);

      const binance = makeClient('binance', [{ ...sample, announcedSymbol: 'WAR' }]);
      const poller = build([binance, makeClient('coinbase', []), makeClient('kraken', [])]);

      const results = await poller.pollAll();

      expect(coinRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ symbol: 'war' })
        })
      );
      expect(results[0].inserted[0].coinId).toBe('mapped-coin-id');
    });

    it('leaves coinId null when local symbol matches multiple non-deprecated coins', async () => {
      coinRepo.find = jest.fn().mockResolvedValue([
        { id: 'coin-a', symbol: 'foo' },
        { id: 'coin-b', symbol: 'foo' }
      ]);
      const binance = makeClient('binance', [{ ...sample, announcedSymbol: 'FOO' }]);
      const poller = build([binance, makeClient('coinbase', []), makeClient('kraken', [])]);

      const results = await poller.pollAll();

      expect(results[0].inserted[0].coinId).toBeNull();
      // Should not fall through to CoinGecko for ambiguous local matches.
      expect(gecko.client.coins.list.get).not.toHaveBeenCalled();
    });

    it('returns the single non-deprecated match without consulting CoinGecko', async () => {
      coinRepo.find = jest.fn().mockResolvedValue([{ id: 'live-coin', symbol: 'war' }]);
      const binance = makeClient('binance', [{ ...sample, announcedSymbol: 'WAR' }]);
      const poller = build([binance, makeClient('coinbase', []), makeClient('kraken', [])]);

      const results = await poller.pollAll();

      expect(results[0].inserted[0].coinId).toBe('live-coin');
      expect(gecko.client.coins.list.get).not.toHaveBeenCalled();
    });
  });

  describe('CoinGecko fallback resolution', () => {
    it('resolves coinId from CoinGecko when local lookup misses and exactly one symbol matches', async () => {
      // Local symbol lookup misses (find returns []), but the subsequent gecko slug findOne hits.
      coinRepo.find = jest.fn().mockResolvedValue([]);
      coinRepo.findOne = jest.fn().mockResolvedValue({ id: 'mapped-coin-id' });
      gecko.client.coins.list.get = jest.fn().mockResolvedValue([{ id: 'chipper', symbol: 'chip', name: 'Chip' }]);

      const binance = makeClient('binance', [{ ...sample, announcedSymbol: 'CHIP' }]);
      const poller = build([binance, makeClient('coinbase', []), makeClient('kraken', [])]);

      const results = await poller.pollAll();
      expect(results[0].inserted[0].coinId).toBe('mapped-coin-id');
      expect(announcementRepo.save).toHaveBeenCalledWith(expect.objectContaining({ coinId: 'mapped-coin-id' }));
    });

    it('leaves coinId null when symbol matches multiple CoinGecko coins (ambiguous)', async () => {
      coinRepo.find = jest.fn().mockResolvedValue([]);
      coinRepo.findOne = jest.fn().mockResolvedValue(null);
      gecko.client.coins.list.get = jest.fn().mockResolvedValue([
        { id: 'chipper', symbol: 'chip' },
        { id: 'other-chip', symbol: 'chip' }
      ]);

      const binance = makeClient('binance', [{ ...sample, announcedSymbol: 'CHIP' }]);
      const poller = build([binance, makeClient('coinbase', []), makeClient('kraken', [])]);

      const results = await poller.pollAll();
      expect(results[0].inserted[0].coinId).toBeNull();
    });

    it('caches the CoinGecko list in Redis and reuses it on subsequent calls', async () => {
      coinRepo.find = jest.fn().mockResolvedValue([]);
      coinRepo.findOne = jest.fn().mockResolvedValue(null);
      gecko.client.coins.list.get = jest.fn().mockResolvedValue([{ id: 'foo', symbol: 'foo' }]);

      const binance = makeClient('binance', [sample]);
      const poller = build([binance, makeClient('coinbase', []), makeClient('kraken', [])]);

      // First call: cache miss → fetch from CoinGecko → writes the cache.
      await poller.pollAll();
      expect(gecko.client.coins.list.get).toHaveBeenCalledTimes(1);
      expect(redis.set).toHaveBeenCalledWith(
        'listing-tracker:coingecko-coin-list',
        expect.any(String),
        'EX',
        expect.any(Number)
      );

      // Second call: cache hit → reuses cached list, no additional CoinGecko fetch.
      redis.get = jest.fn().mockResolvedValue(JSON.stringify([{ id: 'foo', symbol: 'foo' }]));
      announcementRepo.findOne = jest.fn().mockResolvedValue({ id: 'existing' }); // skip re-insert
      await poller.pollAll();
      expect(gecko.client.coins.list.get).toHaveBeenCalledTimes(1);
    });
  });
});
