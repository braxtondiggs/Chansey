import { Injectable } from '@angular/core';

import { injectQueryClient } from '@tanstack/angular-query-experimental';

import { CoinDetailResponseDto, MarketChartResponseDto, TimePeriod, UserHoldingsDto } from '@chansey/api-interfaces';
import {
  queryKeys,
  authenticatedFetch,
  STANDARD_POLICY,
  REALTIME_POLICY,
  STABLE_POLICY,
  FREQUENT_POLICY,
  TIME,
  mergeCachePolicy,
  type CachePolicy
} from '@chansey/shared';

/**
 * TanStack Query configuration for coin detail pages
 *
 * Provides query configurations for fetching coin data with appropriate
 * caching strategies for different types of data.
 */
@Injectable({
  providedIn: 'root'
})
export class CoinDetailQueries {
  private queryClient = injectQueryClient();

  /**
   * Query config for fetching comprehensive coin detail
   *
   * Uses STANDARD policy - data changes moderately often
   */
  useCoinDetailQuery(slug: string, options?: { enabled?: boolean }) {
    return {
      queryKey: queryKeys.coins.detail(slug),
      queryFn: () => authenticatedFetch<CoinDetailResponseDto>(`/api/coins/${slug}`),
      ...STANDARD_POLICY,
      enabled: options?.enabled ?? !!slug
    };
  }

  /**
   * Query config for live price data with auto-refresh
   *
   * Uses REALTIME policy - prices need frequent updates
   */
  useCoinPriceQuery(slug: string, options?: { enabled?: boolean }) {
    return {
      queryKey: queryKeys.coins.price(slug),
      queryFn: () => authenticatedFetch<CoinDetailResponseDto>(`/api/coins/${slug}`),
      ...REALTIME_POLICY,
      enabled: options?.enabled ?? !!slug
    };
  }

  /**
   * Query config for historical chart data
   *
   * Uses STABLE policy - historical data rarely changes
   */
  useCoinHistoryQuery(slug: string, period: TimePeriod, options?: { enabled?: boolean }) {
    return {
      queryKey: queryKeys.coins.chart(slug, period),
      queryFn: () => authenticatedFetch<MarketChartResponseDto>(`/api/coins/${slug}/chart?period=${period}`),
      ...STABLE_POLICY,
      gcTime: TIME.MINUTES.m15,
      enabled: options?.enabled ?? !!slug
    };
  }

  /**
   * Query config for user holdings
   *
   * Uses FREQUENT policy - holdings may change with trades
   * Only enabled when user is authenticated
   */
  useUserHoldingsQuery(slug: string, isAuthenticated: boolean) {
    const policy: CachePolicy = isAuthenticated
      ? mergeCachePolicy(FREQUENT_POLICY, {
          staleTime: TIME.MINUTES.m2,
          refetchInterval: TIME.MINUTES.m5,
          gcTime: TIME.MINUTES.m10
        })
      : { ...FREQUENT_POLICY, retry: 0 };

    return {
      queryKey: queryKeys.coins.holdings(slug),
      queryFn: isAuthenticated
        ? () => authenticatedFetch<UserHoldingsDto>(`/api/coins/${slug}/holdings`)
        : () => Promise.reject(new Error('User not authenticated')),
      ...policy,
      enabled: isAuthenticated && !!slug
    };
  }

  /**
   * Prefetch coin detail data for optimistic loading
   */
  prefetchCoinDetail(slug: string): Promise<void> {
    return this.queryClient.prefetchQuery({
      queryKey: queryKeys.coins.detail(slug),
      queryFn: () => authenticatedFetch<CoinDetailResponseDto>(`/api/coins/${slug}`),
      staleTime: STANDARD_POLICY.staleTime
    });
  }

  /**
   * Invalidate all queries for a specific coin
   */
  invalidateCoinQueries(slug: string): Promise<void> {
    return this.queryClient.invalidateQueries({
      queryKey: queryKeys.coins.detail(slug)
    });
  }

  /**
   * Invalidate all coin-related queries
   */
  invalidateAllCoinQueries(): Promise<void> {
    return this.queryClient.invalidateQueries({
      queryKey: queryKeys.coins.all
    });
  }
}
