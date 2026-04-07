import { OrderType } from '../order.entity';

/** CCXT order creation parameters */
export interface CcxtOrderParams {
  stopPrice?: number;
  trailingDelta?: number;
  timeInForce?: string;
  [key: string]: unknown;
}

/**
 * Map our OrderType enum to CCXT order type strings.
 */
export function mapOrderTypeToCcxt(orderType: OrderType): string {
  if (orderType === OrderType.OCO) {
    throw new Error('OCO orders must be handled via OcoOrderService, not mapOrderTypeToCcxt');
  }

  const typeMap: Partial<Record<OrderType, string>> = {
    [OrderType.MARKET]: 'market',
    [OrderType.LIMIT]: 'limit',
    [OrderType.STOP_LOSS]: 'stop_loss',
    [OrderType.STOP_LIMIT]: 'stop_limit',
    [OrderType.TRAILING_STOP]: 'trailing_stop_market',
    [OrderType.TAKE_PROFIT]: 'take_profit'
  };

  return typeMap[orderType] || 'market';
}
