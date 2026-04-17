import { ListingTradeExecutorService } from './listing-trade-executor.service';

import { type Coin } from '../../coin/coin.entity';
import { type Order } from '../../order/order.entity';
import { type User } from '../../users/users.entity';
import { getListingRiskConfig } from '../constants/risk-config';
import { ListingPositionStatus, ListingStrategyType } from '../entities/listing-trade-position.entity';

function buildUser(riskLevel = 5): User {
  return {
    id: 'user-1',
    coinRisk: { level: riskLevel },
    calculationRiskLevel: riskLevel,
    get effectiveCalculationRiskLevel() {
      return riskLevel;
    }
  } as any;
}

describe('ListingTradeExecutorService', () => {
  let positionRepo: any;
  let announcementRepo: any;
  let candidateRepo: any;
  let tradeExecutionService: any;
  let coinSelectionService: any;
  let balanceService: any;
  let service: ListingTradeExecutorService;

  beforeEach(() => {
    positionRepo = {
      create: jest.fn().mockImplementation((p) => p),
      save: jest.fn().mockImplementation((p) => Promise.resolve({ id: 'pos-1', ...p })),
      count: jest.fn().mockResolvedValue(0),
      manager: {
        findOne: jest.fn()
      }
    };
    announcementRepo = { update: jest.fn() };
    candidateRepo = { update: jest.fn() };
    tradeExecutionService = {
      executeTradeSignal: jest
        .fn()
        .mockResolvedValue({ id: 'order-1', executedQuantity: 10, quantity: 10, symbol: 'FOO/USDT' } as Order)
    };
    coinSelectionService = { createCoinSelectionItem: jest.fn().mockResolvedValue(undefined) };
    balanceService = {
      getCurrentBalances: jest.fn().mockResolvedValue([{ totalUsdValue: 10_000 }, { totalUsdValue: 5_000 }])
    };

    service = new ListingTradeExecutorService(
      positionRepo,
      announcementRepo,
      candidateRepo,
      tradeExecutionService,
      coinSelectionService,
      balanceService
    );
  });

  const coin = { id: 'coin-1', symbol: 'foo' } as Coin;

  function getCfg(mode: 'preListing' | 'postAnnouncement') {
    const cfg = getListingRiskConfig(5)?.[mode];
    if (!cfg) throw new Error(`expected risk-5 ${mode} config`);
    return cfg;
  }

  it('executes a BUY and persists a listing position with correct config-derived expiry', async () => {
    const cfg = getCfg('postAnnouncement');
    const user = buildUser(5);
    const position = await service.executeBuy({
      user,
      coin,
      strategyType: ListingStrategyType.POST_ANNOUNCEMENT,
      config: cfg,
      announcementId: 'ann-1'
    });

    expect(position).not.toBeNull();
    expect(tradeExecutionService.executeTradeSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        action: 'BUY',
        symbol: 'FOO/USDT',
        autoSize: true,
        allocationPercentage: cfg.positionSizePct,
        portfolioValue: 15_000,
        exitConfig: expect.objectContaining({
          enableStopLoss: true,
          stopLossValue: cfg.stopLossPct,
          enableTrailingStop: true,
          trailingValue: cfg.trailingStopPct
        })
      })
    );
    expect(positionRepo.save).toHaveBeenCalled();
    expect(announcementRepo.update).toHaveBeenCalledWith({ id: 'ann-1' }, { dispatched: true });
  });

  it('returns null when portfolio value is 0', async () => {
    balanceService.getCurrentBalances = jest.fn().mockResolvedValue([{ totalUsdValue: 0 }]);
    const cfg = getCfg('postAnnouncement');
    const result = await service.executeBuy({
      user: buildUser(5),
      coin,
      strategyType: ListingStrategyType.POST_ANNOUNCEMENT,
      config: cfg
    });
    expect(result).toBeNull();
    expect(tradeExecutionService.executeTradeSignal).not.toHaveBeenCalled();
  });

  it('returns null when trade execution fails', async () => {
    tradeExecutionService.executeTradeSignal = jest.fn().mockRejectedValue(new Error('insufficient funds'));
    const cfg = getCfg('preListing');
    const result = await service.executeBuy({
      user: buildUser(5),
      coin,
      strategyType: ListingStrategyType.PRE_LISTING,
      config: cfg
    });
    expect(result).toBeNull();
    expect(positionRepo.save).not.toHaveBeenCalled();
  });

  it('hasOpenPositionForCoin checks OPEN status only', async () => {
    positionRepo.count = jest.fn().mockResolvedValue(1);
    expect(await service.hasOpenPositionForCoin('u1', 'c1')).toBe(true);
    expect(positionRepo.count).toHaveBeenCalledWith({
      where: { userId: 'u1', coinId: 'c1', status: ListingPositionStatus.OPEN }
    });
  });

  it('closePosition forwards entry exchangeKeyId to the SELL signal', async () => {
    const entryOrder = {
      id: 'order-1',
      symbol: 'FOO/USDT',
      executedQuantity: 10,
      quantity: 10,
      exchangeKeyId: 'key-abc'
    } as Order;
    positionRepo.manager.findOne = jest.fn().mockResolvedValue(entryOrder);
    tradeExecutionService.executeTradeSignal = jest.fn().mockResolvedValue({ id: 'order-2' });

    const position = {
      id: 'pos-1',
      userId: 'user-1',
      orderId: 'order-1',
      status: ListingPositionStatus.OPEN,
      metadata: {}
    } as any;

    const result = await service.closePosition({
      position,
      nextStatus: ListingPositionStatus.CLOSED,
      reason: 'time-stop'
    });

    expect(result).not.toBeNull();
    expect(tradeExecutionService.executeTradeSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        action: 'SELL',
        symbol: 'FOO/USDT',
        quantity: 10,
        exchangeKeyId: 'key-abc'
      })
    );
  });
});
