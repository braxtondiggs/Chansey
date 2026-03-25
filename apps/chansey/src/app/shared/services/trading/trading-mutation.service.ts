import { Injectable } from '@angular/core';

import { Order, OrderPreview, OrderSide, OrderType, PlaceOrderRequest } from '@chansey/api-interfaces';
import { queryKeys, useAuthMutation } from '@chansey/shared';

import { TradeEstimate } from './trading.types';

/**
 * Service for crypto trading mutation operations via TanStack Query
 *
 * Uses centralized query keys for cache invalidation.
 */
@Injectable({
  providedIn: 'root'
})
export class TradingMutationService {
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
   * Create a new order using the manual order endpoint
   * This is the unified order creation method that uses exchangeKeyId and symbol
   */
  useCreateOrder() {
    return useAuthMutation<Order, PlaceOrderRequest>('/api/order/manual', 'POST', {
      invalidateQueries: [queryKeys.trading.orders(), queryKeys.trading.activeOrders(), queryKeys.trading.balances()]
    });
  }

  /**
   * Preview an order to calculate fees and validate
   * Uses the manual preview endpoint for accurate fee calculations
   */
  usePreviewOrder() {
    return useAuthMutation<OrderPreview, PlaceOrderRequest>('/api/order/manual/preview', 'POST');
  }

  /**
   * Cancel an order
   */
  useCancelOrder() {
    return useAuthMutation<void, string>((orderId: string) => `/api/order/${orderId}`, 'DELETE', {
      invalidateQueries: [queryKeys.trading.orders(), queryKeys.trading.activeOrders(), queryKeys.trading.balances()]
    });
  }
}
