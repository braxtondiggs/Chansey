import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';

import { CreateQueryOptions, injectQueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { CoinDetailResponseDto, MarketChartResponseDto, TimePeriod, UserHoldingsDto } from '@chansey/api-interfaces';

type CoinQueryOptions<TData, TKey extends readonly unknown[]> = Omit<
  CreateQueryOptions<TData, Error, TData, TKey>,
  'staleTime' | 'gcTime' | 'refetchInterval' | 'refetchIntervalInBackground' | 'enabled' | 'retry' | 'retryDelay'
> & {
  staleTime?: number;
  gcTime?: number;
  refetchInterval?: number | false;
  refetchIntervalInBackground?: boolean;
  enabled?: boolean;
  retry?: number | boolean;
  retryDelay?: number | ((attemptIndex: number, error: Error) => number);
};

/**
 * T024: TanStack Query hooks for coin detail page
 *
 * These hooks manage data fetching, caching, and auto-refresh for the coin detail page.
 * Uses TanStack Query (Angular) for optimal performance and UX.
 */
export class CoinDetailQueries {
  private http = inject(HttpClient);
  private queryClient = injectQueryClient();

  private getCoinDetailQueryFn(slug: string) {
    return () => lastValueFrom(this.http.get<CoinDetailResponseDto>(`/api/coins/${slug}`));
  }

  private getCoinPriceQueryFn(slug: string) {
    return () => lastValueFrom(this.http.get<CoinDetailResponseDto>(`/api/coins/${slug}`));
  }

  private getCoinHistoryQueryFn(slug: string, period: TimePeriod) {
    return () => lastValueFrom(this.http.get<MarketChartResponseDto>(`/api/coins/${slug}/chart?period=${period}`));
  }

  private getUserHoldingsQueryFn(slug: string) {
    return () => lastValueFrom(this.http.get<UserHoldingsDto>(`/api/coins/${slug}/holdings`));
  }

  /**
   * Fetch comprehensive coin detail by slug
   *
   * Includes: market data, description, links
   * Optionally includes userHoldings if authenticated
   *
   * @param slug Coin slug (e.g., 'bitcoin')
   * @param options Additional query options
   * @returns Query result with CoinDetailResponseDto
   *
   * Caching strategy:
   * - Stale time: 1 minute (data considered fresh for 1min)
   * - Cache time: 5 minutes (unused data kept for 5min)
   * - Refetch on window focus: yes
   */
  useCoinDetailQuery(
    slug: string,
    options?: {
      enabled?: boolean;
      staleTime?: number;
      gcTime?: number;
      retry?: number | boolean;
      retryDelay?: number | ((attemptIndex: number, error: Error) => number);
    }
  ): CoinQueryOptions<CoinDetailResponseDto, ['coin-detail', string]> {
    return {
      queryKey: ['coin-detail', slug],
      queryFn: this.getCoinDetailQueryFn(slug),
      staleTime: options?.staleTime ?? 60000, // 1 minute
      gcTime: options?.gcTime ?? 300000, // 5 minutes
      enabled: options?.enabled ?? true,
      retry: options?.retry ?? 1,
      retryDelay: options?.retryDelay ?? ((attemptIndex) => Math.min(500 * 2 ** attemptIndex, 2000))
    };
  }

  /**
   * Fetch current price data with auto-refresh
   *
   * This query aggressively refetches to keep prices up-to-date.
   * Used for the price display that updates every 30-60 seconds.
   *
   * @param slug Coin slug (e.g., 'bitcoin')
   * @param options Additional query options
   * @returns Query result with price data subset
   *
   * Caching strategy:
   * - Stale time: 30 seconds (data stale after 30s)
   * - Refetch interval: 45 seconds (auto-refetch every 45s)
   * - Refetch in background: yes (continues updating when tab not focused)
   */
  useCoinPriceQuery(
    slug: string,
    options?: {
      enabled?: boolean;
      staleTime?: number;
      refetchInterval?: number | false;
      refetchIntervalInBackground?: boolean;
      gcTime?: number;
      retry?: number | boolean;
      retryDelay?: number | ((attemptIndex: number, error: Error) => number);
    }
  ): CoinQueryOptions<CoinDetailResponseDto, ['coin-price', string]> {
    return {
      queryKey: ['coin-price', slug],
      queryFn: this.getCoinPriceQueryFn(slug),
      staleTime: options?.staleTime ?? 30000, // 30 seconds
      refetchInterval: options?.refetchInterval ?? 45000, // 45 seconds
      refetchIntervalInBackground: options?.refetchIntervalInBackground ?? true,
      gcTime: options?.gcTime ?? 120000, // 2 minutes
      enabled: options?.enabled ?? !!slug,
      retry: options?.retry ?? 1,
      retryDelay: options?.retryDelay ?? ((attemptIndex) => Math.min(500 * 2 ** attemptIndex, 2000))
    };
  }

  /**
   * Fetch historical price chart data for specified period
   *
   * Each period (24h, 7d, 30d, 1y) is cached separately.
   * Historical data doesn't change frequently, so longer stale time.
   *
   * @param slug Coin slug (e.g., 'bitcoin')
   * @param period Time period ('24h', '7d', '30d', '1y')
   * @param options Additional query options
   * @returns Query result with MarketChartResponseDto
   *
   * Caching strategy:
   * - Stale time: 5 minutes (historical data stable)
   * - Cache time: 15 minutes
   * - Separate cache per period
   */
  useCoinHistoryQuery(
    slug: string,
    period: TimePeriod,
    options?: {
      enabled?: boolean;
      staleTime?: number;
      gcTime?: number;
      retry?: number | boolean;
      retryDelay?: number | ((attemptIndex: number, error: Error) => number);
    }
  ): CoinQueryOptions<MarketChartResponseDto, ['coin-history', string, TimePeriod]> {
    return {
      queryKey: ['coin-history', slug, period],
      queryFn: this.getCoinHistoryQueryFn(slug, period),
      staleTime: options?.staleTime ?? 300000, // 5 minutes
      gcTime: options?.gcTime ?? 900000, // 15 minutes
      enabled: options?.enabled ?? !!slug,
      retry: options?.retry ?? 1,
      retryDelay: options?.retryDelay ?? ((attemptIndex) => Math.min(500 * 2 ** attemptIndex, 2000))
    };
  }

  /**
   * Fetch user holdings for a specific coin
   *
   * Only runs when user is authenticated (enabled=false otherwise).
   * Updates periodically to reflect recent trades.
   *
   * @param slug Coin slug (e.g., 'bitcoin')
   * @param isAuthenticated Whether user is logged in
   * @returns Query result with UserHoldingsDto
   *
   * Caching strategy:
   * - Enabled: only when authenticated
   * - Stale time: 2 minutes
   * - Refetch interval: 5 minutes (to catch new trades)
   * - Cache time: 10 minutes
   */
  useUserHoldingsQuery(
    slug: string,
    isAuthenticated: boolean,
    options?: {
      staleTime?: number;
      refetchInterval?: number | false;
      gcTime?: number;
      retry?: number | boolean;
      retryDelay?: number | ((attemptIndex: number, error: Error) => number);
    }
  ): CoinQueryOptions<UserHoldingsDto, ['user-holdings', string]> {
    if (!isAuthenticated) {
      return {
        queryKey: ['user-holdings', slug],
        queryFn: () => Promise.reject(new Error('User not authenticated')),
        enabled: false,
        staleTime: options?.staleTime ?? 120000,
        refetchInterval: options?.refetchInterval ?? false,
        gcTime: options?.gcTime ?? 600000,
        retry: options?.retry ?? 0,
        retryDelay: options?.retryDelay ?? 0
      };
    }

    return {
      queryKey: ['user-holdings', slug],
      queryFn: this.getUserHoldingsQueryFn(slug),
      enabled: true,
      staleTime: options?.staleTime ?? 120000, // 2 minutes
      refetchInterval: options?.refetchInterval ?? 300000, // 5 minutes
      gcTime: options?.gcTime ?? 600000, // 10 minutes
      retry: options?.retry ?? 0,
      retryDelay: options?.retryDelay ?? 0
    };
  }

  /**
   * Prefetch coin detail data
   *
   * Used for optimistic loading when hovering over coin links.
   * Warms the cache before user navigates.
   *
   * @param slug Coin slug to prefetch
   */
  prefetchCoinDetail(slug: string): Promise<void> {
    return this.queryClient.prefetchQuery({
      queryKey: ['coin-detail', slug],
      queryFn: () => lastValueFrom(this.http.get<CoinDetailResponseDto>(`/api/coins/${slug}`)),
      staleTime: 60000
    });
  }

  /**
   * Invalidate all queries for a specific coin
   *
   * Forces refetch of all data for the coin (detail, price, history, holdings).
   * Useful after user makes a trade or when data needs to be refreshed.
   *
   * @param slug Coin slug to invalidate
   */
  invalidateCoinQueries(slug: string): Promise<void> {
    return this.queryClient.invalidateQueries({
      queryKey: ['coin-detail', slug]
    });
  }
}
