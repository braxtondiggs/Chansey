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

interface FakeMarketsClient {
  markets: Record<string, unknown>;
  loadMarkets: jest.Mock;
}

function makeMarketsClient(pairs: string[]): FakeMarketsClient {
  const markets: Record<string, unknown> = {};
  for (const pair of pairs) markets[pair] = { symbol: pair };
  return { markets, loadMarkets: jest.fn().mockResolvedValue(markets) };
}

describe('ListingTradeExecutorService', () => {
  let positionRepo: any;
  let announcementRepo: any;
  let candidateRepo: any;
  let tradeExecutionService: any;
  let coinSelectionService: any;
  let balanceService: any;
  let exchangeKeyService: any;
  let exchangeManagerService: any;
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
    exchangeKeyService = {
      findAll: jest.fn().mockResolvedValue([{ id: 'key-binance', isActive: true, exchange: { slug: 'binance_us' } }])
    };
    exchangeManagerService = {
      getQuoteAsset: jest.fn().mockImplementation((slug: string) => {
        if (slug === 'coinbase' || slug === 'gdax') return 'USD';
        if (slug === 'kraken') return 'USD';
        return 'USDT';
      }),
      getExchangeClient: jest.fn().mockResolvedValue(makeMarketsClient(['FOO/USDT']))
    };

    service = new ListingTradeExecutorService(
      positionRepo,
      announcementRepo,
      candidateRepo,
      tradeExecutionService,
      coinSelectionService,
      balanceService,
      exchangeKeyService,
      exchangeManagerService
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
        exchangeKeyId: 'key-binance',
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

  it('translates the pair to Kraken native symbols (BTC/USD → XBT/ZUSD)', async () => {
    exchangeKeyService.findAll = jest
      .fn()
      .mockResolvedValue([{ id: 'key-kraken', isActive: true, exchange: { slug: 'kraken' } }]);
    exchangeManagerService.getExchangeClient = jest.fn().mockResolvedValue(makeMarketsClient(['XBT/ZUSD']));

    const cfg = getCfg('postAnnouncement');
    await service.executeBuy({
      user: buildUser(5),
      coin: { id: 'coin-btc', symbol: 'BTC' } as Coin,
      strategyType: ListingStrategyType.POST_ANNOUNCEMENT,
      config: cfg
    });

    expect(tradeExecutionService.executeTradeSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'XBT/ZUSD',
        exchangeKeyId: 'key-kraken'
      })
    );
  });

  it('uses USD quote asset for coinbase-only users instead of a hardcoded /USDT', async () => {
    exchangeKeyService.findAll = jest
      .fn()
      .mockResolvedValue([{ id: 'key-coinbase', isActive: true, exchange: { slug: 'coinbase' } }]);
    exchangeManagerService.getExchangeClient = jest.fn().mockResolvedValue(makeMarketsClient(['FOO/USD']));

    const cfg = getCfg('postAnnouncement');
    await service.executeBuy({
      user: buildUser(5),
      coin,
      strategyType: ListingStrategyType.POST_ANNOUNCEMENT,
      config: cfg
    });

    expect(tradeExecutionService.executeTradeSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'FOO/USD',
        exchangeKeyId: 'key-coinbase'
      })
    );
  });

  it('skips silently when the user has no active exchange keys', async () => {
    exchangeKeyService.findAll = jest.fn().mockResolvedValue([]);
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

  it('skips silently when no active exchange lists the coin pair', async () => {
    exchangeKeyService.findAll = jest
      .fn()
      .mockResolvedValue([{ id: 'key-binance', isActive: true, exchange: { slug: 'binance_us' } }]);
    exchangeManagerService.getExchangeClient = jest.fn().mockResolvedValue(makeMarketsClient(['BTC/USDT']));

    const cfg = getCfg('postAnnouncement');
    const result = await service.executeBuy({
      user: buildUser(5),
      coin,
      strategyType: ListingStrategyType.POST_ANNOUNCEMENT,
      config: cfg
    });
    expect(result).toBeNull();
    expect(tradeExecutionService.executeTradeSignal).not.toHaveBeenCalled();
    expect(positionRepo.save).not.toHaveBeenCalled();
  });

  it('prefers the first active exchange that lists the pair when multiple keys exist', async () => {
    exchangeKeyService.findAll = jest.fn().mockResolvedValue([
      { id: 'key-coinbase', isActive: true, exchange: { slug: 'coinbase' } },
      { id: 'key-binance', isActive: true, exchange: { slug: 'binance_us' } }
    ]);
    exchangeManagerService.getExchangeClient = jest.fn().mockImplementation(async (slug: string) => {
      if (slug === 'coinbase') return makeMarketsClient([]); // coinbase doesn't list FOO
      return makeMarketsClient(['FOO/USDT']);
    });

    const cfg = getCfg('postAnnouncement');
    await service.executeBuy({
      user: buildUser(5),
      coin,
      strategyType: ListingStrategyType.POST_ANNOUNCEMENT,
      config: cfg
    });
    expect(tradeExecutionService.executeTradeSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'FOO/USDT',
        exchangeKeyId: 'key-binance'
      })
    );
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
