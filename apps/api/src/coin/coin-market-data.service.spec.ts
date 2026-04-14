import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { NotFoundError, RateLimitError } from '@coingecko/coingecko-typescript';
import { type Repository } from 'typeorm';

import { CoinMarketDataService } from './coin-market-data.service';
import { Coin } from './coin.entity';
import { CoinService } from './coin.service';

import { CoinNotFoundException } from '../common/exceptions/resource';
import { CircuitBreakerService } from '../shared';
import { CoinGeckoClientService } from '../shared/coingecko-client.service';

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

const makeCoinGeckoError = (status: number, _statusText: string, code?: string) => {
  if (code) return new Error(`Connection refused (${code})`);
  if (status === 404) return new NotFoundError(404, undefined, `Not Found`, undefined as unknown as Headers);
  if (status === 429) return new RateLimitError(429, undefined, `Too Many Requests`, undefined as unknown as Headers);
  return new Error(`got error from coin gecko. status code: ${status}`);
};

describe('CoinMarketDataService', () => {
  let service: CoinMarketDataService;
  let coinRepository: jest.Mocked<Repository<Coin>>;
  let coinService: { getCoinById: jest.Mock };
  let cacheManager: {
    get: jest.Mock<Promise<any>, [string]>;
    set: jest.Mock<Promise<void>, [string, any, number?]>;
    del: jest.Mock<Promise<void>, [string]>;
  };
  let geckoMock: { getID: jest.Mock; marketChartGet: jest.Mock };
  let circuitBreaker: { isOpen: jest.Mock; recordSuccess: jest.Mock; recordFailure: jest.Mock };
  let setTimeoutSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoinMarketDataService,
        {
          provide: getRepositoryToken(Coin),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            update: jest.fn().mockResolvedValue(undefined)
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
        },
        {
          provide: CoinService,
          useValue: {
            getCoinById: jest.fn()
          }
        },
        {
          provide: CoinGeckoClientService,
          useValue: { client: null } // replaced below after compile
        }
      ]
    }).compile();

    service = module.get<CoinMarketDataService>(CoinMarketDataService);
    coinRepository = module.get(getRepositoryToken(Coin));
    coinService = module.get(CoinService);
    cacheManager = module.get(CACHE_MANAGER);
    circuitBreaker = (service as any).circuitBreaker;

    geckoMock = {
      getID: jest.fn().mockResolvedValue({
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
      marketChartGet: jest.fn().mockResolvedValue({
        prices: [[Date.now(), 43000]],
        market_caps: [[Date.now(), 800000000000]],
        total_volumes: [[Date.now(), 35000000000]]
      })
    };

    // Wire mock into the service's injected CoinGeckoClientService
    (service as any).gecko = {
      client: {
        coins: {
          getID: geckoMock.getID,
          marketChart: { get: geckoMock.marketChartGet }
        }
      }
    };

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
  // getCoinHistoricalData()
  // ===========================================================================
  describe('getCoinHistoricalData()', () => {
    const coin = createTestCoin({ slug: 'bitcoin' });

    beforeEach(() => {
      coinService.getCoinById.mockResolvedValue(coin);
    });

    it('returns mapped historical data points from CoinGecko', async () => {
      const ts = Date.now();
      geckoMock.marketChartGet.mockResolvedValueOnce({
        prices: [
          [ts, 43000],
          [ts + 86400000, 44000]
        ],
        total_volumes: [
          [ts, 35000000000],
          [ts + 86400000, 36000000000]
        ],
        market_caps: [
          [ts, 800000000000],
          [ts + 86400000, 810000000000]
        ]
      });

      const result = await service.getCoinHistoricalData('coin-123');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ timestamp: ts, price: 43000, volume: 35000000000, marketCap: 800000000000 });
      expect(result[1]).toEqual({
        timestamp: ts + 86400000,
        price: 44000,
        volume: 36000000000,
        marketCap: 810000000000
      });
      expect(geckoMock.marketChartGet).toHaveBeenCalledWith(
        'bitcoin',
        expect.objectContaining({ vs_currency: 'usd', days: '365', interval: 'daily' })
      );
    });

    it('returns empty array when CoinGecko returns no prices', async () => {
      geckoMock.marketChartGet.mockResolvedValueOnce({ prices: [] });

      const result = await service.getCoinHistoricalData('coin-123');
      expect(result).toEqual([]);
    });

    it('throws CoinNotFoundException on 404 from CoinGecko', async () => {
      geckoMock.marketChartGet.mockRejectedValueOnce(makeCoinGeckoError(404, 'Not Found'));

      await expect(service.getCoinHistoricalData('coin-123')).rejects.toThrow(CoinNotFoundException);
    });

    it('returns cached data on cache hit without calling API', async () => {
      const cachedData = [{ timestamp: Date.now(), price: 43000, volume: 1000, marketCap: 800000000000 }];
      cacheManager.get.mockResolvedValueOnce(cachedData);

      const result = await service.getCoinHistoricalData('coin-123');

      expect(result).toBe(cachedData);
      expect(geckoMock.marketChartGet).not.toHaveBeenCalled();
    });

    it('returns stale data and skips API call when circuit breaker is open', async () => {
      const staleData = [{ timestamp: Date.now(), price: 42000, volume: 900, marketCap: 790000000000 }];
      circuitBreaker.isOpen.mockReturnValue(true);
      cacheManager.get
        .mockResolvedValueOnce(null) // primary cache miss
        .mockResolvedValueOnce(staleData); // stale cache hit

      const result = await service.getCoinHistoricalData('coin-123');

      expect(result).toBe(staleData);
      expect(geckoMock.marketChartGet).not.toHaveBeenCalled();
    });

    it('does not record circuit breaker failure on 404 (NotFoundError)', async () => {
      geckoMock.marketChartGet.mockRejectedValueOnce(makeCoinGeckoError(404, 'Not Found'));

      await expect(service.getCoinHistoricalData('coin-123')).rejects.toThrow(CoinNotFoundException);
      expect(circuitBreaker.recordFailure).not.toHaveBeenCalled();
    });

    it('returns stale data and records circuit breaker failure on non-404 errors', async () => {
      const staleData = [{ timestamp: Date.now(), price: 41000, volume: 800, marketCap: 780000000000 }];
      geckoMock.marketChartGet.mockRejectedValue(new Error('Network error'));
      cacheManager.get
        .mockResolvedValueOnce(null) // primary cache miss
        .mockResolvedValueOnce(staleData); // stale cache hit

      // Bypass retry delays so the test doesn't time out
      setTimeoutSpy.mockImplementation(((fn: (...args: any[]) => void) => {
        fn();
        return 0 as any;
      }) as any);

      const result = await service.getCoinHistoricalData('coin-123');
      expect(result).toBe(staleData);
      expect(circuitBreaker.recordFailure).toHaveBeenCalledWith('coingecko-chart');

      geckoMock.marketChartGet.mockReset();
    });
  });

  // ===========================================================================
  // fetchCoinDetail()
  // ===========================================================================
  describe('fetchCoinDetail()', () => {
    it('returns CoinGecko data and caches the result on cache miss', async () => {
      const result = await (service as any).fetchCoinDetail('bitcoin');

      expect(result.id).toBe('bitcoin');
      expect(cacheManager.set).toHaveBeenCalledWith('coingecko:detail:bitcoin', result, 300_000);
    });

    it('returns cached data on cache hit without calling API', async () => {
      const cached = { id: 'bitcoin', cached: true };
      cacheManager.get.mockResolvedValueOnce(cached);

      const result = await (service as any).fetchCoinDetail('bitcoin');

      expect(result).toBe(cached);
      expect(geckoMock.getID).not.toHaveBeenCalled();
    });

    it('falls back to cached data on 429 rate limit', async () => {
      const cachedDetail = { id: 'bitcoin', description: { en: 'cached' } };
      cacheManager.get.mockResolvedValueOnce(null); // first check: miss
      geckoMock.getID.mockRejectedValueOnce(makeCoinGeckoError(429, 'Too Many Requests'));
      cacheManager.get.mockResolvedValueOnce(cachedDetail); // fallback check: hit

      const result = await (service as any).fetchCoinDetail('bitcoin');
      expect(result).toBe(cachedDetail);
    });

    it('throws CoinNotFoundException on 404', async () => {
      cacheManager.get.mockResolvedValueOnce(null);
      geckoMock.getID.mockRejectedValueOnce(makeCoinGeckoError(404, 'Not Found'));

      await expect((service as any).fetchCoinDetail('invalid-coin')).rejects.toThrow(CoinNotFoundException);
    });

    it('re-throws non-CoinGecko errors', async () => {
      cacheManager.get.mockResolvedValueOnce(null);
      geckoMock.getID.mockRejectedValueOnce(new Error('Network error'));

      await expect((service as any).fetchCoinDetail('bitcoin')).rejects.toThrow('Network error');
    });
  });

  // ===========================================================================
  // fetchMarketChart()
  // ===========================================================================
  describe('fetchMarketChart()', () => {
    it('fetches chart data from CoinGecko, records success, and caches with correct TTL', async () => {
      const result = await (service as any).fetchMarketChart('bitcoin', 7);

      expect(result.prices).toBeInstanceOf(Array);
      expect(result.prices[0]).toHaveLength(2);
      expect(geckoMock.marketChartGet).toHaveBeenCalledWith(
        'bitcoin',
        expect.objectContaining({ vs_currency: 'usd', days: '7' })
      );
      expect(cacheManager.set).toHaveBeenCalledWith('coingecko:chart:bitcoin:7d', result, 900_000);
      expect(circuitBreaker.recordSuccess).toHaveBeenCalledWith('coingecko-chart');
    });

    it('returns cached chart data on cache hit', async () => {
      const cached = { prices: [[Date.now(), 50000]] };
      cacheManager.get.mockResolvedValueOnce(cached);

      const result = await (service as any).fetchMarketChart('bitcoin', 7);
      expect(result).toBe(cached);
      expect(geckoMock.marketChartGet).not.toHaveBeenCalled();
    });

    it('falls back to cached data and records failure on API error', async () => {
      const cachedChart = { prices: [[Date.now(), 42000]] };
      cacheManager.get.mockResolvedValueOnce(null); // primary cache: miss
      geckoMock.marketChartGet.mockRejectedValueOnce(makeCoinGeckoError(429, 'Too Many Requests'));
      cacheManager.get.mockResolvedValueOnce(cachedChart); // catch-block primary cache retry: hit

      const result = await (service as any).fetchMarketChart('bitcoin', 7);
      expect(result).toBe(cachedChart);
      expect(circuitBreaker.recordFailure).toHaveBeenCalledWith('coingecko-chart');
    });

    it('throws user-friendly error when all cache layers miss', async () => {
      cacheManager.get.mockResolvedValue(null);
      geckoMock.marketChartGet.mockRejectedValueOnce(makeCoinGeckoError(0, 'Connection refused', 'ECONNREFUSED'));

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
      expect(geckoMock.marketChartGet).not.toHaveBeenCalled();
    });

    it('throws when circuit breaker is open and no stale cache exists', async () => {
      circuitBreaker.isOpen.mockReturnValue(true);
      cacheManager.get.mockResolvedValue(null);

      await expect((service as any).fetchMarketChart('bitcoin', 7)).rejects.toThrow(
        'Unable to fetch chart data. Please try again later.'
      );
      expect(geckoMock.marketChartGet).not.toHaveBeenCalled();
    });

    it('falls back to stale cache when primary cache retry also misses', async () => {
      const staleChart = { prices: [[Date.now(), 39000]] };
      cacheManager.get
        .mockResolvedValueOnce(null) // primary cache: miss
        .mockResolvedValueOnce(null) // catch-block primary cache retry: miss
        .mockResolvedValueOnce(staleChart); // stale cache: hit
      geckoMock.marketChartGet.mockRejectedValueOnce(new Error('API down'));

      const result = await (service as any).fetchMarketChart('bitcoin', 7);
      expect(result).toBe(staleChart);
    });
  });

  // ===========================================================================
  // getCoinDetailBySlug()
  // ===========================================================================
  describe('getCoinDetailBySlug()', () => {
    it('returns a complete DTO without fetching CoinGecko when metadata is fresh', async () => {
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
      expect(geckoMock.getID).not.toHaveBeenCalled();
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

      expect(geckoMock.getID).toHaveBeenCalled();
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
      geckoMock.getID.mockRejectedValueOnce(new Error('API down'));

      const result = await (service as any).getCoinDetailBySlug('bitcoin');

      expect(result.description).toBe('DB description');
    });

    it('returns safe DTO defaults when coin has null links', async () => {
      const coinNoLinks = createTestCoin({
        slug: 'bitcoin',
        currentPrice: 43000,
        links: null,
        metadataLastUpdated: new Date() // fresh — skip CoinGecko
      });
      coinRepository.findOne.mockResolvedValue(coinNoLinks);

      const result = await (service as any).getCoinDetailBySlug('bitcoin');

      expect(result.links).toEqual({
        homepage: [],
        blockchainSite: [],
        officialForumUrl: [],
        repositoryUrl: []
      });
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

    it('propagates error when CoinGecko fails and no cache exists', async () => {
      coinRepository.findOne.mockResolvedValue(mockCoin());
      geckoMock.marketChartGet.mockRejectedValueOnce(new Error('API down'));
      cacheManager.get.mockResolvedValue(null); // no cache

      await expect((service as any).getMarketChart('bitcoin', '7d')).rejects.toThrow(
        'Unable to fetch chart data. Please try again later.'
      );
    });
  });
});
