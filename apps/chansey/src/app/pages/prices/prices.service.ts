import { Injectable } from '@angular/core';

import { Coin } from '@chansey/api-interfaces';

import { coinKeys } from '@chansey-web/app/core/query/query.keys';
import { useAuthQuery, useAuthMutation } from '@chansey-web/app/core/query/query.utils';

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
    return useAuthQuery<Coin[]>(coinKeys.lists.all, '/api/coin', {
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchInterval: 300000 // 5 minutes
    });
  }

  useWatchlist() {
    return useAuthQuery<PortfolioItem[]>(coinKeys.lists.watchlist, '/api/portfolio?type=MANUAL', {
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchInterval: 300000 // 5 minutes
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
