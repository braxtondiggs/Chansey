import { Injectable, Signal } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { queryKeys, useAuthQuery, authenticatedFetch, STANDARD_POLICY, FREQUENT_POLICY } from '@chansey/shared';

// Order types from the backend
export enum OrderType {
  LIMIT = 'LIMIT',
  LIMIT_MAKER = 'LIMIT_MAKER',
  MARKET = 'MARKET',
  STOP = 'STOP',
  STOP_MARKET = 'STOP_MARKET',
  STOP_LOSS_LIMIT = 'STOP_LOSS_LIMIT',
  TAKE_PROFIT_LIMIT = 'TAKE_PROFIT_LIMIT',
  TAKE_PROFIT_MARKET = 'TAKE_PROFIT_MARKET',
  TRAILING_STOP_MARKET = 'TRAILING_STOP_MARKET'
}

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL'
}

export enum OrderStatus {
  CANCELED = 'CANCELED',
  EXPIRED = 'EXPIRED',
  FILLED = 'FILLED',
  NEW = 'NEW',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  PENDING_CANCEL = 'PENDING_CANCEL',
  REJECTED = 'REJECTED'
}

export interface Transaction {
  id: string;
  symbol: string;
  orderId: string;
  clientOrderId: string;
  transactTime: Date;
  quantity: number;
  price: number;
  executedQuantity: number;
  status: OrderStatus;
  side: OrderSide;
  type: OrderType;
  cost?: number;
  fee: number;
  commission: number;
  feeCurrency?: string;
  baseCoin: {
    id: string;
    name: string;
    symbol: string;
    slug: string;
    image: string;
  };
  quoteCoin: {
    id: string;
    name: string;
    symbol: string;
    slug: string;
    image: string;
  };
  exchange?: {
    id: string;
    name: string;
    slug: string;
    image?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

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
    return useAuthQuery<Transaction[]>(queryKeys.transactions.lists(), this.apiUrl, {
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
        queryFn: () => authenticatedFetch<Transaction>(`${this.apiUrl}/${id}`),
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
    return useAuthQuery<Transaction[]>(queryKeys.transactions.open(), `${this.apiUrl}/open`, {
      cachePolicy: FREQUENT_POLICY
    });
  }
}
