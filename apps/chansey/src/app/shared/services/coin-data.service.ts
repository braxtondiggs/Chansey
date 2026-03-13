import { Injectable, Signal } from '@angular/core';

import { Coin, CreatePortfolioDto, PortfolioItem } from '@chansey/api-interfaces';
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
    return useAuthQuery<PortfolioItem[]>(queryKeys.coins.watchlist(), '/api/portfolio?type=MANUAL', {
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
    return useAuthMutation<{ id: string }, CreatePortfolioDto>('/api/portfolio', 'POST', {
      invalidateQueries: [queryKeys.coins.watchlist()]
    });
  }

  useRemoveFromWatchlist() {
    return useAuthMutation<void, string>((portfolioId: string) => `/api/portfolio/${portfolioId}`, 'DELETE', {
      invalidateQueries: [queryKeys.coins.watchlist()]
    });
  }
}
