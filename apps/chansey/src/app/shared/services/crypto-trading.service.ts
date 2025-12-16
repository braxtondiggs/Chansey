import { Injectable, Signal } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { BehaviorSubject } from 'rxjs';

import {
  Coin,
  CreateOrderRequest,
  Order,
  OrderPreview,
  OrderSide,
  OrderStatus,
  OrderType,
  TickerPair
} from '@chansey/api-interfaces';
import {
  authenticatedFetch,
  queryKeys,
  useAuthMutation,
  useAuthQuery,
  TIME,
  STANDARD_POLICY,
  FREQUENT_POLICY
} from '@chansey/shared';

export interface Balance {
  coin: Coin;
  available: number;
  locked: number;
  total: number;
}

export interface OrderBookEntry {
  price: number;
  quantity: number;
  total: number;
}

export interface OrderBook {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  lastUpdated: Date;
}

export interface TradeEstimate {
  estimatedPrice: number;
  estimatedQuantity: number;
  estimatedTotal: number;
  fees: number;
  slippage?: number;
  impact?: number;
}

/**
 * Service for crypto trading operations via TanStack Query
 *
 * Uses centralized query keys and standardized caching policies.
 */
@Injectable({
  providedIn: 'root'
})
export class CryptoTradingService {
  // Real-time state subjects for local state management
  private readonly selectedPairSubject = new BehaviorSubject<TickerPair | null>(null);

  // Public observables
  readonly selectedPair$ = this.selectedPairSubject.asObservable();

  /**
   * Get available trading pairs for connected exchanges
   */
  useTradingPairs(exchangeId: Signal<string | null>) {
    return injectQuery(() => {
      const exchangeValue = exchangeId();
      return {
        queryKey: queryKeys.trading.tickerPairs(exchangeValue?.toString()),
        queryFn: () => authenticatedFetch<TickerPair[]>(`/api/exchange/${exchangeValue?.toString()}/tickers`),
        ...STANDARD_POLICY,
        enabled: !!exchangeValue
      };
    });
  }

  /**
   * Get user balances for trading
   */
  useBalances(exchangeId?: string) {
    const params = exchangeId ? `?exchangeId=${exchangeId}` : '';
    return useAuthQuery<Balance[]>(queryKeys.trading.balances(), `/api/trading/balances${params}`, {
      cachePolicy: {
        ...FREQUENT_POLICY,
        staleTime: TIME.MINUTES.m1,
        refetchInterval: TIME.MINUTES.m1,
        refetchOnWindowFocus: false,
        retry: 2
      }
    });
  }

  /**
   * Get order book for a trading pair
   */
  useOrderBook(symbol: Signal<string | null>, exchangeId?: Signal<string | null>) {
    return injectQuery(() => {
      const symbolValue = symbol();
      const exchangeIdValue = exchangeId?.();

      const params = new URLSearchParams();
      if (symbolValue) params.append('symbol', symbolValue);
      if (exchangeIdValue) params.append('exchangeId', exchangeIdValue);

      return {
        queryKey: queryKeys.trading.orderBook(symbolValue || ''),
        queryFn: () => authenticatedFetch<OrderBook>(`/api/trading/orderbook?${params}`),
        staleTime: TIME.SECONDS.s15,
        gcTime: TIME.MINUTES.m5,
        refetchInterval: TIME.SECONDS.s15,
        refetchOnWindowFocus: false,
        retry: 2,
        retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 10000),
        enabled: !!symbolValue
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
   * Get trade estimate for an order
   */
  useTradeEstimate() {
    return useAuthMutation<
      TradeEstimate,
      {
        symbol: string;
        side: OrderSide;
        type: OrderType;
        quantity: number;
        price?: number;
      }
    >('/api/trading/estimate', 'POST');
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

  /**
   * Create a new order
   */
  useCreateOrder() {
    return useAuthMutation<Order, CreateOrderRequest>('/api/order', 'POST', {
      invalidateQueries: [queryKeys.trading.orders(), queryKeys.trading.activeOrders(), queryKeys.trading.balances()]
    });
  }

  /**
   * Preview an order to calculate fees and validate
   */
  usePreviewOrder() {
    return useAuthMutation<OrderPreview, CreateOrderRequest>('/api/order/preview', 'POST');
  }

  /**
   * Cancel an order
   */
  useCancelOrder() {
    return useAuthMutation<void, string>((orderId: string) => `/api/order/${orderId}`, 'DELETE', {
      invalidateQueries: [queryKeys.trading.orders(), queryKeys.trading.activeOrders(), queryKeys.trading.balances()]
    });
  }

  // Local state management methods

  /**
   * Set selected trading pair
   */
  setSelectedPair(pair: TickerPair): void {
    this.selectedPairSubject.next(pair);
  }

  /**
   * Get current selected pair
   */
  getSelectedPair(): TickerPair | null {
    return this.selectedPairSubject.value;
  }

  // Utility methods

  /**
   * Calculate spread percentage
   */
  calculateSpread(bid: number, ask: number): number {
    return ((ask - bid) / bid) * 100;
  }

  /**
   * Calculate slippage percentage
   */
  calculateSlippage(expectedPrice: number, actualPrice: number): number {
    return Math.abs((actualPrice - expectedPrice) / expectedPrice) * 100;
  }

  /**
   * Format price with appropriate decimal places
   */
  formatPrice(price: number, decimals = 8): string {
    return price.toFixed(decimals);
  }

  /**
   * Format quantity with appropriate decimal places
   */
  formatQuantity(quantity: number, decimals = 8): string {
    return quantity.toFixed(decimals);
  }

  // Risk management helpers

  /**
   * Calculate position size based on risk parameters
   */
  calculatePositionSize(balance: number, riskPercentage: number, entryPrice: number, stopLoss?: number): number {
    const riskAmount = balance * (riskPercentage / 100);

    if (stopLoss) {
      const riskPerUnit = Math.abs(entryPrice - stopLoss);
      return riskAmount / riskPerUnit;
    }

    // Default to 2% of balance for position sizing
    return riskAmount / entryPrice;
  }

  // Validation helpers

  /**
   * Validate order parameters
   */
  validateOrder(order: CreateOrderRequest, balance: Balance): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check if user has sufficient balance
    const requiredBalance = parseFloat(order.quantity) * (parseFloat(order.price || '0') || 0);

    if (order.side === OrderSide.BUY && balance.available < requiredBalance) {
      errors.push('Insufficient balance for buy order');
    }

    if (order.side === OrderSide.SELL && balance.available < parseFloat(order.quantity)) {
      errors.push('Insufficient balance for sell order');
    }

    // Check minimum order size
    if (parseFloat(order.quantity) <= 0) {
      errors.push('Order quantity must be greater than 0');
    }

    // Check price for limit orders
    if (order.type === OrderType.LIMIT && (!order.price || parseFloat(order.price) <= 0)) {
      errors.push('Price must be specified and greater than 0 for limit orders');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
