import { Injectable, Signal } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { Order } from '@chansey/api-interfaces';
import { authenticatedFetch, FREQUENT_POLICY, queryKeys, STANDARD_POLICY, useAuthQuery } from '@chansey/shared';

/**
 * Service for transactions/orders data via TanStack Query
 *
 * Uses centralized query keys and standardized caching policies.
 */
@Injectable({
  providedIn: 'root'
})
export class TransactionsService {
  private readonly apiUrl = '/api/order';

  /**
   * Query all transactions
   */
  useTransactions() {
    return useAuthQuery<Order[]>(queryKeys.transactions.lists(), this.apiUrl, {
      cachePolicy: STANDARD_POLICY
    });
  }

  /**
   * Query a specific transaction by ID (dynamic query)
   *
   * @param transactionId - Signal containing the transaction ID
   */
  useTransaction(transactionId: Signal<string | null>) {
    return injectQuery(() => {
      const id = transactionId();
      return {
        queryKey: queryKeys.transactions.detail(id || ''),
        queryFn: () => authenticatedFetch<Order>(`${this.apiUrl}/${id}`),
        ...STANDARD_POLICY,
        enabled: !!id
      };
    });
  }

  /**
   * Query all open transactions
   *
   * Uses FREQUENT policy since open orders may change often
   */
  useOpenTransactions() {
    return useAuthQuery<Order[]>(queryKeys.transactions.open(), `${this.apiUrl}/open`, {
      cachePolicy: FREQUENT_POLICY
    });
  }
}
