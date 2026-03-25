import { FormGroup } from '@angular/forms';

import { Decimal } from 'decimal.js';

import { Balance, OrderPreview, OrderStatus, OrderType, TickerPair } from '@chansey/api-interfaces';

import { DEFAULT_FEE_RATE, OrderBookEntry } from '../../services/trading';

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
  const assetId = side === 'BUY' ? pair.quoteAsset?.id : pair.baseAsset?.id;
  return balances.find((b) => b.coin.id === assetId);
}

export function getAvailableBuyBalance(
  balances: Balance[] | undefined,
  pair: TickerPair | null,
  preview: OrderPreview | null
): number {
  const balance = findBalance(balances, pair, 'BUY');
  if (!balance) return 0;
  const feeRate = getFeeRate(preview);
  return new Decimal(balance.available).times(new Decimal(1).minus(new Decimal(feeRate))).toNumber();
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

export function trackByPrice(_index: number, item: OrderBookEntry) {
  return item.price;
}
