import { Injectable, Signal } from '@angular/core';

import { injectQuery, QueryKey } from '@tanstack/angular-query-experimental';
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
  createQueryKeys,
  useAuthMutation,
  useAuthQuery
} from '@chansey-web/app/core/query/query.utils';

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

// Create query keys for trading
export const tradingKeys = createQueryKeys<{
  all: string[];
  getByExchange: (exchangeId: string | undefined) => QueryKey;
  balances: string[];
  orderBook: (symbol: string) => string[];
  orders: string[];
  activeOrders: string[];
  orderHistory: string[];
  estimate: string[];
  ticker: (symbol: string) => string[];
}>('trading');

tradingKeys.getByExchange = (exchangeId) => [...tradingKeys.all, 'ticker-pair', exchangeId];
tradingKeys.balances = [...tradingKeys.all, 'balances'];
tradingKeys.orderBook = (symbol: string) => [...tradingKeys.all, 'orderBook', symbol];
tradingKeys.orders = [...tradingKeys.all, 'orders'];
tradingKeys.activeOrders = [...tradingKeys.orders, 'active'];
tradingKeys.orderHistory = [...tradingKeys.orders, 'history'];
tradingKeys.estimate = [...tradingKeys.all, 'estimate'];
tradingKeys.ticker = (symbol: string) => [...tradingKeys.all, 'ticker', symbol];

@Injectable({
  providedIn: 'root'
})
export class CryptoTradingService {
  // Real-time state subjects for local state management
  private readonly selectedPairSubject = new BehaviorSubject<TickerPair | null>(null);

  // Public observables
  readonly selectedPair$ = this.selectedPairSubject.asObservable();

  // Query hooks using TanStack Query

  /**
   * Get available trading pairs for connected exchanges
   */
  useTradingPairs(exchangeId: Signal<string | null>) {
    return injectQuery(() => {
      const exchangeValue = exchangeId();
      return {
        queryKey: tradingKeys.getByExchange(exchangeValue?.toString() || 'all'),
        queryFn: () => authenticatedFetch<TickerPair[]>(`/api/exchange/${exchangeValue?.toString()}/tickers`),
        enabled: !!exchangeValue
      };
    });
  }

  /**
   * Get user balances for trading
   */
  useBalances(exchangeId?: string) {
    const params = exchangeId ? `?exchangeId=${exchangeId}` : '';
    return useAuthQuery<Balance[]>(tradingKeys.balances, `/api/trading/balances${params}`, {
      staleTime: 1000 * 60, // 1 minute
      refetchInterval: 1000 * 60, // 1 minute - reduced frequency
      refetchOnWindowFocus: false, // Prevent excessive refetching on focus
      refetchOnMount: false, // Don't refetch on mount since we have interval
      retry: 2, // Limit retry attempts
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000) // Exponential backoff
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
        queryKey: tradingKeys.orderBook(symbolValue || ''),
        queryFn: () => authenticatedFetch<OrderBook>(`/api/trading/orderbook?${params}`),
        staleTime: 1000 * 10, // 10 seconds - increased for better performance
        refetchInterval: 1000 * 15, // 15 seconds - reduced frequency
        refetchOnWindowFocus: false, // Prevent excessive refetching on focus
        refetchOnMount: false, // Don't refetch on mount since we have interval
        retry: 2, // Limit retry attempts to 2
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000), // Exponential backoff
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

    return useAuthQuery<Order[]>(tradingKeys.orderHistory, `/api/order?${params}`, {
      staleTime: 1000 * 60 // 1 minute
    });
  }

  /**
   * Get active orders
   */
  useActiveOrders() {
    return useAuthQuery<Order[]>(tradingKeys.activeOrders, '/api/order?status=NEW,PARTIALLY_FILLED', {
      staleTime: 1000 * 30, // 30 seconds
      refetchInterval: 1000 * 30, // 30 seconds - only refetch every 30s
      refetchOnWindowFocus: false, // Prevent excessive refetching
      retry: 2, // Limit retries
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000)
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

    return useAuthQuery<TickerPair>(tradingKeys.ticker(symbol), `/api/trading/ticker?${params}`, {
      staleTime: 1000 * 30, // 30 seconds
      refetchInterval: 1000 * 30, // 30 seconds
      refetchOnWindowFocus: false, // Prevent excessive refetching
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
      enabled: !!symbol
    });
  }

  /**
   * Create a new order
   */
  useCreateOrder() {
    return useAuthMutation<Order, CreateOrderRequest>('/api/order', 'POST', {
      invalidateQueries: [tradingKeys.orders, tradingKeys.activeOrders, tradingKeys.balances]
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
      invalidateQueries: [tradingKeys.orders, tradingKeys.activeOrders, tradingKeys.balances]
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
