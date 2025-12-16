import { Injectable, Signal } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { queryKeys, useAuthQuery, authenticatedFetch, FREQUENT_POLICY, STANDARD_POLICY, TIME } from '@chansey/shared';

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

/**
 * Service for exchange balance data via TanStack Query
 *
 * Uses centralized query keys and standardized caching policies.
 */
@Injectable({
  providedIn: 'root'
})
export class ExchangeBalanceService {
  /**
   * Query balance data for a specific exchange
   *
   * Uses FREQUENT policy with aggressive refresh for real-time balance data
   */
  useExchangeBalance(exchangeId?: string) {
    const url = exchangeId ? `api/balance?exchangeId=${exchangeId}` : 'api/balance';

    return useAuthQuery<BalanceResponseDto>(queryKeys.balances.current(exchangeId), url, {
      cachePolicy: {
        ...FREQUENT_POLICY,
        staleTime: 0,
        refetchInterval: TIME.MINUTES.m1,
        refetchOnWindowFocus: true
      }
    });
  }

  /**
   * Query balance data including historical data
   */
  useBalanceWithHistory(period: '24h' | '7d' | '30d', exchangeId?: string) {
    const url = `api/balance?includeHistorical=true&period=${period}${exchangeId ? `&exchangeId=${exchangeId}` : ''}`;

    return useAuthQuery<BalanceResponseDto>(queryKeys.balances.withHistory(period, exchangeId), url, {
      cachePolicy: STANDARD_POLICY
    });
  }

  /**
   * Query account value history across all exchanges
   *
   * Uses a reactive signal for dynamic day selection
   */
  useBalanceHistory(days: Signal<number>) {
    return injectQuery(() => {
      const daysValue = days();
      return {
        queryKey: queryKeys.balances.accountHistory(daysValue),
        queryFn: () => authenticatedFetch<AccountValueHistoryDto>(`api/balance/history?days=${daysValue}`),
        staleTime: TIME.MINUTES.m5,
        gcTime: TIME.MINUTES.m15,
        refetchOnWindowFocus: true
      };
    });
  }
}
