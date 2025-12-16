import { Injectable, Signal } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { queryKeys, useAuthQuery, useAuthMutation, authenticatedFetch, STANDARD_POLICY } from '@chansey/shared';

export interface Coin {
  id: string;
  name: string;
  symbol: string;
  slug: string;
  logo: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCoinDto {
  name: string;
  symbol: string;
  slug: string;
  logo?: string;
}

export interface UpdateCoinDto {
  id: string;
  name?: string;
  symbol?: string;
  slug?: string;
  logo?: string;
}

/**
 * Service for managing coins in admin panel via TanStack Query
 *
 * Uses centralized query keys and standardized caching policies.
 */
@Injectable({
  providedIn: 'root'
})
export class CoinsService {
  private readonly apiUrl = '/api/coin';

  /**
   * Query all coins
   */
  useCoins() {
    return useAuthQuery<Coin[]>(queryKeys.coins.lists(), this.apiUrl, {
      cachePolicy: STANDARD_POLICY
    });
  }

  /**
   * Query a single coin by ID (dynamic query)
   *
   * @param coinId - Signal containing the coin ID
   */
  useCoin(coinId: Signal<string | null>) {
    return injectQuery(() => {
      const id = coinId();
      return {
        queryKey: queryKeys.coins.detail(id || ''),
        queryFn: () => authenticatedFetch<Coin>(`${this.apiUrl}/${id}`),
        ...STANDARD_POLICY,
        enabled: !!id
      };
    });
  }

  /**
   * Create a new coin
   */
  useCreateCoin() {
    return useAuthMutation<Coin, CreateCoinDto>(this.apiUrl, 'POST', {
      invalidateQueries: [queryKeys.coins.all]
    });
  }

  /**
   * Update an existing coin
   */
  useUpdateCoin() {
    return useAuthMutation<Coin, UpdateCoinDto>((variables) => `${this.apiUrl}/${variables.id}`, 'PATCH', {
      invalidateQueries: [queryKeys.coins.all]
    });
  }

  /**
   * Delete a coin
   */
  useDeleteCoin() {
    return useAuthMutation<void, string>((id: string) => `${this.apiUrl}/${id}`, 'DELETE', {
      invalidateQueries: [queryKeys.coins.all]
    });
  }
}
