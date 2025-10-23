import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { QueryClient } from '@tanstack/query-core';
import { of, throwError } from 'rxjs';

import { CoinDetailQueries } from './coin-detail.queries';

/**
 * T013: TanStack Query Hooks Tests (TDD)
 * Expected: These tests should FAIL because the queries service doesn't exist yet
 */
describe('CoinDetailQueries - T013', () => {
  let queries: CoinDetailQueries;
  let httpClient: jest.Mocked<HttpClient>;
  let queryClient: QueryClient;

  const mockCoinDetail = {
    id: 'coin-uuid-123',
    slug: 'bitcoin',
    name: 'Bitcoin',
    symbol: 'BTC',
    imageUrl: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
    currentPrice: 43250.5,
    priceChange24h: 1250.75,
    priceChange24hPercent: 2.98,
    marketCap: 845000000000,
    marketCapRank: 1,
    volume24h: 28500000000,
    circulatingSupply: 19500000,
    totalSupply: 21000000,
    maxSupply: 21000000,
    description: 'Bitcoin is a decentralized cryptocurrency...',
    links: {
      homepage: ['https://bitcoin.org'],
      blockchainSite: ['https://blockchain.com'],
      officialForumUrl: ['https://bitcointalk.org'],
      subredditUrl: 'https://reddit.com/r/bitcoin',
      repositoryUrl: ['https://github.com/bitcoin/bitcoin']
    },
    lastUpdated: new Date(),
    metadataLastUpdated: new Date()
  };

  const mockChartData = {
    coinSlug: 'bitcoin',
    period: '7d' as const,
    prices: [
      { timestamp: 1697846400000, price: 42000.5 },
      { timestamp: 1697932800000, price: 42500.25 }
    ],
    timestamps: [1697846400000, 1697932800000],
    generatedAt: new Date()
  };

  const mockUserHoldings = {
    coinSymbol: 'BTC',
    totalAmount: 0.5,
    averageBuyPrice: 38000,
    currentValue: 21625.25,
    profitLoss: 2625.25,
    profitLossPercent: 13.82,
    exchanges: [{ exchangeName: 'Binance', amount: 0.3, lastSynced: new Date() }]
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false, // Disable retries in tests
          gcTime: Infinity // Prevent garbage collection during tests
        }
      }
    });

    httpClient = {
      get: jest.fn()
    } as any;

    TestBed.configureTestingModule({
      providers: [
        CoinDetailQueries,
        { provide: HttpClient, useValue: httpClient },
        { provide: QueryClient, useValue: queryClient }
      ]
    });

    queries = TestBed.inject(CoinDetailQueries);
  });

  afterEach(() => {
    queryClient.clear();
  });

  /**
   * T013.1: Test useCoinDetailQuery fetches detail data
   */
  describe('useCoinDetailQuery', () => {
    it('should fetch coin detail data from API', async () => {
      httpClient.get.mockReturnValue(of(mockCoinDetail));

      const query = queries.useCoinDetailQuery('bitcoin');
      const result = await queryClient.fetchQuery(query);

      expect(httpClient.get).toHaveBeenCalledWith('/api/coins/bitcoin');
      expect(result).toEqual(mockCoinDetail);
    });

    it('should use correct query key with slug', () => {
      const query = queries.useCoinDetailQuery('bitcoin');

      expect(query.queryKey).toEqual(['coin-detail', 'bitcoin']);
    });

    it('should cache coin detail data', async () => {
      httpClient.get.mockReturnValue(of(mockCoinDetail));

      const query = queries.useCoinDetailQuery('bitcoin');

      // First fetch
      await queryClient.fetchQuery(query);

      // Second fetch should use cache
      const cachedData = queryClient.getQueryData(['coin-detail', 'bitcoin']);

      expect(cachedData).toEqual(mockCoinDetail);
    });

    it('should refetch when slug changes', async () => {
      httpClient.get.mockReturnValue(of(mockCoinDetail));

      const queryBtc = queries.useCoinDetailQuery('bitcoin');
      await queryClient.fetchQuery(queryBtc);

      const queryEth = queries.useCoinDetailQuery('ethereum');
      await queryClient.fetchQuery(queryEth);

      expect(httpClient.get).toHaveBeenCalledWith('/api/coins/bitcoin');
      expect(httpClient.get).toHaveBeenCalledWith('/api/coins/ethereum');
    });

    it('should be enabled by default', () => {
      const query = queries.useCoinDetailQuery('bitcoin');

      expect(query.enabled).toBe(true);
    });

    it('should allow disabling the query', () => {
      const query = queries.useCoinDetailQuery('bitcoin', { enabled: false });

      expect(query.enabled).toBe(false);
    });
  });

  /**
   * T013.2: Test useCoinPriceQuery auto-refetches every 45s
   */
  describe('useCoinPriceQuery', () => {
    it('should fetch current price data', async () => {
      const priceData = { currentPrice: 43250.5, priceChange24hPercent: 2.98 };
      httpClient.get.mockReturnValue(of(priceData));

      const query = queries.useCoinPriceQuery('bitcoin');
      const result = await queryClient.fetchQuery(query);

      expect(httpClient.get).toHaveBeenCalledWith('/api/coins/bitcoin');
      expect(result).toEqual(priceData);
    });

    it('should auto-refetch every 45 seconds', () => {
      const query = queries.useCoinPriceQuery('bitcoin');

      expect(query.refetchInterval).toBe(45000); // 45 seconds in milliseconds
    });

    it('should use correct query key', () => {
      const query = queries.useCoinPriceQuery('bitcoin');

      expect(query.queryKey).toEqual(['coin-price', 'bitcoin']);
    });

    it('should continue refetching when window is not focused', () => {
      const query = queries.useCoinPriceQuery('bitcoin');

      // refetchIntervalInBackground should be true to continue updates
      expect(query.refetchIntervalInBackground).toBe(true);
    });

    it('should have short stale time for real-time prices', () => {
      const query = queries.useCoinPriceQuery('bitcoin');

      // Stale time should be less than refetch interval
      expect(query.staleTime).toBeLessThan(45000);
    });
  });

  /**
   * T013.3: Test useCoinHistoryQuery keyed by period
   */
  describe('useCoinHistoryQuery', () => {
    it('should fetch market chart data for 24h period', async () => {
      const chartData24h = { ...mockChartData, period: '24h' as const };
      httpClient.get.mockReturnValue(of(chartData24h));

      const query = queries.useCoinHistoryQuery('bitcoin', '24h');
      const result = await queryClient.fetchQuery(query);

      expect(httpClient.get).toHaveBeenCalledWith('/api/coins/bitcoin/chart?period=24h');
      expect(result).toEqual(chartData24h);
    });

    it('should fetch market chart data for 7d period', async () => {
      httpClient.get.mockReturnValue(of(mockChartData));

      const query = queries.useCoinHistoryQuery('bitcoin', '7d');
      await queryClient.fetchQuery(query);

      expect(httpClient.get).toHaveBeenCalledWith('/api/coins/bitcoin/chart?period=7d');
    });

    it('should fetch market chart data for 30d period', async () => {
      const chartData30d = { ...mockChartData, period: '30d' as const };
      httpClient.get.mockReturnValue(of(chartData30d));

      const query = queries.useCoinHistoryQuery('bitcoin', '30d');
      await queryClient.fetchQuery(query);

      expect(httpClient.get).toHaveBeenCalledWith('/api/coins/bitcoin/chart?period=30d');
    });

    it('should fetch market chart data for 1y period', async () => {
      const chartData1y = { ...mockChartData, period: '1y' as const };
      httpClient.get.mockReturnValue(of(chartData1y));

      const query = queries.useCoinHistoryQuery('bitcoin', '1y');
      await queryClient.fetchQuery(query);

      expect(httpClient.get).toHaveBeenCalledWith('/api/coins/bitcoin/chart?period=1y');
    });

    it('should use query key with both slug and period', () => {
      const query = queries.useCoinHistoryQuery('bitcoin', '7d');

      expect(query.queryKey).toEqual(['coin-history', 'bitcoin', '7d']);
    });

    it('should cache separately for each period', async () => {
      httpClient.get.mockReturnValue(of(mockChartData));

      const query24h = queries.useCoinHistoryQuery('bitcoin', '24h');
      const query7d = queries.useCoinHistoryQuery('bitcoin', '7d');

      await queryClient.fetchQuery(query24h);
      await queryClient.fetchQuery(query7d);

      // Both should be cached separately
      const cached24h = queryClient.getQueryData(['coin-history', 'bitcoin', '24h']);
      const cached7d = queryClient.getQueryData(['coin-history', 'bitcoin', '7d']);

      expect(cached24h).toBeDefined();
      expect(cached7d).toBeDefined();
      expect(httpClient.get).toHaveBeenCalledTimes(2);
    });

    it('should have longer stale time for historical data', () => {
      const query = queries.useCoinHistoryQuery('bitcoin', '7d');

      // Historical data doesn't change frequently, can be cached longer
      expect(query.staleTime).toBeGreaterThan(0);
    });
  });

  /**
   * T013.4: Test useUserHoldingsQuery only runs when authenticated
   */
  describe('useUserHoldingsQuery', () => {
    it('should fetch user holdings when authenticated', async () => {
      httpClient.get.mockReturnValue(of(mockUserHoldings));

      const query = queries.useUserHoldingsQuery('bitcoin', true);
      const result = await queryClient.fetchQuery(query);

      expect(httpClient.get).toHaveBeenCalledWith('/api/coins/bitcoin/holdings');
      expect(result).toEqual(mockUserHoldings);
    });

    it('should be enabled when authenticated', () => {
      const query = queries.useUserHoldingsQuery('bitcoin', true);

      expect(query.enabled).toBe(true);
    });

    it('should be disabled when NOT authenticated', () => {
      const query = queries.useUserHoldingsQuery('bitcoin', false);

      expect(query.enabled).toBe(false);
    });

    it('should NOT fetch when authenticated is false', async () => {
      const query = queries.useUserHoldingsQuery('bitcoin', false);

      // Attempting to fetch disabled query should not call the API
      await expect(queryClient.fetchQuery(query)).rejects.toThrow();
      expect(httpClient.get).not.toHaveBeenCalled();
    });

    it('should use correct query key', () => {
      const query = queries.useUserHoldingsQuery('bitcoin', true);

      expect(query.queryKey).toEqual(['user-holdings', 'bitcoin']);
    });

    it('should refetch holdings periodically', () => {
      const query = queries.useUserHoldingsQuery('bitcoin', true);

      // Holdings should refetch to stay up-to-date with trades
      expect(query.refetchInterval).toBeGreaterThan(0);
    });
  });

  /**
   * T013.5: Test error handling and retry logic
   */
  describe('Error Handling and Retry', () => {
    it('should handle network errors in coin detail query', async () => {
      const networkError = new Error('Network error');
      httpClient.get.mockReturnValue(throwError(() => networkError));

      const query = queries.useCoinDetailQuery('bitcoin');

      await expect(queryClient.fetchQuery(query)).rejects.toThrow('Network error');
    });

    it('should handle 404 errors for invalid coin slug', async () => {
      const notFoundError = { status: 404, message: 'Coin not found' };
      httpClient.get.mockReturnValue(throwError(() => notFoundError));

      const query = queries.useCoinDetailQuery('invalid-coin');

      await expect(queryClient.fetchQuery(query)).rejects.toMatchObject({ status: 404 });
    });

    it('should retry failed requests', () => {
      const query = queries.useCoinDetailQuery('bitcoin');

      // Retry should be configured (default is usually 3)
      expect(query.retry).toBeGreaterThanOrEqual(0);
    });

    it('should have exponential backoff for retries', () => {
      const query = queries.useCoinDetailQuery('bitcoin');

      // retryDelay should be a function for exponential backoff
      expect(typeof query.retryDelay).toBe('function');
    });

    it('should handle chart data fetch errors', async () => {
      const apiError = new Error('Chart data unavailable');
      httpClient.get.mockReturnValue(throwError(() => apiError));

      const query = queries.useCoinHistoryQuery('bitcoin', '7d');

      await expect(queryClient.fetchQuery(query)).rejects.toThrow('Chart data unavailable');
    });

    it('should handle holdings fetch errors when authenticated', async () => {
      const authError = { status: 401, message: 'Unauthorized' };
      httpClient.get.mockReturnValue(throwError(() => authError));

      const query = queries.useUserHoldingsQuery('bitcoin', true);

      await expect(queryClient.fetchQuery(query)).rejects.toMatchObject({ status: 401 });
    });

    it('should provide error object with helpful message', async () => {
      const serverError = { status: 500, message: 'Internal server error' };
      httpClient.get.mockReturnValue(throwError(() => serverError));

      const query = queries.useCoinDetailQuery('bitcoin');

      try {
        await queryClient.fetchQuery(query);
      } catch (error: any) {
        expect(error.status).toBe(500);
        expect(error.message).toBeTruthy();
      }
    });
  });

  describe('Cache Configuration', () => {
    it('should have appropriate cache time for coin detail', () => {
      const query = queries.useCoinDetailQuery('bitcoin');

      // gcTime (garbage collection time) should be set
      expect(query.gcTime).toBeGreaterThan(0);
    });

    it('should keep unused data in cache for reasonable time', () => {
      const query = queries.useCoinDetailQuery('bitcoin');

      // gcTime should be at least 5 minutes (300000ms)
      expect(query.gcTime).toBeGreaterThanOrEqual(300000);
    });

    it('should mark data as stale appropriately', () => {
      const priceQuery = queries.useCoinPriceQuery('bitcoin');
      const historyQuery = queries.useCoinHistoryQuery('bitcoin', '7d');

      // Price data should have shorter stale time than historical data
      expect(priceQuery.staleTime).toBeLessThan(historyQuery.staleTime || Infinity);
    });
  });

  describe('Query Options Override', () => {
    it('should allow custom options for coin detail query', async () => {
      httpClient.get.mockReturnValue(of(mockCoinDetail));

      const customOptions = { staleTime: 10000, enabled: false };
      const query = queries.useCoinDetailQuery('bitcoin', customOptions);

      expect(query.staleTime).toBe(10000);
      expect(query.enabled).toBe(false);
    });

    it('should merge custom options with defaults', async () => {
      httpClient.get.mockReturnValue(of(mockCoinDetail));

      const customOptions = { retry: 5 };
      const query = queries.useCoinDetailQuery('bitcoin', customOptions);

      expect(query.retry).toBe(5);
      expect(query.queryKey).toEqual(['coin-detail', 'bitcoin']); // Default key still works
    });
  });
});
