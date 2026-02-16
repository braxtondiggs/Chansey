import { Injectable, Signal } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { Coin, CreatePortfolioDto, PortfolioItem } from '@chansey/api-interfaces';
import {
  authenticatedFetch,
  FREQUENT_POLICY,
  queryKeys,
  STANDARD_POLICY,
  TIME,
  useAuthMutation,
  useAuthQuery
} from '@chansey/shared';

/**
 * Service for prices page data via TanStack Query
 *
 * Provides queries for coin listings, watchlist, and price data.
 */
@Injectable({
  providedIn: 'root'
})
export class PriceService {
  /**
   * Query all coins for price listing
   */
  useCoins() {
    return useAuthQuery<Coin[]>(queryKeys.coins.lists(), '/api/coin', {
      cachePolicy: STANDARD_POLICY
    });
  }

  /**
   * Query user's watchlist
   */
  useWatchlist() {
    return useAuthQuery<PortfolioItem[]>(queryKeys.coins.watchlist(), '/api/portfolio?type=MANUAL', {
      cachePolicy: FREQUENT_POLICY
    });
  }

  /**
   * Query real-time prices for specific coins
   *
   * Uses a reactive signal for coin IDs to enable dynamic refetching
   */
  usePrices(coins: Signal<string>) {
    return injectQuery(() => {
      const coinValue = coins();
      return {
        queryKey: queryKeys.prices.byIds(coinValue),
        queryFn: () =>
          authenticatedFetch<Record<string, { usd: number }>>(
            `/api/simple/price?ids=${coinValue}&vs_currencies=usd&include_24hr_vol=false&include_market_cap=false&include_24hr_change=false&include_last_updated_at=false`
          ),
        staleTime: TIME.MINUTES.m1,
        gcTime: TIME.MINUTES.m5,
        refetchInterval: TIME.MINUTES.m1,
        refetchOnWindowFocus: true,
        enabled: !!coinValue
      };
    });
  }

  /**
   * Add a coin to watchlist
   */
  useAddToWatchlist() {
    return useAuthMutation<{ id: string }, CreatePortfolioDto>('/api/portfolio', 'POST', {
      invalidateQueries: [queryKeys.coins.watchlist()]
    });
  }

  /**
   * Remove a coin from watchlist
   */
  useRemoveFromWatchlist() {
    return useAuthMutation<void, string>((portfolioId: string) => `/api/portfolio/${portfolioId}`, 'DELETE', {
      invalidateQueries: [queryKeys.coins.watchlist()]
    });
  }
}
