import { ListingHedgeService } from './listing-hedge.service';

import { OrderSide, OrderStatus, OrderType } from '../../order/order.entity';
import { getListingRiskConfig } from '../constants/risk-config';

describe('ListingHedgeService', () => {
  let positionRepo: any;
  let orderRepo: any;
  let exchangeManager: any;
  let exchangeKeyService: any;
  let service: ListingHedgeService;

  beforeEach(() => {
    positionRepo = { update: jest.fn() };
    orderRepo = {
      create: jest.fn().mockImplementation((o) => o),
      save: jest.fn().mockImplementation((o) => Promise.resolve({ id: 'hedge-1', ...o }))
    };
    exchangeManager = {
      getExchangeService: jest.fn().mockReturnValue({
        createFuturesOrder: jest.fn().mockResolvedValue({ id: 'ccxt-1', filled: 0, price: 100 })
      })
    };
    exchangeKeyService = {
      findAll: jest.fn().mockResolvedValue([])
    };
    service = new ListingHedgeService(positionRepo, orderRepo, exchangeManager, exchangeKeyService);
  });

  const spotOrder = {
    id: 'spot-1',
    symbol: 'FOO/USDT',
    executedQuantity: 10,
    quantity: 10
  } as any;

  function getHedgeConfig() {
    const hedge = getListingRiskConfig(5)?.hedge;
    if (!hedge) throw new Error('expected risk-5 hedge config');
    return hedge;
  }

  it('skips when hedge is disabled', async () => {
    const hedge = { ...getHedgeConfig(), enabled: false };
    const result = await service.openShort({ id: 'u1' } as any, spotOrder, hedge, 'pos-1');
    expect(result).toBeNull();
    expect(exchangeManager.getExchangeService).not.toHaveBeenCalled();
  });

  it('skips when user has no active kraken_futures key', async () => {
    exchangeKeyService.findAll = jest.fn().mockResolvedValue([{ isActive: true, exchange: { slug: 'binance' } }]);
    const hedge = getHedgeConfig();
    const result = await service.openShort({ id: 'u1' } as any, spotOrder, hedge, 'pos-1');
    expect(result).toBeNull();
  });

  it('opens a short with 40% of spot quantity and clamps leverage', async () => {
    exchangeKeyService.findAll = jest
      .fn()
      .mockResolvedValue([{ isActive: true, exchange: { slug: 'kraken_futures' } }]);
    const hedge = { ...getHedgeConfig(), sizePct: 0.4, leverage: 50 };
    const result = await service.openShort({ id: 'u1' } as any, spotOrder, hedge, 'pos-1');

    expect(result).not.toBeNull();
    const futuresSvc = exchangeManager.getExchangeService.mock.results[0].value;
    expect(futuresSvc.createFuturesOrder).toHaveBeenCalledWith(
      expect.anything(),
      'FOO/USD:USD',
      'sell',
      4, // 40% of 10
      10, // clamped to max 10
      expect.objectContaining({ positionSide: 'short' })
    );
    expect(orderRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ side: OrderSide.SELL, status: OrderStatus.NEW, type: OrderType.LIMIT })
    );
    expect(positionRepo.update).toHaveBeenCalledWith({ id: 'pos-1' }, { hedgeOrderId: 'hedge-1' });
  });

  it('returns null when spot executed quantity is 0', async () => {
    exchangeKeyService.findAll = jest
      .fn()
      .mockResolvedValue([{ isActive: true, exchange: { slug: 'kraken_futures' } }]);
    const hedge = getHedgeConfig();
    const zeroOrder = { ...spotOrder, executedQuantity: 0, quantity: 0 };
    const result = await service.openShort({ id: 'u1' } as any, zeroOrder, hedge, 'pos-1');
    expect(result).toBeNull();
  });
});
