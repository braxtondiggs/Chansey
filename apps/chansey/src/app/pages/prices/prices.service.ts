import { Injectable, Signal } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { Coin } from '@chansey/api-interfaces';

import { coinKeys } from '@chansey-web/app/core/query/query.keys';
import { useAuthQuery, useAuthMutation, authenticatedFetch } from '@chansey-web/app/core/query/query.utils';

// Portfolio DTO interface for creating portfolio items
interface CreatePortfolioDto {
  coinId: string;
  type: 'MANUAL';
}

// Portfolio item interface for watchlist items
interface PortfolioItem {
  id: string;
  coin: Coin;
  type: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class PriceService {
  useCoins() {
    return useAuthQuery<Coin[]>(coinKeys.lists.all, '/api/coin');
  }

  useWatchlist() {
    return useAuthQuery<PortfolioItem[]>(coinKeys.lists.watchlist, '/api/portfolio?type=MANUAL');
  }

  usePrices(coins: Signal<string>) {
    return injectQuery(() => {
      const coinValue = coins();
      return {
        queryKey: coinKeys.price.byCoinId(coinValue.toString()),
        queryFn: () =>
          authenticatedFetch<any>(
            `/api/simple/price?ids=${coinValue.toString()}&vs_currencies=usd&include_24hr_vol=false&include_market_cap=false&include_24hr_change=false&include_last_updated_at=false`
          ),
        refetchOnWindowFocus: true,
        staleTime: 60 * 1000,
        refetchInterval: 60 * 1000,
        enabled: !!coinValue
      };
    });
  }

  useAddToWatchlist() {
    return useAuthMutation<{ id: string }, CreatePortfolioDto>('/api/portfolio', 'POST', {
      invalidateQueries: [coinKeys.lists.watchlist]
    });
  }

  useRemoveFromWatchlist() {
    return useAuthMutation<void, string>((portfolioId: string) => `/api/portfolio/${portfolioId}`, 'DELETE', {
      invalidateQueries: [coinKeys.lists.watchlist]
    });
  }
}
