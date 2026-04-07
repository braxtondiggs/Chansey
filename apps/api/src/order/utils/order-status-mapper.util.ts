import { OrderStatus } from '../order.entity';

/**
 * Map exchange status string to our OrderStatus enum.
 * Accepts null/undefined and falls back to NEW.
 */
export function mapExchangeStatusToOrderStatus(exchangeStatus: string | null | undefined): OrderStatus {
  if (!exchangeStatus) return OrderStatus.NEW;

  const statusMap: Record<string, OrderStatus> = {
    open: OrderStatus.NEW,
    closed: OrderStatus.FILLED,
    canceled: OrderStatus.CANCELED,
    cancelled: OrderStatus.CANCELED,
    expired: OrderStatus.EXPIRED,
    rejected: OrderStatus.REJECTED,
    partial: OrderStatus.PARTIALLY_FILLED,
    partially_filled: OrderStatus.PARTIALLY_FILLED
  };

  return statusMap[exchangeStatus.toLowerCase()] || OrderStatus.NEW;
}
