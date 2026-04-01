import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { FindManyOptions, FindOneOptions, In, IsNull, Repository } from 'typeorm';

import { Coin } from './coin.entity';
import { CoinService } from './coin.service';

import { CoinNotFoundException } from '../common/exceptions/resource';
import { CircuitBreakerService } from '../shared';

const originalSetTimeout = global.setTimeout;

const createTestCoin = (overrides: Partial<Coin> & Record<string, unknown> = {}): Coin => {
  const now = new Date();
  return {
    id: (overrides.id as string) ?? 'coin-123',
    slug: (overrides.slug as string) ?? 'bitcoin',
    name: (overrides.name as string) ?? 'Bitcoin',
    symbol: (overrides.symbol as string) ?? 'BTC',
    createdAt: (overrides.createdAt as Date) ?? now,
    updatedAt: (overrides.updatedAt as Date) ?? now,
    ...overrides
  } as Coin;
};

const makeCoinGeckoError = (status: number, statusText: string, code?: string) =>
  code ? new Error(`Connection refused (${code})`) : new Error(`got error from coin gecko. status code: ${status}`);

describe('CoinService', () => {
  let service: CoinService;
  let coinRepository: jest.Mocked<Repository<Coin>>;
  let cacheManager: {
    get: jest.Mock<Promise<any>, [string]>;
    set: jest.Mock<Promise<void>, [string, any, number?]>;
    del: jest.Mock<Promise<void>, [string]>;
  };
  let geckoMock: { coinId: jest.Mock; coinIdMarketChart: jest.Mock };
  let setTimeoutSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoinService,
        {
          provide: getRepositoryToken(Coin),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest.fn(),
            createQueryBuilder: jest.fn(),
            update: jest.fn().mockResolvedValue(undefined),
            delete: jest.fn(),
            insert: jest.fn()
          }
        },
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(undefined),
            del: jest.fn().mockResolvedValue(undefined)
          }
        },
        {
          provide: CircuitBreakerService,
          useValue: {
            configure: jest.fn(),
            isOpen: jest.fn().mockReturnValue(false),
            checkCircuit: jest.fn(),
            recordSuccess: jest.fn(),
            recordFailure: jest.fn()
          }
        }
      ]
    }).compile();

    service = module.get<CoinService>(CoinService);
    coinRepository = module.get(getRepositoryToken(Coin));
    cacheManager = module.get(CACHE_MANAGER);

    geckoMock = {
      coinId: jest.fn().mockResolvedValue({
        id: 'bitcoin',
        name: 'Bitcoin',
        symbol: 'btc',
        description: { en: 'Bitcoin mock description' },
        links: {
          homepage: ['https://bitcoin.org'],
          blockchain_site: ['https://blockchain.info'],
          official_forum_url: ['https://bitcointalk.org'],
          subreddit_url: 'https://reddit.com/r/bitcoin',
          repos_url: { github: ['https://github.com/bitcoin/bitcoin'] }
        },
        market_data: {
          current_price: { usd: 43000 },
          market_cap: { usd: 800000000000 },
          total_volume: { usd: 35000000000 },
          price_change_24h_in_currency: { usd: 1200 },
          price_change_percentage_24h: 2.5,
          circulating_supply: 19400000,
          total_supply: 21000000,
          max_supply: 21000000
        }
      }),
      coinIdMarketChart: jest.fn().mockResolvedValue({
        prices: [[Date.now(), 43000]],
        market_caps: [[Date.now(), 800000000000]],
        total_volumes: [[Date.now(), 35000000000]]
      })
    };

    (service as any).gecko = geckoMock;

    setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation(((
      handler: (...args: any[]) => void,
      timeout?: number,
      ...args: any[]
    ) => {
      const timer = originalSetTimeout(handler as any, timeout as any, ...args);
      if (typeof (timer as any)?.unref === 'function') {
        (timer as any).unref();
      }
      return timer;
    }) as any);
  });

  afterEach(() => {
    setTimeoutSpy.mockRestore();
    jest.clearAllMocks();
  });

  // ===========================================================================
  // fetchCoinDetail()
  // ===========================================================================
  describe('fetchCoinDetail()', () => {
    it('returns CoinGecko data and caches the result on cache miss', async () => {
      const result = await (service as any).fetchCoinDetail('bitcoin');

      expect(result.id).toBe('bitcoin');
      expect(cacheManager.set).toHaveBeenCalledWith('coingecko:detail:bitcoin', result, 300);
    });

    it('returns cached data on cache hit without calling API', async () => {
      const cached = { id: 'bitcoin', cached: true };
      cacheManager.get.mockResolvedValueOnce(cached);

      const result = await (service as any).fetchCoinDetail('bitcoin');

      expect(result).toBe(cached);
      expect(geckoMock.coinId).not.toHaveBeenCalled();
    });

    it('falls back to cached data on 429 rate limit', async () => {
      const cachedDetail = { id: 'bitcoin', description: { en: 'cached' } };
      cacheManager.get.mockResolvedValueOnce(null); // first check: miss
      geckoMock.coinId.mockRejectedValueOnce(makeCoinGeckoError(429, 'Too Many Requests'));
      cacheManager.get.mockResolvedValueOnce(cachedDetail); // fallback check: hit

      const result = await (service as any).fetchCoinDetail('bitcoin');
      expect(result).toBe(cachedDetail);
    });

    it('throws CoinNotFoundException on 404', async () => {
      cacheManager.get.mockResolvedValueOnce(null);
      geckoMock.coinId.mockRejectedValueOnce(makeCoinGeckoError(404, 'Not Found'));

      await expect((service as any).fetchCoinDetail('invalid-coin')).rejects.toThrow(CoinNotFoundException);
    });

    it('re-throws non-CoinGecko errors', async () => {
      cacheManager.get.mockResolvedValueOnce(null);
      geckoMock.coinId.mockRejectedValueOnce(new Error('Network error'));

      await expect((service as any).fetchCoinDetail('bitcoin')).rejects.toThrow('Network error');
    });
  });

  // ===========================================================================
  // fetchMarketChart()
  // ===========================================================================
  describe('fetchMarketChart()', () => {
    let circuitBreaker: { isOpen: jest.Mock; recordSuccess: jest.Mock; recordFailure: jest.Mock };

    beforeEach(() => {
      circuitBreaker = (service as any).circuitBreaker;
    });

    it('fetches chart data from CoinGecko and caches the result', async () => {
      const result = await (service as any).fetchMarketChart('bitcoin', 7);

      expect(result.prices).toBeInstanceOf(Array);
      expect(result.prices[0]).toHaveLength(2);
      expect(geckoMock.coinIdMarketChart).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'bitcoin', vs_currency: 'usd', days: 7 })
      );
      expect(cacheManager.set).toHaveBeenCalledWith('coingecko:chart:bitcoin:7d', result, 900);
      expect(circuitBreaker.recordSuccess).toHaveBeenCalledWith('coingecko-chart');
    });

    it('returns cached chart data on cache hit', async () => {
      const cached = { prices: [[Date.now(), 50000]] };
      cacheManager.get.mockResolvedValueOnce(cached);

      const result = await (service as any).fetchMarketChart('bitcoin', 7);
      expect(result).toBe(cached);
      expect(geckoMock.coinIdMarketChart).not.toHaveBeenCalled();
    });

    it('throws user-friendly error on network failure with no cache', async () => {
      cacheManager.get.mockResolvedValue(null); // all cache lookups miss
      geckoMock.coinIdMarketChart.mockRejectedValueOnce(makeCoinGeckoError(0, 'Connection refused', 'ECONNREFUSED'));

      await expect((service as any).fetchMarketChart('bitcoin', 7)).rejects.toThrow(
        'Unable to fetch chart data. Please try again later.'
      );
    });

    it('falls back to cached data on 429 rate limit', async () => {
      const cachedChart = { prices: [[Date.now(), 42000]] };
      cacheManager.get.mockResolvedValueOnce(null); // primary cache: miss
      geckoMock.coinIdMarketChart.mockRejectedValueOnce(makeCoinGeckoError(429, 'Too Many Requests'));
      cacheManager.get.mockResolvedValueOnce(cachedChart); // catch-block primary cache retry: hit

      const result = await (service as any).fetchMarketChart('bitcoin', 7);
      expect(result).toBe(cachedChart);
      expect(circuitBreaker.recordFailure).toHaveBeenCalledWith('coingecko-chart');
    });

    it('falls back to cached data on timeout', async () => {
      const cachedChart = { prices: [[Date.now(), 41000]] };
      cacheManager.get.mockResolvedValueOnce(null); // primary cache: miss
      geckoMock.coinIdMarketChart.mockRejectedValueOnce(new Error('CoinGecko API timeout'));
      cacheManager.get.mockResolvedValueOnce(cachedChart); // catch-block primary cache retry: hit

      const result = await (service as any).fetchMarketChart('bitcoin', 7);
      expect(result).toBe(cachedChart);
      expect(circuitBreaker.recordFailure).toHaveBeenCalledWith('coingecko-chart');
    });

    it('throws user-friendly error on timeout with no cache', async () => {
      cacheManager.get.mockResolvedValue(null); // all cache lookups miss
      geckoMock.coinIdMarketChart.mockRejectedValueOnce(new Error('CoinGecko API timeout'));

      await expect((service as any).fetchMarketChart('bitcoin', 7)).rejects.toThrow(
        'Unable to fetch chart data. Please try again later.'
      );
    });

    it('skips API call and returns stale cache when circuit breaker is open', async () => {
      const staleChart = { prices: [[Date.now(), 40000]] };
      circuitBreaker.isOpen.mockReturnValue(true);
      cacheManager.get
        .mockResolvedValueOnce(null) // primary cache: miss
        .mockResolvedValueOnce(staleChart); // stale cache: hit

      const result = await (service as any).fetchMarketChart('bitcoin', 7);

      expect(result).toBe(staleChart);
      expect(geckoMock.coinIdMarketChart).not.toHaveBeenCalled();
    });

    it('throws when circuit breaker is open and no stale cache exists', async () => {
      circuitBreaker.isOpen.mockReturnValue(true);
      cacheManager.get.mockResolvedValue(null); // all cache lookups miss

      await expect((service as any).fetchMarketChart('bitcoin', 7)).rejects.toThrow(
        'Unable to fetch chart data. Please try again later.'
      );
      expect(geckoMock.coinIdMarketChart).not.toHaveBeenCalled();
    });

    it('falls back to stale cache when primary cache retry misses', async () => {
      const staleChart = { prices: [[Date.now(), 39000]] };
      cacheManager.get
        .mockResolvedValueOnce(null) // primary cache: miss
        .mockResolvedValueOnce(null) // catch-block primary cache retry: miss
        .mockResolvedValueOnce(staleChart); // stale cache: hit
      geckoMock.coinIdMarketChart.mockRejectedValueOnce(new Error('API down'));

      const result = await (service as any).fetchMarketChart('bitcoin', 7);
      expect(result).toBe(staleChart);
    });
  });

  // ===========================================================================
  // getCoinDetailBySlug()
  // ===========================================================================
  describe('getCoinDetailBySlug()', () => {
    it('returns a complete DTO for a coin with fresh metadata', async () => {
      const freshCoin = createTestCoin({
        slug: 'bitcoin',
        currentPrice: 43000,
        priceChange24h: 1200,
        priceChangePercentage24h: 2.5,
        marketCap: 800_000_000_000,
        totalVolume: 35_000_000_000,
        circulatingSupply: 19_400_000,
        description: 'Bitcoin is digital money',
        links: { homepage: ['https://bitcoin.org'] },
        metadataLastUpdated: new Date() // fresh
      });
      coinRepository.findOne.mockResolvedValue(freshCoin);

      const result = await (service as any).getCoinDetailBySlug('bitcoin');

      expect(coinRepository.findOne).toHaveBeenCalledWith({ where: { slug: 'bitcoin' } });
      expect(result).toMatchObject({
        slug: 'bitcoin',
        currentPrice: 43000,
        description: 'Bitcoin is digital money',
        links: expect.objectContaining({ homepage: ['https://bitcoin.org'] })
      });
      // Should NOT fetch from CoinGecko since metadata is fresh
      expect(geckoMock.coinId).not.toHaveBeenCalled();
    });

    it('fetches CoinGecko data and updates DB when metadata is stale', async () => {
      const staleCoin = createTestCoin({
        slug: 'bitcoin',
        currentPrice: 43000,
        description: 'Old description',
        metadataLastUpdated: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) // 2 days old
      });
      coinRepository.findOne.mockResolvedValue(staleCoin);

      const result = await (service as any).getCoinDetailBySlug('bitcoin');

      expect(geckoMock.coinId).toHaveBeenCalled();
      expect(coinRepository.update).toHaveBeenCalledWith(
        staleCoin.id,
        expect.objectContaining({ description: 'Bitcoin mock description' })
      );
      expect(result.description).toBe('Bitcoin mock description');
    });

    it('throws CoinNotFoundException when slug does not exist', async () => {
      coinRepository.findOne.mockResolvedValue(null);

      await expect((service as any).getCoinDetailBySlug('invalid-slug')).rejects.toThrow(CoinNotFoundException);
    });

    it('gracefully continues with DB data when CoinGecko fetch fails', async () => {
      const staleCoin = createTestCoin({
        slug: 'bitcoin',
        currentPrice: 43000,
        description: 'DB description',
        metadataLastUpdated: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      });
      coinRepository.findOne.mockResolvedValue(staleCoin);
      geckoMock.coinId.mockRejectedValueOnce(new Error('API down'));

      const result = await (service as any).getCoinDetailBySlug('bitcoin');

      expect(result.description).toBe('DB description');
    });
  });

  // ===========================================================================
  // getMarketChart()
  // ===========================================================================
  describe('getMarketChart()', () => {
    const mockCoin = () => createTestCoin({ slug: 'bitcoin', coinGeckoId: 'bitcoin', currentPrice: 43000 });

    it('returns chart data with correct structure', async () => {
      coinRepository.findOne.mockResolvedValue(mockCoin());

      const result = await (service as any).getMarketChart('bitcoin', '7d');

      expect(result).toMatchObject({
        coinSlug: 'bitcoin',
        period: '7d',
        prices: expect.arrayContaining([
          expect.objectContaining({ timestamp: expect.any(Number), price: expect.any(Number) })
        ]),
        timestamps: expect.arrayContaining([expect.any(Number)])
      });
      expect(result.generatedAt).toBeInstanceOf(Date);
    });

    it('throws CoinNotFoundException when slug does not exist', async () => {
      coinRepository.findOne.mockResolvedValue(null);

      await expect((service as any).getMarketChart('missing', '7d')).rejects.toThrow(CoinNotFoundException);
    });

    it('propagates error when CoinGecko fails and no cache exists', async () => {
      coinRepository.findOne.mockResolvedValue(mockCoin());
      geckoMock.coinIdMarketChart.mockRejectedValueOnce(new Error('API down'));
      cacheManager.get.mockResolvedValue(null); // no cache

      await expect((service as any).getMarketChart('bitcoin', '7d')).rejects.toThrow(
        'Unable to fetch chart data. Please try again later.'
      );
    });
  });

  // ===========================================================================
  // getCoinBySymbol()
  // ===========================================================================
  describe('getCoinBySymbol()', () => {
    it.each(['usd', 'USD', 'Usd'])('returns a virtual USD coin for "%s" (case-insensitive)', async (input) => {
      const result = await service.getCoinBySymbol(input);

      expect(result.id).toBe('USD-virtual');
      expect(result.symbol).toBe('USD');
      expect(result.name).toBe('US Dollar');
      expect(coinRepository.findOne).not.toHaveBeenCalled();
    });

    it('queries the database for non-USD symbols', async () => {
      const btcCoin = createTestCoin({ symbol: 'btc' });
      coinRepository.findOne.mockResolvedValue(btcCoin);

      const result = await service.getCoinBySymbol('BTC');

      expect(coinRepository.findOne).toHaveBeenCalledWith({
        where: expect.objectContaining({ symbol: 'btc', delistedAt: IsNull() }),
        relations: undefined
      });
      expect(result.symbol).toBe('btc');
    });

    it('throws CoinNotFoundException when fail=true and coin not found', async () => {
      coinRepository.findOne.mockResolvedValue(null);

      await expect(service.getCoinBySymbol('FAKE')).rejects.toThrow(CoinNotFoundException);
    });

    it('returns null when fail=false and coin not found', async () => {
      coinRepository.findOne.mockResolvedValue(null);

      const result = await service.getCoinBySymbol('FAKE', undefined, false);
      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // getCoinById()
  // ===========================================================================
  describe('getCoinById()', () => {
    it('returns the coin when found', async () => {
      const coin = createTestCoin({ id: 'abc' });
      coinRepository.findOne.mockResolvedValue(coin);

      const result = await service.getCoinById('abc');
      expect(result.id).toBe('abc');
    });

    it('throws CoinNotFoundException when not found', async () => {
      coinRepository.findOne.mockResolvedValue(null);

      await expect(service.getCoinById('missing')).rejects.toThrow(CoinNotFoundException);
    });
  });

  // ===========================================================================
  // getCoinsByIds()
  // ===========================================================================
  describe('getCoinsByIds()', () => {
    it('returns empty array for empty input', async () => {
      expect(await service.getCoinsByIds([])).toEqual([]);
      expect(coinRepository.find).not.toHaveBeenCalled();
    });

    it('deduplicates and filters invalid IDs', async () => {
      coinRepository.find.mockResolvedValue([createTestCoin({ id: 'a' })]);

      await service.getCoinsByIds(['a', 'a', '', '  ']);

      const callArgs = coinRepository.find.mock.calls[0][0] as any;
      // Should deduplicate 'a','a' → ['a'] and filter out '' and '  '
      expect(callArgs.where.id._value).toEqual(['a']);
    });

    it('returns empty array when all IDs are invalid', async () => {
      const result = await service.getCoinsByIds(['', '  ']);

      expect(result).toEqual([]);
      expect(coinRepository.find).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Soft-delete and active filtering
  // ===========================================================================
  describe('getCoins() soft-delete filtering', () => {
    it('excludes delisted coins by default', async () => {
      coinRepository.find.mockResolvedValue([]);
      await service.getCoins();
      const callArg = coinRepository.find.mock.calls[0][0] as FindManyOptions<Coin>;
      expect(callArg.where).toEqual(expect.objectContaining({ delistedAt: IsNull() }));
    });

    it('includes delisted coins when includeDelisted is true', async () => {
      coinRepository.find.mockResolvedValue([]);
      await service.getCoins({ includeDelisted: true });
      const callArg = coinRepository.find.mock.calls[0][0] as FindManyOptions<Coin>;
      expect(callArg.where).toEqual({});
    });
  });

  describe('getCoinBySymbol() soft-delete filtering', () => {
    it('excludes delisted coins by default', async () => {
      const coin = createTestCoin({ symbol: 'btc' });
      coinRepository.findOne.mockResolvedValue(coin);
      await service.getCoinBySymbol('btc');
      const callArg = coinRepository.findOne.mock.calls[0][0] as FindOneOptions<Coin>;
      expect(callArg.where).toEqual(expect.objectContaining({ delistedAt: IsNull() }));
    });

    it('includes delisted coins when includeDelisted is true', async () => {
      const coin = createTestCoin({ symbol: 'btc' });
      coinRepository.findOne.mockResolvedValue(coin);
      await service.getCoinBySymbol('btc', undefined, true, true);
      const callArg = coinRepository.findOne.mock.calls[0][0] as FindOneOptions<Coin>;
      expect(callArg.where).not.toHaveProperty('delistedAt');
    });
  });

  describe('getMultipleCoinsBySymbol() soft-delete filtering', () => {
    it('excludes delisted coins by default', async () => {
      coinRepository.find.mockResolvedValue([]);
      await service.getMultipleCoinsBySymbol(['btc', 'eth']);
      const callArg = coinRepository.find.mock.calls[0][0] as FindManyOptions<Coin>;
      expect(callArg.where).toEqual(expect.objectContaining({ delistedAt: IsNull() }));
    });

    it('includes delisted coins when includeDelisted is true', async () => {
      coinRepository.find.mockResolvedValue([]);
      await service.getMultipleCoinsBySymbol(['btc', 'eth'], undefined, { includeDelisted: true });
      const callArg = coinRepository.find.mock.calls[0][0] as FindManyOptions<Coin>;
      expect(callArg.where).not.toHaveProperty('delistedAt');
    });
  });

  describe('getCoinsByIdsFiltered() soft-delete filtering', () => {
    let mockQb: Record<string, jest.Mock>;

    beforeEach(() => {
      mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([])
      };
      coinRepository.createQueryBuilder.mockReturnValue(mockQb as any);
    });

    it('excludes delisted coins by default', async () => {
      await service.getCoinsByIdsFiltered(['id1']);
      expect(mockQb.andWhere).toHaveBeenCalledWith('coin.delistedAt IS NULL');
    });

    it('includes delisted coins when includeDelisted is true', async () => {
      await service.getCoinsByIdsFiltered(['id1'], 100_000_000, 1_000_000, { includeDelisted: true });
      const delistedCalls = mockQb.andWhere.mock.calls.filter(
        (call: unknown[]) => call[0] === 'coin.delistedAt IS NULL'
      );
      expect(delistedCalls).toHaveLength(0);
    });
  });

  describe('remove() soft-delete', () => {
    it('sets delistedAt instead of deleting', async () => {
      const coin = createTestCoin({ id: 'abc' });
      coinRepository.findOne.mockResolvedValue(coin);
      coinRepository.save.mockResolvedValue({ ...coin, delistedAt: new Date() } as any);

      await service.remove('abc');

      expect(coinRepository.save).toHaveBeenCalledWith(expect.objectContaining({ delistedAt: expect.any(Date) }));
      expect(coinRepository.delete).not.toHaveBeenCalled();
    });
  });

  describe('removeMany() soft-delete', () => {
    let mockQb: Record<string, jest.Mock>;

    beforeEach(() => {
      mockQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 2 })
      };
      coinRepository.createQueryBuilder.mockReturnValue(mockQb as any);
    });

    it('sets delistedAt instead of calling delete', async () => {
      await service.removeMany(['id1', 'id2']);

      expect(mockQb.update).toHaveBeenCalled();
      expect(mockQb.set).toHaveBeenCalledWith({ delistedAt: expect.any(Date) });
      expect(mockQb.where).toHaveBeenCalledWith('id IN (:...ids)', { ids: ['id1', 'id2'] });
      expect(mockQb.andWhere).toHaveBeenCalledWith('delistedAt IS NULL');
      expect(mockQb.execute).toHaveBeenCalled();
      expect(coinRepository.delete).not.toHaveBeenCalled();
    });

    it('is a no-op for empty array', async () => {
      await service.removeMany([]);
      expect(coinRepository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('relistCoin()', () => {
    it('sets delistedAt to null', async () => {
      await service.relistCoin('abc');
      expect(coinRepository.update).toHaveBeenCalledWith('abc', { delistedAt: null });
    });
  });

  describe('hardRemoveMany()', () => {
    it('calls actual delete', async () => {
      await service.hardRemoveMany(['id1', 'id2']);
      expect(coinRepository.delete).toHaveBeenCalledWith({ id: In(['id1', 'id2']) });
    });

    it('is a no-op for empty array', async () => {
      await service.hardRemoveMany([]);
      expect(coinRepository.delete).not.toHaveBeenCalled();
    });
  });
});
