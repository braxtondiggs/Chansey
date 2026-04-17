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

  beforeEach(() => {
    announcementRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((x) => x),
      save: jest.fn().mockImplementation((x) => ({ id: 'ann-id', ...x }))
    };
    coinRepo = { findOne: jest.fn().mockResolvedValue({ id: 'coin-id' }) };
    redis = {
      smembers: jest.fn().mockResolvedValue([]),
      pipeline: jest.fn().mockReturnValue({
        sadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([])
      }),
      scard: jest.fn().mockResolvedValue(0),
      spop: jest.fn().mockResolvedValue(0)
    };
  });

  function build(clients: AnnouncementClient[]) {
    return new AnnouncementPollerService(
      announcementRepo,
      coinRepo,
      redis,
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
});
