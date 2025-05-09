import { Injectable } from '@angular/core';

import { QueryKey } from '@tanstack/angular-query-experimental';

import { createQueryKeys, useAuthQuery } from '@chansey-web/app/core/query/query.utils';

export interface ExchangeBalance {
  asset: string;
  free: number;
  locked: number;
  total: number;
}

export interface BalanceResponseDto {
  current: ExchangeBalanceDto[];
  historical?: HistoricalBalanceDto[];
  totalUsdValue: number;
}

export interface ExchangeBalanceDto {
  exchange: string;
  exchangeName: string;
  balances: AssetBalanceDto[];
  totalUsdValue: number;
  timestamp: Date;
}

export interface AssetBalanceDto {
  asset: string;
  free: string;
  locked: string;
  usdValue?: number;
}

export interface HistoricalBalanceDto extends ExchangeBalanceDto {
  period: string;
}

// Create query keys for balance related queries
export const balanceKeys = createQueryKeys<{
  all: QueryKey;
  exchange: (exchangeId: string) => QueryKey;
  withHistory: (period: string) => QueryKey;
}>('balances');

// Define specific query keys
balanceKeys.exchange = (exchangeId) => [...balanceKeys.all, 'exchange', exchangeId];
balanceKeys.withHistory = (period) => [...balanceKeys.all, 'history', period];

@Injectable({
  providedIn: 'root'
})
export class ExchangeBalanceService {
  /**
   * Get balance data for a specific exchange using TanStack Query
   * @param exchangeId The ID of the exchange (optional)
   * @returns Query result with balance data
   */
  useExchangeBalance(exchangeId?: string) {
    return useAuthQuery<BalanceResponseDto>(
      exchangeId ? balanceKeys.exchange(exchangeId) : balanceKeys.all,
      exchangeId ? `api/balance?exchangeId=${exchangeId}` : 'api/balance'
    );
  }

  /**
   * Get balance data including historical data
   * @param period The time period for historical data (24h, 7d, 30d)
   * @param exchangeId Optional exchange ID to filter by
   * @returns Query result with current and historical balance data
   */
  useBalanceWithHistory(period: '24h' | '7d' | '30d', exchangeId?: string) {
    const url = `api/balance?includeHistorical=true&period=${period}${exchangeId ? `&exchangeId=${exchangeId}` : ''}`;

    return useAuthQuery<BalanceResponseDto>(balanceKeys.withHistory(period), url);
  }
}
