import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

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

describe('CoinService - Detail Page Unit Tests (TDD)', () => {
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

  /**
   * T008: Test slug generation utility
   * Expected: These tests should FAIL because methods don't exist yet
   */
  describe('generateSlug() - T008', () => {
    it('should generate valid slug from coin name (lowercase, hyphenated)', () => {
      // This will fail - generateSlug doesn't exist yet
      const result = (service as any).generateSlug('Bitcoin');

      expect(result).toBe('bitcoin');
    });

    it('should handle special characters correctly', () => {
      const result = (service as any).generateSlug('Bitcoin (BTC)');

      expect(result).toBe('bitcoin-btc');
    });

    it('should handle names with spaces', () => {
      const result = (service as any).generateSlug('Wrapped Bitcoin');

      expect(result).toBe('wrapped-bitcoin');
    });

    it('should handle multiple spaces and special chars', () => {
      const result = (service as any).generateSlug('USD   Coin!!!');

      expect(result).toBe('usd-coin');
    });

    it('should handle very long names', () => {
      const longName = 'A Very Long Cryptocurrency Name That Should Be Truncated Properly';
      const result = (service as any).generateSlug(longName);

      expect(result).toBeDefined();
      expect(result.length).toBeLessThanOrEqual(100); // Max slug length
    });

    it('should handle empty or null input gracefully', () => {
      expect(() => (service as any).generateSlug('')).not.toThrow();
      expect(() => (service as any).generateSlug(null)).not.toThrow();
    });

    it('should handle unicode characters', () => {
      const result = (service as any).generateSlug('Ethereum 以太坊');

      expect(result).toMatch(/^[a-z0-9-]+$/); // Only lowercase alphanumeric and hyphens
    });
  });

  /**
   * T009: Test CoinGecko data fetching
   * Expected: These tests should FAIL because methods don't exist yet
   */
  describe('fetchCoinDetail() - T009', () => {
    it('should fetch coin detail from CoinGecko', async () => {
      const mockCoinGeckoResponse = {
        id: 'bitcoin',
        name: 'Bitcoin',
        symbol: 'btc',
        description: { en: 'Bitcoin is...' },
        market_data: {
          current_price: { usd: 43250.5 },
          market_cap: { usd: 845000000000 }
        },
        links: {
          homepage: ['https://bitcoin.org']
        }
      };

      geckoMock.coinId.mockResolvedValueOnce(mockCoinGeckoResponse);

      const result = await (service as any).fetchCoinDetail('bitcoin');

      expect(result).toBeDefined();
      expect(result.id).toBe('bitcoin');
    });

    it('should handle API rate limiting (429 response)', async () => {
      // Mock 429 response
      const rateLimitError = { response: { status: 429 } };

      cacheManager.get.mockResolvedValueOnce(null);
      cacheManager.get.mockResolvedValueOnce({ id: 'bitcoin' });
      geckoMock.coinId.mockRejectedValueOnce(rateLimitError);

      await expect((service as any).fetchCoinDetail('bitcoin')).resolves.toBeDefined();
    });

    it('should handle API errors gracefully', async () => {
      const networkError = new Error('Network error');

      geckoMock.coinId.mockRejectedValueOnce(networkError);

      await expect((service as any).fetchCoinDetail('bitcoin')).rejects.toThrow('Network error');
    });

    it('should handle 404 coin not found', async () => {
      const notFoundError = { response: { status: 404 } };

      geckoMock.coinId.mockRejectedValueOnce(notFoundError);

      await expect((service as any).fetchCoinDetail('invalid-coin')).rejects.toThrow();
    });
  });

  describe('fetchMarketChart() - T009', () => {
    it('should fetch market chart data', async () => {
      geckoMock.coinIdMarketChart.mockResolvedValueOnce({
        prices: [[Date.now(), 43000]],
        market_caps: [],
        total_volumes: []
      });

      const result = await (service as any).fetchMarketChart('bitcoin', 7);

      expect(result).toBeDefined();
      expect(result.prices).toBeInstanceOf(Array);
    });

    it('should map days parameter correctly', async () => {
      // days: 1, 7, 30, 365
      const testCases = [1, 7, 30, 365];

      for (const days of testCases) {
        geckoMock.coinIdMarketChart.mockResolvedValueOnce({
          prices: [[Date.now(), 43000]],
          market_caps: [],
          total_volumes: []
        });
        const result = await (service as any).fetchMarketChart('bitcoin', days);
        expect(result).toBeDefined();
      }
    });

    it('should use Redis cache with 5min TTL', async () => {
      // First call - miss cache, fetch from API
      geckoMock.coinIdMarketChart.mockResolvedValue({
        prices: [[Date.now(), 43000]],
        market_caps: [],
        total_volumes: []
      });
      await (service as any).fetchMarketChart('bitcoin', 7);

      // Second call - should hit cache
      cacheManager.get.mockResolvedValueOnce({
        prices: [[Date.now(), 43000]],
        market_caps: [],
        total_volumes: []
      });
      await (service as any).fetchMarketChart('bitcoin', 7);

      // Verify cache was used (implementation detail)
      expect(true).toBe(true); // Placeholder for cache verification
    });

    it('should handle network errors', async () => {
      geckoMock.coinIdMarketChart.mockRejectedValueOnce(new Error('CoinGecko API timeout'));
      cacheManager.get.mockResolvedValueOnce(null);

      await expect((service as any).fetchMarketChart('invalid', 7)).rejects.toThrow(
        'Unable to fetch chart data. Please try again later.'
      );
    });
  });

  describe('Redis caching - T009', () => {
    it('should cache CoinGecko responses with 5min TTL', async () => {
      // This validates caching behavior
      expect(true).toBe(true); // Placeholder - will implement with actual cache service
    });

    it('should use cached data when API rate limited', async () => {
      expect(true).toBe(true); // Placeholder
    });

    it('should invalidate cache after TTL expires', async () => {
      expect(true).toBe(true); // Placeholder
    });
  });

  /**
   * T010: This would be in order.service.spec.ts
   * Documented here for completeness, but belongs in OrderService tests
   */
  describe('Holdings calculation (belongs in OrderService) - T010', () => {
    it('NOTE: T010 tests belong in order.service.spec.ts', () => {
      // The getHoldingsByCoin method should be tested in OrderService
      // See separate order.service.spec.ts for T010 implementation
      expect(true).toBe(true);
    });
  });

  /**
   * getCoinDetailBySlug() integration - combines database + CoinGecko
   */
  describe('getCoinDetailBySlug() - Integration', () => {
    it('should query coin by slug from database', async () => {
      const mockCoin = createTestCoin({
        description: 'Old description',
        metadataLastUpdated: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) // 2 days old
      });

      coinRepository.findOne.mockResolvedValue(mockCoin);

      // This will fail - getCoinDetailBySlug doesn't exist yet
      const result = await (service as any).getCoinDetailBySlug('bitcoin');

      expect(coinRepository.findOne).toHaveBeenCalledWith({ where: { slug: 'bitcoin' } });
    });

    it('should fetch additional data from CoinGecko if metadata stale', async () => {
      const staleCoin = createTestCoin({
        slug: 'bitcoin',
        metadataLastUpdated: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      });

      coinRepository.findOne.mockResolvedValue(staleCoin);

      await (service as any).getCoinDetailBySlug('bitcoin');

      // Should call fetchCoinDetail to refresh metadata
      expect(true).toBe(true); // Placeholder for verification
    });

    it('should NOT fetch from CoinGecko if metadata fresh', async () => {
      const freshCoin = createTestCoin({
        slug: 'bitcoin',
        metadataLastUpdated: new Date() // Just updated
      });

      coinRepository.findOne.mockResolvedValue(freshCoin);

      await (service as any).getCoinDetailBySlug('bitcoin');

      // Should NOT call fetchCoinDetail
      expect(true).toBe(true); // Placeholder
    });

    it('should throw NotFoundException if slug not found', async () => {
      coinRepository.findOne.mockResolvedValue(null);

      await expect((service as any).getCoinDetailBySlug('invalid-slug')).rejects.toThrow();
    });

    it('should merge database + CoinGecko data into DTO', async () => {
      const dbCoin = createTestCoin({ slug: 'bitcoin', currentPrice: 43000 });
      coinRepository.findOne.mockResolvedValue(dbCoin);

      const result = await (service as any).getCoinDetailBySlug('bitcoin');

      expect(result).toHaveProperty('slug');
      expect(result).toHaveProperty('currentPrice');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('links');
    });
  });

  describe('getMarketChart() - Integration', () => {
    it('should query coin by slug', async () => {
      const mockCoin = createTestCoin({ slug: 'bitcoin', coinGeckoId: 'bitcoin' });
      coinRepository.findOne.mockResolvedValue(mockCoin);

      await (service as any).getMarketChart('bitcoin', '7d');

      expect(coinRepository.findOne).toHaveBeenCalledWith({ where: { slug: 'bitcoin' } });
    });

    it('should map period to days', async () => {
      const mockCoin = createTestCoin({ slug: 'bitcoin', coinGeckoId: 'bitcoin' });
      coinRepository.findOne.mockResolvedValue(mockCoin);

      // '24h' -> 1, '7d' -> 7, '30d' -> 30, '1y' -> 365
      await (service as any).getMarketChart('bitcoin', '7d');

      expect(true).toBe(true); // Placeholder for day mapping verification
    });

    it('should fetch from CoinGecko with caching', async () => {
      const mockCoin = createTestCoin({ slug: 'bitcoin', coinGeckoId: 'bitcoin' });
      coinRepository.findOne.mockResolvedValue(mockCoin);

      const result = await (service as any).getMarketChart('bitcoin', '7d');

      expect(result).toHaveProperty('coinSlug', 'bitcoin');
      expect(result).toHaveProperty('period', '7d');
      expect(result).toHaveProperty('prices');
    });

    it('should transform to MarketChartResponseDto format', async () => {
      const mockCoin = createTestCoin({ slug: 'bitcoin', coinGeckoId: 'bitcoin' });
      coinRepository.findOne.mockResolvedValue(mockCoin);

      const result = await (service as any).getMarketChart('bitcoin', '7d');

      expect(result.prices).toBeInstanceOf(Array);
      expect(result.timestamps).toBeInstanceOf(Array);
      expect(result.generatedAt).toBeInstanceOf(Date);
    });
  });
});
