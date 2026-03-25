import { Injectable, Signal } from '@angular/core';

import { Balance, Order, OrderStatus, TickerPair } from '@chansey/api-interfaces';
import { FREQUENT_POLICY, queryKeys, STANDARD_POLICY, TIME, useAuthQuery } from '@chansey/shared';

import { OrderBook } from './trading.types';

/**
 * Service for crypto trading query operations via TanStack Query
 *
 * Uses centralized query keys and standardized caching policies.
 */
@Injectable({
  providedIn: 'root'
})
export class TradingQueryService {
  /**
   * Get available trading pairs for connected exchanges
   */
  useTradingPairs(exchangeId: Signal<string | null>) {
    return useAuthQuery<TickerPair[]>(() => {
      const exchangeValue = exchangeId();
      return {
        queryKey: queryKeys.trading.tickerPairs(exchangeValue?.toString()),
        url: `/api/exchange/${exchangeValue?.toString()}/tickers`,
        options: { cachePolicy: STANDARD_POLICY, enabled: !!exchangeValue }
      };
    });
  }

  /**
   * Get user balances for trading
   */
  useBalances(exchangeId?: Signal<string | null>) {
    return useAuthQuery<Balance[]>(() => {
      const exchangeValue = exchangeId?.();
      const params = exchangeValue ? `?exchangeId=${exchangeValue}` : '';
      return {
        queryKey: queryKeys.trading.balances(),
        url: `/api/trading/balances${params}`,
        options: {
          cachePolicy: {
            ...FREQUENT_POLICY,
            staleTime: TIME.MINUTES.m1,
            refetchInterval: TIME.MINUTES.m1,
            refetchOnWindowFocus: false,
            retry: 2
          }
        }
      };
    });
  }

  /**
   * Get order book for a trading pair
   */
  useOrderBook(symbol: Signal<string | null>, exchangeId?: Signal<string | null>) {
    return useAuthQuery<OrderBook>(() => {
      const symbolValue = symbol();
      const exchangeIdValue = exchangeId?.();

      const params = new URLSearchParams();
      if (symbolValue) params.append('symbol', symbolValue);
      if (exchangeIdValue) params.append('exchangeId', exchangeIdValue);

      return {
        queryKey: queryKeys.trading.orderBook(symbolValue || ''),
        url: `/api/trading/orderbook?${params}`,
        options: {
          cachePolicy: {
            staleTime: TIME.SECONDS.s15,
            gcTime: TIME.MINUTES.m5,
            refetchInterval: TIME.SECONDS.s15,
            refetchOnWindowFocus: false,
            retry: 2,
            retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 10000)
          },
          enabled: !!symbolValue
        }
      };
    });
  }

  /**
   * Get order history
   */
  useOrderHistory(status?: OrderStatus, limit = 50) {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    params.append('limit', limit.toString());

    return useAuthQuery<Order[]>(queryKeys.trading.orderHistory(), `/api/order?${params}`, {
      cachePolicy: {
        ...STANDARD_POLICY,
        staleTime: TIME.MINUTES.m1
      }
    });
  }

  /**
   * Get active orders
   */
  useActiveOrders() {
    return useAuthQuery<Order[]>(queryKeys.trading.activeOrders(), '/api/order?status=NEW,PARTIALLY_FILLED', {
      cachePolicy: {
        ...FREQUENT_POLICY,
        staleTime: TIME.SECONDS.s30,
        refetchInterval: TIME.SECONDS.s30,
        refetchOnWindowFocus: false,
        retry: 2
      }
    });
  }

  /**
   * Get 24h price ticker
   */
  useTicker(symbol: string, exchangeId?: string) {
    const params = new URLSearchParams();
    params.append('symbol', symbol);
    if (exchangeId) params.append('exchangeId', exchangeId);

    return useAuthQuery<TickerPair>(queryKeys.trading.ticker(symbol), `/api/trading/ticker?${params}`, {
      cachePolicy: {
        ...FREQUENT_POLICY,
        staleTime: TIME.SECONDS.s30,
        refetchInterval: TIME.SECONDS.s30,
        refetchOnWindowFocus: false,
        retry: 2
      },
      enabled: !!symbol
    });
  }
}
