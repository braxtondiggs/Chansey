import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AxiosError, AxiosHeaders } from 'axios';
import { Repository } from 'typeorm';

import { Coin } from './coin.entity';
import { CoinService } from './coin.service';

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

const makeAxiosError = (status: number, statusText: string, code?: string) =>
  Object.assign(
    new AxiosError(statusText, code ?? String(status), undefined, undefined, {
      status,
      statusText,
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: {}
    }),
    code ? { code } : {}
  );

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
  // generateSlug()
  // ===========================================================================
  describe('generateSlug()', () => {
    it.each([
      ['Bitcoin', 'bitcoin'],
      ['Bitcoin (BTC)', 'bitcoin-btc'],
      ['Wrapped Bitcoin', 'wrapped-bitcoin'],
      ['USD   Coin!!!', 'usd-coin']
    ])('converts "%s" → "%s"', (input, expected) => {
      expect((service as any).generateSlug(input)).toBe(expected);
    });

    it('truncates slugs longer than 100 characters', () => {
      const longName =
        'A Very Long Cryptocurrency Name That Should Be Truncated Properly And Keeps Going Until It Exceeds The Limit';
      const result = (service as any).generateSlug(longName);
      expect(result.length).toBeLessThanOrEqual(100);
      expect(result).toMatch(/^[a-z0-9-]+$/);
    });

    it('handles empty and null input without throwing', () => {
      expect((service as any).generateSlug('')).toBe('');
      expect((service as any).generateSlug(null)).toBe('');
    });

    it('strips unicode characters, keeping only alphanumeric and hyphens', () => {
      expect((service as any).generateSlug('Ethereum 以太坊')).toMatch(/^[a-z0-9-]+$/);
    });
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
      geckoMock.coinId.mockRejectedValueOnce(makeAxiosError(429, 'Too Many Requests'));
      cacheManager.get.mockResolvedValueOnce(cachedDetail); // fallback check: hit

      const result = await (service as any).fetchCoinDetail('bitcoin');
      expect(result).toBe(cachedDetail);
    });

    it('throws CoinNotFoundException on 404', async () => {
      cacheManager.get.mockResolvedValueOnce(null);
      geckoMock.coinId.mockRejectedValueOnce(makeAxiosError(404, 'Not Found'));

      await expect((service as any).fetchCoinDetail('invalid-coin')).rejects.toThrow();
    });

    it('re-throws non-Axios errors', async () => {
      cacheManager.get.mockResolvedValueOnce(null);
      geckoMock.coinId.mockRejectedValueOnce(new Error('Network error'));

      await expect((service as any).fetchCoinDetail('bitcoin')).rejects.toThrow('Network error');
    });
  });

  // ===========================================================================
  // fetchMarketChart()
  // ===========================================================================
  describe('fetchMarketChart()', () => {
    it('fetches chart data from CoinGecko and caches the result', async () => {
      const result = await (service as any).fetchMarketChart('bitcoin', 7);

      expect(result.prices).toBeInstanceOf(Array);
      expect(result.prices[0]).toHaveLength(2);
      expect(geckoMock.coinIdMarketChart).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'bitcoin', vs_currency: 'usd', days: 7 })
      );
      expect(cacheManager.set).toHaveBeenCalledWith('coingecko:chart:bitcoin:7d', result, 300);
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
      geckoMock.coinIdMarketChart.mockRejectedValueOnce(makeAxiosError(0, 'Connection refused', 'ECONNREFUSED'));

      await expect((service as any).fetchMarketChart('bitcoin', 7)).rejects.toThrow(
        'Unable to fetch chart data. Please try again later.'
      );
    });

    it('falls back to cached data on 429 rate limit', async () => {
      const cachedChart = { prices: [[Date.now(), 42000]] };
      cacheManager.get.mockResolvedValueOnce(null); // first check: miss
      geckoMock.coinIdMarketChart.mockRejectedValueOnce(makeAxiosError(429, 'Too Many Requests'));
      cacheManager.get.mockResolvedValueOnce(cachedChart); // fallback check: hit

      const result = await (service as any).fetchMarketChart('bitcoin', 7);
      expect(result).toBe(cachedChart);
    });

    it('falls back to cached data on timeout', async () => {
      const cachedChart = { prices: [[Date.now(), 41000]] };
      cacheManager.get.mockResolvedValueOnce(null);
      geckoMock.coinIdMarketChart.mockRejectedValueOnce(new Error('CoinGecko API timeout'));
      cacheManager.get.mockResolvedValueOnce(cachedChart);

      const result = await (service as any).fetchMarketChart('bitcoin', 7);
      expect(result).toBe(cachedChart);
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

    it('throws NotFoundException when slug does not exist', async () => {
      coinRepository.findOne.mockResolvedValue(null);

      await expect((service as any).getCoinDetailBySlug('invalid-slug')).rejects.toThrow();
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

    it('queries coin by slug from the database', async () => {
      coinRepository.findOne.mockResolvedValue(mockCoin());

      await (service as any).getMarketChart('bitcoin', '7d');

      expect(coinRepository.findOne).toHaveBeenCalledWith({ where: { slug: 'bitcoin' } });
    });

    it('throws NotFoundException when slug does not exist', async () => {
      coinRepository.findOne.mockResolvedValue(null);

      await expect((service as any).getMarketChart('missing', '7d')).rejects.toThrow();
    });

    it('falls back to mock chart data when CoinGecko fails', async () => {
      coinRepository.findOne.mockResolvedValue(mockCoin());
      geckoMock.coinIdMarketChart.mockRejectedValueOnce(new Error('API down'));
      cacheManager.get.mockResolvedValue(null); // no cache

      const result = await (service as any).getMarketChart('bitcoin', '7d');

      // Should still return valid chart data (mock fallback)
      expect(result.coinSlug).toBe('bitcoin');
      expect(result.prices.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // getCoinBySymbol()
  // ===========================================================================
  describe('getCoinBySymbol()', () => {
    it('returns a virtual USD coin for "usd" symbol', async () => {
      const result = await service.getCoinBySymbol('usd');

      expect(result.id).toBe('USD-virtual');
      expect(result.symbol).toBe('USD');
      expect(result.name).toBe('US Dollar');
      expect(coinRepository.findOne).not.toHaveBeenCalled();
    });

    it('is case-insensitive for USD', async () => {
      const result = await service.getCoinBySymbol('USD');
      expect(result.id).toBe('USD-virtual');
    });

    it('queries the database for non-USD symbols', async () => {
      const btcCoin = createTestCoin({ symbol: 'btc' });
      coinRepository.findOne.mockResolvedValue(btcCoin);

      const result = await service.getCoinBySymbol('BTC');

      expect(coinRepository.findOne).toHaveBeenCalledWith({
        where: { symbol: 'btc' },
        relations: undefined
      });
      expect(result.symbol).toBe('btc');
    });

    it('throws CoinNotFoundException when fail=true and coin not found', async () => {
      coinRepository.findOne.mockResolvedValue(null);

      await expect(service.getCoinBySymbol('FAKE')).rejects.toThrow();
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

      await expect(service.getCoinById('missing')).rejects.toThrow();
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

      expect(coinRepository.find).toHaveBeenCalledWith(expect.objectContaining({ where: { id: expect.anything() } }));
    });
  });
});
