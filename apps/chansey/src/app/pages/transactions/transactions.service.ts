import { Injectable } from '@angular/core';

import { QueryKey } from '@tanstack/angular-query-experimental';

import { createQueryKeys, useAuthQuery } from '@chansey-web/app/core/query/query.utils';

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
  coin: {
    id: string;
    name: string;
    symbol: string;
    slug: string;
    logo: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

// Create query keys for transaction related queries
export const transactionKeys = createQueryKeys<{
  all: QueryKey;
  detail: (id: string) => QueryKey;
  open: QueryKey;
}>('transactions');

// Define specific query keys
transactionKeys.detail = (id) => [...transactionKeys.all, 'detail', id];
transactionKeys.open = [...transactionKeys.all, 'open'];

@Injectable({
  providedIn: 'root'
})
export class TransactionsService {
  private apiUrl = '/api/order';

  /**
   * Get all transactions using TanStack Query
   * @returns Query result with transactions data
   */
  useTransactions() {
    return useAuthQuery<Transaction[]>(transactionKeys.all, this.apiUrl);
  }

  /**
   * Get a specific transaction by ID
   * @param id The transaction ID
   * @returns Query result with transaction data
   */
  useTransaction() {
    return useAuthQuery<Transaction, string>(
      (id: string) => transactionKeys.detail(id),
      (id: string) => `${this.apiUrl}/${id}`
    );
  }

  /**
   * Get all open transactions
   * @returns Query result with open transactions data
   */
  useOpenTransactions() {
    return useAuthQuery<Transaction[]>(transactionKeys.open, `${this.apiUrl}/open`);
  }
}
