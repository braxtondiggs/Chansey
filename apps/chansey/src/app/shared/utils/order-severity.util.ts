import { OrderSide, OrderStatus } from '@chansey/api-interfaces';

type TagSeverity = 'success' | 'secondary' | 'info' | 'warn' | 'danger' | 'contrast';

export function getStatusSeverity(status: OrderStatus): TagSeverity {
  switch (status) {
    case OrderStatus.FILLED:
      return 'success';
    case OrderStatus.PARTIALLY_FILLED:
      return 'info';
    case OrderStatus.NEW:
      return 'warn';
    case OrderStatus.CANCELED:
    case OrderStatus.EXPIRED:
    case OrderStatus.REJECTED:
      return 'danger';
    case OrderStatus.PENDING_CANCEL:
      return 'warn';
    default:
      return 'info';
  }
}

export function getSideSeverity(side: OrderSide): 'success' | 'danger' {
  return side === OrderSide.BUY ? 'success' : 'danger';
}
