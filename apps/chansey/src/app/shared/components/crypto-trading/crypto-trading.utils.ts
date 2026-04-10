import { type FormGroup } from '@angular/forms';

import { Decimal } from 'decimal.js';

import { type Balance, type OrderPreview, OrderStatus, OrderType, type TickerPair } from '@chansey/api-interfaces';

import { DEFAULT_FEE_RATE, type OrderBookEntry } from '../../services/trading';

/** 0.1% safety margin to prevent 100% orders from failing due to price movement */
export const MAX_ORDER_SAFETY_MARGIN = 0.001;

/**
 * Get order total from preview or calculate fallback
 */
export function calculateOrderTotal(form: FormGroup, pair: TickerPair | null, preview: OrderPreview | null): number {
  if (preview?.estimatedCost !== undefined) return preview.estimatedCost;
  if (!pair) return 0;

  const quantity = form.get('quantity')?.value || 0;
  const orderType = form.get('type')?.value;
  const marketPrice = pair.currentPrice || preview?.marketPrice || 0;
  const price = orderType === OrderType.MARKET ? marketPrice : form.get('price')?.value || marketPrice;

  return new Decimal(quantity).times(new Decimal(price)).toNumber();
}

export function calculateOrderFees(form: FormGroup, pair: TickerPair | null, preview: OrderPreview | null): number {
  if (preview) return preview.estimatedFee;
  return new Decimal(calculateOrderTotal(form, pair, preview)).times(new Decimal(DEFAULT_FEE_RATE)).toNumber();
}

export function getFeeRate(preview: OrderPreview | null): number {
  return preview?.feeRate || DEFAULT_FEE_RATE;
}

/**
 * Get fee rate appropriate for the given order type.
 * Only uses the preview's feeRate if the preview was generated for the same order type,
 * otherwise falls back to DEFAULT_FEE_RATE to avoid using a stale taker/maker rate.
 */
export function getFeeRateForOrderType(orderType: OrderType, preview: OrderPreview | null): number {
  if (preview && preview.orderType === orderType) return preview.feeRate;
  return DEFAULT_FEE_RATE;
}

export function calculateBuyOrderTotalWithFees(
  form: FormGroup,
  pair: TickerPair | null,
  preview: OrderPreview | null
): number {
  if (preview) return preview.totalRequired;
  return new Decimal(calculateOrderTotal(form, pair, preview))
    .plus(new Decimal(calculateOrderFees(form, pair, preview)))
    .toNumber();
}

export function calculateSellOrderNetAmount(
  form: FormGroup,
  pair: TickerPair | null,
  preview: OrderPreview | null
): number {
  if (preview) return new Decimal(preview.estimatedCost).minus(new Decimal(preview.estimatedFee)).toNumber();
  return new Decimal(calculateOrderTotal(form, pair, preview))
    .minus(new Decimal(calculateOrderFees(form, pair, preview)))
    .toNumber();
}

export function findBalance(
  balances: Balance[] | undefined,
  pair: TickerPair | null,
  side: 'BUY' | 'SELL'
): Balance | undefined {
  if (!pair || !balances) return undefined;
  const asset = side === 'BUY' ? pair.quoteAsset : pair.baseAsset;
  if (!asset) return undefined;
  // Match by id first; fall back to case-insensitive symbol match for fiat pairs where id is null
  if (asset.id) {
    return balances.find((b) => b.coin.id === asset.id);
  }
  const sym = asset.symbol?.toLowerCase();
  return balances.find((b) => b.coin.symbol?.toLowerCase() === sym);
}

export function getAvailableBuyBalance(
  balances: Balance[] | undefined,
  pair: TickerPair | null,
  preview: OrderPreview | null,
  orderType?: OrderType
): number {
  const balance = findBalance(balances, pair, 'BUY');
  if (!balance) return 0;
  const feeRate = orderType ? getFeeRateForOrderType(orderType, preview) : getFeeRate(preview);
  return new Decimal(balance.available).div(new Decimal(1).plus(new Decimal(feeRate))).toNumber();
}

export function getAvailableSellBalance(balances: Balance[] | undefined, pair: TickerPair | null): number {
  const balance = findBalance(balances, pair, 'SELL');
  return balance?.available || 0;
}

export function calculateMaxBuyQuantity(
  balances: Balance[] | undefined,
  pair: TickerPair | null,
  preview: OrderPreview | null
): number {
  const availableBalance = getAvailableBuyBalance(balances, pair, preview);
  if (!pair || availableBalance <= 0) return 0;

  const price = pair.currentPrice || preview?.marketPrice || 0;
  if (price <= 0) return 0;

  return new Decimal(availableBalance).div(new Decimal(price)).toNumber();
}

export function getPreviewWarnings(preview: OrderPreview | null): string[] {
  return preview?.warnings || [];
}

export function hasSufficientBalance(preview: OrderPreview | null): boolean {
  return preview?.hasSufficientBalance ?? true;
}

export function getStatusClass(status: OrderStatus): string {
  const classes: Record<OrderStatus, string> = {
    [OrderStatus.NEW]: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    [OrderStatus.PARTIALLY_FILLED]: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    [OrderStatus.FILLED]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    [OrderStatus.CANCELED]: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    [OrderStatus.PENDING_CANCEL]: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    [OrderStatus.REJECTED]: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    [OrderStatus.EXPIRED]: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
  };
  return classes[status] || 'bg-gray-100 text-gray-800';
}

export function formatOrderType(type: OrderType): string {
  const labels: Record<OrderType, string> = {
    [OrderType.MARKET]: 'Market',
    [OrderType.LIMIT]: 'Limit',
    [OrderType.STOP_LOSS]: 'Stop Loss',
    [OrderType.STOP_LIMIT]: 'Stop Limit',
    [OrderType.TRAILING_STOP]: 'Trailing Stop',
    [OrderType.TAKE_PROFIT]: 'Take Profit',
    [OrderType.OCO]: 'OCO'
  };
  return labels[type] || type;
}

export function formatStatus(status: OrderStatus): string {
  const labels: Record<OrderStatus, string> = {
    [OrderStatus.NEW]: 'New',
    [OrderStatus.PARTIALLY_FILLED]: 'Partial Fill',
    [OrderStatus.FILLED]: 'Filled',
    [OrderStatus.CANCELED]: 'Canceled',
    [OrderStatus.PENDING_CANCEL]: 'Canceling',
    [OrderStatus.REJECTED]: 'Rejected',
    [OrderStatus.EXPIRED]: 'Expired'
  };
  return labels[status] || status;
}

export function trackByPrice(_index: number, item: OrderBookEntry) {
  return item.price;
}
