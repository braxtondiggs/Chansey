import { Injectable, Signal } from '@angular/core';

import { CreateExchangeDto, Exchange, UpdateExchangeDto } from '@chansey/api-interfaces';
import { queryKeys, STANDARD_POLICY, useAuthMutation, useAuthQuery } from '@chansey/shared';

/**
 * Service for managing exchanges in admin panel via TanStack Query
 *
 * Uses centralized query keys and standardized caching policies.
 */
@Injectable({
  providedIn: 'root'
})
export class ExchangesService {
  private readonly apiUrl = '/api/exchange';

  /**
   * Query all exchanges
   */
  useExchanges() {
    return useAuthQuery<Exchange[]>(queryKeys.exchanges.lists(), this.apiUrl, {
      cachePolicy: STANDARD_POLICY
    });
  }

  /**
   * Query a single exchange by ID (dynamic query)
   *
   * @param exchangeId - Signal containing the exchange ID
   */
  useExchange(exchangeId: Signal<string | null>) {
    return useAuthQuery<Exchange>(() => {
      const id = exchangeId();
      return {
        queryKey: queryKeys.exchanges.detail(id || ''),
        url: `${this.apiUrl}/${id}`,
        options: { cachePolicy: STANDARD_POLICY, enabled: !!id }
      };
    });
  }

  /**
   * Create a new exchange
   */
  useCreateExchange() {
    return useAuthMutation<Exchange, CreateExchangeDto>(this.apiUrl, 'POST', {
      invalidateQueries: [queryKeys.exchanges.all]
    });
  }

  /**
   * Update an existing exchange
   */
  useUpdateExchange() {
    return useAuthMutation<Exchange, UpdateExchangeDto>((variables) => `${this.apiUrl}/${variables.id}`, 'PATCH', {
      invalidateQueries: [queryKeys.exchanges.all]
    });
  }

  /**
   * Delete an exchange
   */
  useDeleteExchange() {
    return useAuthMutation<void, string>((id: string) => `${this.apiUrl}/${id}`, 'DELETE', {
      invalidateQueries: [queryKeys.exchanges.all]
    });
  }
}
