import { ManualOrderValidatorService } from './manual-order-validator.service';

import { PlaceManualOrderDto } from '../dto/place-manual-order.dto';
import { OrderSide, OrderType, TrailingType } from '../order.entity';

describe('ManualOrderValidatorService', () => {
  let service: ManualOrderValidatorService;

  const baseMarket = { maker: 0.001, taker: 0.002, limits: { amount: { min: 0.001, max: 1000 } } };

  const makeExchange = (overrides: any = {}): any => ({
    markets: { 'BTC/USDT': baseMarket },
    fetchTicker: jest.fn().mockResolvedValue({ last: 50000 }),
    fetchBalance: jest.fn().mockResolvedValue({ USDT: { free: 100000 }, BTC: { free: 10 } }),
    ...overrides
  });

  const baseDto: PlaceManualOrderDto = {
    exchangeKeyId: 'ek-1',
    symbol: 'BTC/USDT',
    side: OrderSide.BUY,
    orderType: OrderType.MARKET,
    quantity: 0.01
  } as any;

  beforeEach(() => {
    service = new ManualOrderValidatorService();
  });

  it('passes for a valid market buy', async () => {
    await expect(service.validate(baseDto, makeExchange(), 'binance')).resolves.toBeUndefined();
  });

  it('throws for unknown symbol', async () => {
    await expect(
      service.validate({ ...baseDto, symbol: 'XYZ/USDT' } as any, makeExchange(), 'binance')
    ).rejects.toThrow('not available');
  });

  it('throws when quantity below min', async () => {
    await expect(service.validate({ ...baseDto, quantity: 0.00001 } as any, makeExchange(), 'binance')).rejects.toThrow(
      'below minimum'
    );
  });

  it('throws when quantity above max', async () => {
    await expect(service.validate({ ...baseDto, quantity: 10000 } as any, makeExchange(), 'binance')).rejects.toThrow(
      'exceeds maximum'
    );
  });

  it('requires price for LIMIT', async () => {
    await expect(
      service.validate({ ...baseDto, orderType: OrderType.LIMIT } as any, makeExchange(), 'binance')
    ).rejects.toThrow('Price is required');
  });

  it('requires stopPrice for STOP_LOSS', async () => {
    await expect(
      service.validate({ ...baseDto, orderType: OrderType.STOP_LOSS } as any, makeExchange(), 'binance')
    ).rejects.toThrow('Stop price is required');
  });

  it('requires stopPrice for STOP_LIMIT', async () => {
    await expect(
      service.validate({ ...baseDto, orderType: OrderType.STOP_LIMIT, price: 50000 } as any, makeExchange(), 'binance')
    ).rejects.toThrow('Stop price is required');
  });

  it('requires price for STOP_LIMIT', async () => {
    await expect(
      service.validate(
        { ...baseDto, orderType: OrderType.STOP_LIMIT, stopPrice: 49000 } as any,
        makeExchange(),
        'binance'
      )
    ).rejects.toThrow('Price is required');
  });

  it('requires trailingAmount for TRAILING_STOP', async () => {
    await expect(
      service.validate(
        { ...baseDto, orderType: OrderType.TRAILING_STOP, trailingType: TrailingType.PERCENTAGE } as any,
        makeExchange(),
        'binance'
      )
    ).rejects.toThrow('Trailing amount is required');
  });

  it('requires trailingType for TRAILING_STOP', async () => {
    await expect(
      service.validate(
        { ...baseDto, orderType: OrderType.TRAILING_STOP, trailingAmount: 1 } as any,
        makeExchange(),
        'binance'
      )
    ).rejects.toThrow('Trailing type is required');
  });

  it('requires takeProfitPrice for OCO', async () => {
    await expect(
      service.validate({ ...baseDto, orderType: OrderType.OCO, stopLossPrice: 49000 } as any, makeExchange(), 'binance')
    ).rejects.toThrow('Take profit price is required');
  });

  it('requires stopLossPrice for OCO', async () => {
    await expect(
      service.validate(
        { ...baseDto, orderType: OrderType.OCO, takeProfitPrice: 51000 } as any,
        makeExchange(),
        'binance'
      )
    ).rejects.toThrow('Stop loss price is required');
  });

  it('rejects unsupported order type for exchange', async () => {
    // coinbase does not support OCO
    await expect(
      service.validate(
        { ...baseDto, orderType: OrderType.OCO, takeProfitPrice: 51000, stopLossPrice: 49000 } as any,
        makeExchange(),
        'coinbase'
      )
    ).rejects.toThrow('not supported');
  });

  it('includes fee in required quote balance for BUY', async () => {
    // quantity 0.01 * price 50000 = 500; taker fee 0.2% => 501 required
    const ex = makeExchange({ fetchBalance: jest.fn().mockResolvedValue({ USDT: { free: 500.5 } }) });
    await expect(service.validate(baseDto, ex, 'binance')).rejects.toThrow('Insufficient');
  });

  it('rejects insufficient quote balance for BUY', async () => {
    const ex = makeExchange({ fetchBalance: jest.fn().mockResolvedValue({ USDT: { free: 1 } }) });
    await expect(service.validate(baseDto, ex, 'binance')).rejects.toThrow('Insufficient');
  });

  describe('assertOrderTypeSupported', () => {
    it('does not throw for a supported type', () => {
      expect(() => service.assertOrderTypeSupported('binance', OrderType.MARKET)).not.toThrow();
    });

    it('throws for unsupported type and includes exchange name when provided', () => {
      expect(() => service.assertOrderTypeSupported('coinbase', OrderType.OCO, 'Coinbase')).toThrow(
        /not supported on Coinbase/
      );
    });

    it('throws for unsupported type with generic label when name omitted', () => {
      expect(() => service.assertOrderTypeSupported('coinbase', OrderType.OCO)).toThrow(
        /not supported on this exchange/
      );
    });
  });

  it('rejects insufficient base balance for SELL', async () => {
    const ex = makeExchange({ fetchBalance: jest.fn().mockResolvedValue({ BTC: { free: 0 } }) });
    await expect(service.validate({ ...baseDto, side: OrderSide.SELL } as any, ex, 'binance')).rejects.toThrow(
      'Insufficient'
    );
  });
});
