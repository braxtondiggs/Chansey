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

  useWatchedCoins() {
    return useAuthQuery<CoinSelectionItem[]>(queryKeys.coins.watchedCoins(), '/api/coin-selections?type=WATCHED', {
      cachePolicy: FREQUENT_POLICY
    });
  }

  useTradingCoins() {
    return useAuthQuery<CoinSelectionItem[]>(queryKeys.coins.tradingCoins(), '/api/coin-selections?type=MANUAL', {
      cachePolicy: FREQUENT_POLICY
    });
  }

  useAutoSelectedCoins() {
    return useAuthQuery<CoinSelectionItem[]>(
      queryKeys.coins.autoSelectedCoins(),
      '/api/coin-selections?type=AUTOMATIC',
      {
        cachePolicy: FREQUENT_POLICY
      }
    );
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

  useAddToWatchedCoins() {
    return useAuthMutation<{ id: string }, CreateCoinSelectionDto>('/api/coin-selections', 'POST', {
      invalidateQueries: [queryKeys.coins.watchedCoins()]
    });
  }

  useRemoveFromWatchedCoins() {
    return useAuthMutation<void, string>((selectionId: string) => `/api/coin-selections/${selectionId}`, 'DELETE', {
      invalidateQueries: [queryKeys.coins.watchedCoins()]
    });
  }

  useAddToTradingCoins() {
    return useAuthMutation<{ id: string }, CreateCoinSelectionDto>('/api/coin-selections', 'POST', {
      invalidateQueries: [queryKeys.coins.tradingCoins()]
    });
  }

  useRemoveFromTradingCoins() {
    return useAuthMutation<void, string>((selectionId: string) => `/api/coin-selections/${selectionId}`, 'DELETE', {
      invalidateQueries: [queryKeys.coins.tradingCoins()]
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
        queryKey: queryKeys.coins.preview(level),
        url: `/api/coins/preview?riskLevel=${level}&limit=5`,
        options: {
          cachePolicy: STANDARD_POLICY,
          enabled: level !== null && level >= 1 && level <= 5
        }
      };
    });
  }
}
