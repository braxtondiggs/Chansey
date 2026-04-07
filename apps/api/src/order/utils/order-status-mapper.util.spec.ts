import { mapExchangeStatusToOrderStatus } from './order-status-mapper.util';

import { OrderStatus } from '../order.entity';

describe('mapExchangeStatusToOrderStatus', () => {
  it.each([
    ['open', OrderStatus.NEW],
    ['closed', OrderStatus.FILLED],
    ['canceled', OrderStatus.CANCELED],
    ['cancelled', OrderStatus.CANCELED],
    ['expired', OrderStatus.EXPIRED],
    ['rejected', OrderStatus.REJECTED],
    ['partial', OrderStatus.PARTIALLY_FILLED],
    ['partially_filled', OrderStatus.PARTIALLY_FILLED]
  ])('maps %s to %s', (input, expected) => {
    expect(mapExchangeStatusToOrderStatus(input)).toBe(expected);
  });

  it('is case insensitive', () => {
    expect(mapExchangeStatusToOrderStatus('OPEN')).toBe(OrderStatus.NEW);
    expect(mapExchangeStatusToOrderStatus('Closed')).toBe(OrderStatus.FILLED);
  });

  it('defaults to NEW for unknown', () => {
    expect(mapExchangeStatusToOrderStatus('unknown')).toBe(OrderStatus.NEW);
  });

  it('defaults to NEW for null/undefined/empty', () => {
    expect(mapExchangeStatusToOrderStatus(null)).toBe(OrderStatus.NEW);
    expect(mapExchangeStatusToOrderStatus(undefined)).toBe(OrderStatus.NEW);
    expect(mapExchangeStatusToOrderStatus('')).toBe(OrderStatus.NEW);
  });
});
