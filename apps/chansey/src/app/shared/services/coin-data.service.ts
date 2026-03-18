import { Injectable, Signal } from '@angular/core';

import { Coin, CoinSelectionItem, CreateCoinSelectionDto } from '@chansey/api-interfaces';
import { FREQUENT_POLICY, queryKeys, STANDARD_POLICY, TIME, useAuthMutation, useAuthQuery } from '@chansey/shared';

@Injectable({
  providedIn: 'root'
})
export class CoinDataService {
  useCoins() {
    return useAuthQuery<Coin[]>(queryKeys.coins.lists(), '/api/coin', {
      cachePolicy: STANDARD_POLICY
    });
  }

  useWatchlist() {
    return useAuthQuery<CoinSelectionItem[]>(queryKeys.coins.watchlist(), '/api/coin-selections?type=MANUAL', {
      cachePolicy: FREQUENT_POLICY
    });
  }

  usePrices(coins: Signal<string>) {
    return useAuthQuery<Record<string, { usd: number }>>(() => {
      const coinValue = coins();
      return {
        queryKey: queryKeys.prices.byIds(coinValue),
        url: `/api/simple/price?ids=${coinValue}&vs_currencies=usd&include_24hr_vol=false&include_market_cap=false&include_24hr_change=false&include_last_updated_at=false`,
        options: {
          cachePolicy: {
            staleTime: TIME.MINUTES.m1,
            gcTime: TIME.MINUTES.m5,
            refetchInterval: TIME.MINUTES.m1
          },
          refetchOnWindowFocus: true,
          enabled: !!coinValue
        }
      };
    });
  }

  useAddToWatchlist() {
    return useAuthMutation<{ id: string }, CreateCoinSelectionDto>('/api/coin-selections', 'POST', {
      invalidateQueries: [queryKeys.coins.watchlist()]
    });
  }

  useRemoveFromWatchlist() {
    return useAuthMutation<void, string>((selectionId: string) => `/api/coin-selections/${selectionId}`, 'DELETE', {
      invalidateQueries: [queryKeys.coins.watchlist()]
    });
  }

  /**
   * Preview coins for a risk level (1-5)
   * Shows a sample of coins that will be auto-selected (limited to 5 for UI)
   */
  useCoinPreview(riskLevel: Signal<number | null>) {
    return useAuthQuery<Coin[]>(() => {
      const level = riskLevel();
      return {
        queryKey: ['coins', 'preview', level],
        url: `/api/coins/preview?riskLevel=${level}&limit=5`,
        options: {
          cachePolicy: STANDARD_POLICY,
          enabled: level !== null && level >= 1 && level <= 5
        }
      };
    });
  }
}
