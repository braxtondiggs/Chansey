import { mapOrderTypeToCcxt } from './ccxt-order-type.util';

import { OrderType } from '../order.entity';

describe('mapOrderTypeToCcxt', () => {
  it.each([
    [OrderType.MARKET, 'market'],
    [OrderType.LIMIT, 'limit'],
    [OrderType.STOP_LOSS, 'stop_loss'],
    [OrderType.STOP_LIMIT, 'stop_limit'],
    [OrderType.TRAILING_STOP, 'trailing_stop_market'],
    [OrderType.TAKE_PROFIT, 'take_profit']
  ])('maps %s → %s', (input, expected) => {
    expect(mapOrderTypeToCcxt(input)).toBe(expected);
  });

  it('throws for OCO (must be handled via OcoOrderService)', () => {
    expect(() => mapOrderTypeToCcxt(OrderType.OCO)).toThrow('OcoOrderService');
  });

  it('falls back to market for unknown values', () => {
    expect(mapOrderTypeToCcxt('unknown' as OrderType)).toBe('market');
  });
});
