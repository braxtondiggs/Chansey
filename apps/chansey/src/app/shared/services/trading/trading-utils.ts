import { Decimal } from 'decimal.js';

import {
  getExchangeOrderTypeSupport,
  OrderSide,
  OrderType,
  PlaceOrderRequest,
  TimeInForce,
  TrailingType
} from '@chansey/api-interfaces';

/** Default fee rate used for trade estimates */
export const DEFAULT_FEE_RATE = 0.001;

/**
 * Calculate spread percentage
 */
export function calculateSpread(bid: number, ask: number): number {
  const d_bid = new Decimal(bid);
  const d_ask = new Decimal(ask);
  return d_ask.minus(d_bid).div(d_bid).times(100).toNumber();
}

/**
 * Calculate slippage percentage
 */
export function calculateSlippage(expectedPrice: number, actualPrice: number): number {
  const d_expected = new Decimal(expectedPrice);
  const d_actual = new Decimal(actualPrice);
  return d_actual.minus(d_expected).div(d_expected).abs().times(100).toNumber();
}

/**
 * Format price with appropriate decimal places
 */
export function formatPrice(price: number, decimals = 8): string {
  return price.toFixed(decimals);
}

/**
 * Format quantity with appropriate decimal places
 */
export function formatQuantity(quantity: number, decimals = 8): string {
  return quantity.toFixed(decimals);
}

/**
 * Calculate position size based on risk parameters
 */
export function calculatePositionSize(
  balance: number,
  riskPercentage: number,
  entryPrice: number,
  stopLoss?: number
): number {
  const d_balance = new Decimal(balance);
  const d_riskPct = new Decimal(riskPercentage);
  const d_entry = new Decimal(entryPrice);
  const riskAmount = d_balance.times(d_riskPct.div(100));

  if (stopLoss) {
    const riskPerUnit = d_entry.minus(new Decimal(stopLoss)).abs();
    return riskAmount.div(riskPerUnit).toNumber();
  }

  return riskAmount.div(d_entry).toNumber();
}

/**
 * Get supported order types for an exchange using shared configuration
 * @param exchangeSlug The exchange slug (e.g., 'binanceus', 'coinbase')
 */
export function getExchangeSupport(exchangeSlug: string) {
  return getExchangeOrderTypeSupport(exchangeSlug);
}

/**
 * Build a PlaceOrderRequest from form data
 */
export function buildOrderRequest(
  exchangeKeyId: string,
  symbol: string,
  side: OrderSide,
  orderType: OrderType,
  quantity: number,
  options?: {
    price?: number;
    stopPrice?: number;
    trailingAmount?: number;
    trailingType?: TrailingType;
    takeProfitPrice?: number;
    stopLossPrice?: number;
    timeInForce?: TimeInForce;
  }
): PlaceOrderRequest {
  const request: PlaceOrderRequest = {
    exchangeKeyId,
    symbol,
    side,
    orderType,
    quantity
  };

  // Add conditional fields based on order type
  if (options?.price != null) {
    request.price = options.price;
  }
  if (options?.stopPrice != null) {
    request.stopPrice = options.stopPrice;
  }
  if (options?.trailingAmount != null) {
    request.trailingAmount = options.trailingAmount;
  }
  if (options?.trailingType != null) {
    request.trailingType = options.trailingType;
  }
  if (options?.takeProfitPrice != null) {
    request.takeProfitPrice = options.takeProfitPrice;
  }
  if (options?.stopLossPrice != null) {
    request.stopLossPrice = options.stopLossPrice;
  }
  if (options?.timeInForce != null) {
    request.timeInForce = options.timeInForce;
  }

  return request;
}
