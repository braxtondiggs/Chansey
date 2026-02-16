import { Injectable, Signal } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { AccountValueHistoryDto, BalanceResponseDto } from '@chansey/api-interfaces';
import { authenticatedFetch, FREQUENT_POLICY, queryKeys, STANDARD_POLICY, TIME, useAuthQuery } from '@chansey/shared';

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
