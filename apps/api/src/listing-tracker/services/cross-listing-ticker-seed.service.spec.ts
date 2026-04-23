import { CrossListingTickerSeedService } from './cross-listing-ticker-seed.service';

function makeCoin(partial: Partial<{ id: string; slug: string; symbol: string; marketRank: number }> = {}): any {
  return {
    id: 'c1',
    slug: 'foo-coin',
    symbol: 'foo',
    marketRank: 1,
    delistedAt: null,
    ...partial
  };
}

describe('CrossListingTickerSeedService', () => {
  let coinRepo: any;
  let tickerRepo: any;
  let exchangeRepo: any;
  let tickerFetcher: { fetchAllTickersForExchange: jest.Mock };

  beforeEach(() => {
    coinRepo = { find: jest.fn().mockResolvedValue([]) };
    tickerRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
      create: jest.fn().mockImplementation((e) => e)
    };
    exchangeRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((e) => e),
      save: jest.fn().mockImplementation((e) => Promise.resolve({ id: `ex-${e.slug}`, ...e }))
    };
    tickerFetcher = { fetchAllTickersForExchange: jest.fn().mockResolvedValue([]) };
  });

  function build() {
    return new CrossListingTickerSeedService(coinRepo, tickerRepo, exchangeRepo, tickerFetcher as any);
  }

  it('creates missing target-exchange rows with supported: false', async () => {
    const service = build();

    const result = await service.seedFromCachedExchangeTickers();

    expect(exchangeRepo.save).toHaveBeenCalledTimes(3);
    expect(exchangeRepo.save).toHaveBeenCalledWith(expect.objectContaining({ slug: 'kucoin', supported: false }));
    expect(exchangeRepo.save).toHaveBeenCalledWith(expect.objectContaining({ slug: 'gate', supported: false }));
    expect(exchangeRepo.save).toHaveBeenCalledWith(expect.objectContaining({ slug: 'okx', supported: false }));
    expect(result.exchangeUpserted.sort()).toEqual(['gate', 'kucoin', 'okx']);
  });

  it('inserts ticker rows by matching ticker.coin_id to the coin slug map', async () => {
    exchangeRepo.find.mockResolvedValue([
      { id: 'ex-kucoin', slug: 'kucoin' },
      { id: 'ex-gate', slug: 'gate' },
      { id: 'ex-okx', slug: 'okx' }
    ]);
    coinRepo.find.mockResolvedValue([makeCoin()]);

    tickerFetcher.fetchAllTickersForExchange.mockImplementation((slug: string) => {
      if (slug === 'kucoin') {
        return Promise.resolve([
          { coin_id: 'foo-coin', target: 'USDT', volume: 1000, last_traded_at: '2026-04-20T10:00:00Z' },
          { coin_id: 'other-coin', target: 'USDT', volume: 500 }
        ]);
      }
      if (slug === 'gate') {
        return Promise.resolve([{ coin_id: 'foo-coin', target: 'USDT', volume: 500 }]);
      }
      if (slug === 'okx') {
        return Promise.resolve([{ coin_id: 'foo-coin', target: 'USDT', volume: 800 }]);
      }
      return Promise.resolve([]);
    });

    const service = build();
    const result = await service.seedFromCachedExchangeTickers();

    expect(result.pairsInserted).toBe(3);
    // One bulk save per exchange (3 exchanges × 1 ticker each).
    expect(tickerRepo.save).toHaveBeenCalledTimes(3);
    expect(tickerRepo.save).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ symbol: 'FOOUSDT' })]),
      expect.objectContaining({ chunk: 200 })
    );
    expect(result.tickersByExchange).toEqual({ kucoin: 2, gate: 1, okx: 1 });
  });

  it('keeps the highest-volume ticker per coin per exchange', async () => {
    exchangeRepo.find.mockResolvedValue([{ id: 'ex-kucoin', slug: 'kucoin' }]);
    coinRepo.find.mockResolvedValue([makeCoin()]);

    tickerFetcher.fetchAllTickersForExchange.mockImplementation((slug: string) =>
      slug === 'kucoin'
        ? Promise.resolve([
            { coin_id: 'foo-coin', target: 'USDT', volume: 100 },
            { coin_id: 'foo-coin', target: 'BTC', volume: 5000 },
            { coin_id: 'foo-coin', target: 'ETH', volume: 300 }
          ])
        : Promise.resolve([])
    );

    const service = build();
    const result = await service.seedFromCachedExchangeTickers();

    expect(result.pairsInserted).toBe(1);
    expect(tickerRepo.save).toHaveBeenCalledTimes(1);
    // Highest-volume ticker wins — symbol reflects BTC target
    expect(tickerRepo.save).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ symbol: 'FOOBTC', volume: 5000 })]),
      expect.objectContaining({ chunk: 200 })
    );
  });

  it('updates existing rows instead of inserting duplicates', async () => {
    exchangeRepo.find.mockResolvedValue([{ id: 'ex-kucoin', slug: 'kucoin' }]);
    coinRepo.find.mockResolvedValue([makeCoin()]);
    tickerRepo.find.mockResolvedValue([{ id: 't1', symbol: 'FOOUSDT', volume: 100 }]);
    tickerFetcher.fetchAllTickersForExchange.mockImplementation((slug: string) =>
      slug === 'kucoin' ? Promise.resolve([{ coin_id: 'foo-coin', target: 'USDT', volume: 1000 }]) : Promise.resolve([])
    );

    const service = build();
    const result = await service.seedFromCachedExchangeTickers();

    expect(result.pairsInserted).toBe(0);
    expect(result.pairsUpdated).toBe(1);
    expect(tickerRepo.save).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 't1', volume: 1000 })]),
      expect.objectContaining({ chunk: 200 })
    );
  });

  it('captures per-exchange errors without halting the batch', async () => {
    exchangeRepo.find.mockResolvedValue([
      { id: 'ex-kucoin', slug: 'kucoin' },
      { id: 'ex-okx', slug: 'okx' }
    ]);
    coinRepo.find.mockResolvedValue([makeCoin()]);

    tickerFetcher.fetchAllTickersForExchange.mockImplementation((slug: string) => {
      if (slug === 'kucoin') return Promise.reject(new Error('network'));
      if (slug === 'okx') return Promise.resolve([{ coin_id: 'foo-coin', target: 'USDT', volume: 500 }]);
      return Promise.resolve([]);
    });

    const service = build();
    const result = await service.seedFromCachedExchangeTickers();

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^kucoin: /);
    expect(result.pairsInserted).toBe(1);
  });

  it('skips tickers whose coin_id does not match any known coin', async () => {
    exchangeRepo.find.mockResolvedValue([{ id: 'ex-kucoin', slug: 'kucoin' }]);
    coinRepo.find.mockResolvedValue([makeCoin()]);
    tickerFetcher.fetchAllTickersForExchange.mockImplementation((slug: string) =>
      slug === 'kucoin'
        ? Promise.resolve([
            { coin_id: 'unknown-coin', target: 'USDT', volume: 1000 },
            { coin_id: 'foo-coin', target: 'USDT', volume: 100 }
          ])
        : Promise.resolve([])
    );

    const service = build();
    const result = await service.seedFromCachedExchangeTickers();

    expect(result.pairsInserted).toBe(1);
    expect(tickerRepo.save).toHaveBeenCalledTimes(1);
    expect(tickerRepo.save).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ symbol: 'FOOUSDT' })]),
      expect.objectContaining({ chunk: 200 })
    );
  });

  it('falls back to per-row saves when the bulk save fails and records per-row errors', async () => {
    exchangeRepo.find.mockResolvedValue([{ id: 'ex-kucoin', slug: 'kucoin' }]);
    coinRepo.find.mockResolvedValue([makeCoin(), makeCoin({ id: 'c2', slug: 'bar-coin', symbol: 'bar' })]);
    // Bulk save (array arg) always fails; per-row retry only fails for FOOUSDT.
    tickerRepo.save.mockImplementation((arg: any) => {
      if (Array.isArray(arg)) return Promise.reject(new Error('bulk down'));
      if (arg?.symbol === 'FOOUSDT') return Promise.reject(new Error('db down'));
      return Promise.resolve(arg);
    });
    tickerFetcher.fetchAllTickersForExchange.mockImplementation((slug: string) =>
      slug === 'kucoin'
        ? Promise.resolve([
            { coin_id: 'foo-coin', target: 'USDT', volume: 500 },
            { coin_id: 'bar-coin', target: 'USDT', volume: 600 }
          ])
        : Promise.resolve([])
    );

    const service = build();
    const result = await service.seedFromCachedExchangeTickers();

    expect(result.errors).toEqual(['kucoin:foo-coin: db down']);
    expect(result.pairsInserted).toBe(1);
    expect(tickerRepo.save).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'BARUSDT' }));
    expect(tickerRepo.save).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'FOOUSDT' }));
  });
});
