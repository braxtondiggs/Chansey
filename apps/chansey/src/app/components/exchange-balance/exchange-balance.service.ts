import { Injectable, Signal } from '@angular/core';

import { QueryKey, injectQuery } from '@tanstack/angular-query-experimental';

import { createQueryKeys, useAuthQuery, authenticatedFetch } from '@chansey-web/app/core/query/query.utils';

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
  id: string;
  name: string;
  slug: string;
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

export interface AccountValueDataPoint {
  datetime: string;
  value: number;
}

export interface AccountValueHistoryDto {
  history: AccountValueDataPoint[];
  currentValue: number;
  changePercentage: number;
}

// Create query keys for balance related queries
export const balanceKeys = createQueryKeys<{
  all: QueryKey;
  exchange: (exchangeId: string) => QueryKey;
  withHistory: (period: string) => QueryKey;
  history: (days: string) => QueryKey;
}>('balances');

// Define specific query keys
balanceKeys.exchange = (exchangeId) => [...balanceKeys.all, 'exchange', exchangeId];
balanceKeys.withHistory = (period) => [...balanceKeys.all, 'history', period];
balanceKeys.history = (days) => [...balanceKeys.all, 'accountHistory', days];

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
      exchangeId ? `api/balance?exchangeId=${exchangeId}` : 'api/balance',
      {
        refetchOnWindowFocus: true,
        refetchInterval: 60000,
        staleTime: 0
      }
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

  /**
   * Get account value history data across all exchanges
   * @param days Signal<number> to look back (defaults to 30 if not specified)
   * @returns Query result with account value history data
   */
  useBalanceHistory(days: Signal<number>) {
    return injectQuery(() => {
      const daysValue = days(); // Read the signal value
      return {
        queryKey: balanceKeys.history(daysValue.toString()),
        queryFn: () => authenticatedFetch<AccountValueHistoryDto>(`api/balance/history?days=${daysValue}`),
        refetchOnWindowFocus: true,
        staleTime: 5 * 60 * 1000 // 5 minutes
      };
    });
  }
}
