import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type Repository } from 'typeorm';

import { SignalStatus } from '@chansey/api-interfaces';

import { ActivePositionGuardService } from './active-position-guard.service';

import { Coin } from '../coin/coin.entity';
import { PositionExit } from '../order/entities/position-exit.entity';
import { PositionExitStatus } from '../order/interfaces/exit-config.interface';
import { Order } from '../order/order.entity';
import { PaperTradingOrder } from '../order/paper-trading/entities/paper-trading-order.entity';
import { LiveTradingSignal } from '../strategy/entities/live-trading-signal.entity';
import { UserStrategyPosition } from '../strategy/entities/user-strategy-position.entity';

const USER_ID = 'user-123';
const BTC_COIN_ID = 'coin-btc';
const ETH_COIN_ID = 'coin-eth';

function emptyQb() {
  const qb: any = {
    select: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
    getMany: jest.fn().mockResolvedValue([])
  };
  return qb;
}

function mockRepo() {
  return {
    find: jest.fn().mockResolvedValue([]),
    createQueryBuilder: jest.fn().mockReturnValue(emptyQb())
  };
}

describe('ActivePositionGuardService', () => {
  let service: ActivePositionGuardService;
  let orderRepo: jest.Mocked<Repository<Order>>;
  let paperOrderRepo: jest.Mocked<Repository<PaperTradingOrder>>;
  let positionExitRepo: jest.Mocked<Repository<PositionExit>>;
  let userStrategyPositionRepo: jest.Mocked<Repository<UserStrategyPosition>>;
  let liveTradingSignalRepo: jest.Mocked<Repository<LiveTradingSignal>>;
  let coinRepo: jest.Mocked<Repository<Coin>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivePositionGuardService,
        { provide: getRepositoryToken(Order), useValue: mockRepo() },
        { provide: getRepositoryToken(PaperTradingOrder), useValue: mockRepo() },
        { provide: getRepositoryToken(PositionExit), useValue: mockRepo() },
        { provide: getRepositoryToken(UserStrategyPosition), useValue: mockRepo() },
        { provide: getRepositoryToken(LiveTradingSignal), useValue: mockRepo() },
        { provide: getRepositoryToken(Coin), useValue: mockRepo() }
      ]
    }).compile();

    service = module.get(ActivePositionGuardService);
    orderRepo = module.get(getRepositoryToken(Order));
    paperOrderRepo = module.get(getRepositoryToken(PaperTradingOrder));
    positionExitRepo = module.get(getRepositoryToken(PositionExit));
    userStrategyPositionRepo = module.get(getRepositoryToken(UserStrategyPosition));
    liveTradingSignalRepo = module.get(getRepositoryToken(LiveTradingSignal));
    coinRepo = module.get(getRepositoryToken(Coin));
  });

  it('should return empty set when no active positions', async () => {
    const result = await service.getActivePositionCoinIds(USER_ID);
    expect(result.size).toBe(0);
  });

  it('should return coin IDs from open orders (baseCoin FK)', async () => {
    orderRepo.find.mockResolvedValue([{ id: 'o1', baseCoin: { id: BTC_COIN_ID } } as any]);

    const result = await service.getActivePositionCoinIds(USER_ID);
    expect(result.has(BTC_COIN_ID)).toBe(true);
  });

  it('should return coin IDs from active paper trading orders', async () => {
    const ptQb = emptyQb();
    ptQb.getRawMany.mockResolvedValue([{ baseCurrency: 'ETH' }]);
    paperOrderRepo.createQueryBuilder.mockReturnValue(ptQb);

    const coinQb = emptyQb();
    coinQb.getMany.mockResolvedValue([{ id: ETH_COIN_ID, symbol: 'ETH' }]);
    coinRepo.createQueryBuilder.mockReturnValue(coinQb);

    const result = await service.getActivePositionCoinIds(USER_ID);
    expect(result.has(ETH_COIN_ID)).toBe(true);
  });

  it('should return coin IDs from active position exits (slash format)', async () => {
    positionExitRepo.find.mockResolvedValue([
      { id: 'pe1', symbol: 'BTC/USDT', status: PositionExitStatus.ACTIVE } as any
    ]);

    const coinQb = emptyQb();
    coinQb.getMany.mockResolvedValue([{ id: BTC_COIN_ID, symbol: 'BTC' }]);
    coinRepo.createQueryBuilder.mockReturnValue(coinQb);

    const result = await service.getActivePositionCoinIds(USER_ID);
    expect(result.has(BTC_COIN_ID)).toBe(true);
  });

  it('should return coin IDs from user strategy positions with quantity > 0', async () => {
    const uspQb = emptyQb();
    uspQb.getRawMany.mockResolvedValue([{ symbol: 'ETH/USDT' }]);
    userStrategyPositionRepo.createQueryBuilder.mockReturnValue(uspQb);

    const coinQb = emptyQb();
    coinQb.getMany.mockResolvedValue([{ id: ETH_COIN_ID, symbol: 'ETH' }]);
    coinRepo.createQueryBuilder.mockReturnValue(coinQb);

    const result = await service.getActivePositionCoinIds(USER_ID);
    expect(result.has(ETH_COIN_ID)).toBe(true);
  });

  it('should return coin IDs from pending live trading signals', async () => {
    liveTradingSignalRepo.find.mockResolvedValue([
      { id: 's1', symbol: 'BTC/USDT', status: SignalStatus.PENDING } as any
    ]);

    const coinQb = emptyQb();
    coinQb.getMany.mockResolvedValue([{ id: BTC_COIN_ID, symbol: 'BTC' }]);
    coinRepo.createQueryBuilder.mockReturnValue(coinQb);

    const result = await service.getActivePositionCoinIds(USER_ID);
    expect(result.has(BTC_COIN_ID)).toBe(true);
  });

  it('should deduplicate coin IDs across multiple systems', async () => {
    // BTC from both orders and position exits
    orderRepo.find.mockResolvedValue([{ id: 'o1', baseCoin: { id: BTC_COIN_ID } } as any]);
    positionExitRepo.find.mockResolvedValue([
      { id: 'pe1', symbol: 'BTC/USDT', status: PositionExitStatus.ACTIVE } as any
    ]);

    const coinQb = emptyQb();
    coinQb.getMany.mockResolvedValue([{ id: BTC_COIN_ID, symbol: 'BTC' }]);
    coinRepo.createQueryBuilder.mockReturnValue(coinQb);

    const result = await service.getActivePositionCoinIds(USER_ID);
    expect(result.size).toBe(1);
    expect(result.has(BTC_COIN_ID)).toBe(true);
  });

  it('should gracefully skip symbols not found in the coin table', async () => {
    positionExitRepo.find.mockResolvedValue([
      { id: 'pe1', symbol: 'UNKNOWN/USDT', status: PositionExitStatus.ACTIVE } as any
    ]);

    // coinRepo returns empty — unknown coin
    const result = await service.getActivePositionCoinIds(USER_ID);
    expect(result.size).toBe(0);
  });

  it('should handle both slash and no-slash symbol formats', async () => {
    positionExitRepo.find.mockResolvedValue([{ id: 'pe1', symbol: 'BTC/USDT' } as any]);
    liveTradingSignalRepo.find.mockResolvedValue([{ id: 's1', symbol: 'ETH/USD' } as any]);

    const coinQb = emptyQb();
    coinQb.getMany.mockResolvedValue([
      { id: BTC_COIN_ID, symbol: 'BTC' },
      { id: ETH_COIN_ID, symbol: 'ETH' }
    ]);
    coinRepo.createQueryBuilder.mockReturnValue(coinQb);

    const result = await service.getActivePositionCoinIds(USER_ID);
    expect(result.has(BTC_COIN_ID)).toBe(true);
    expect(result.has(ETH_COIN_ID)).toBe(true);
  });

  it('should return empty when paper trading has no active sessions', async () => {
    // The single join query returns no rows when there are no active sessions
    const result = await service.getActivePositionCoinIds(USER_ID);
    expect(result.size).toBe(0);
  });

  it('should exclude orders where baseCoin is null or undefined', async () => {
    orderRepo.find.mockResolvedValue([
      { id: 'o1', baseCoin: null } as any,
      { id: 'o2', baseCoin: undefined } as any,
      { id: 'o3', baseCoin: { id: BTC_COIN_ID } } as any
    ]);

    const result = await service.getActivePositionCoinIds(USER_ID);
    expect(result.size).toBe(1);
    expect(result.has(BTC_COIN_ID)).toBe(true);
  });

  it('should deduplicate symbols before querying the coin table', async () => {
    // Two position exits with the same base symbol
    positionExitRepo.find.mockResolvedValue([
      { id: 'pe1', symbol: 'BTC/USDT' } as any,
      { id: 'pe2', symbol: 'BTC/USD' } as any
    ]);

    const coinQb = emptyQb();
    coinQb.getMany.mockResolvedValue([{ id: BTC_COIN_ID, symbol: 'BTC' }]);
    coinRepo.createQueryBuilder.mockReturnValue(coinQb);

    const result = await service.getActivePositionCoinIds(USER_ID);
    expect(result.size).toBe(1);
    expect(result.has(BTC_COIN_ID)).toBe(true);

    // resolveSymbolsToCoinIds should only query once with deduplicated 'BTC'
    const whereCall = coinQb.where.mock.calls[0];
    expect(whereCall[1].symbols).toEqual(['BTC']);
  });

  it('should handle orders with baseCoin missing id property', async () => {
    orderRepo.find.mockResolvedValue([{ id: 'o1', baseCoin: {} } as any, { id: 'o2', baseCoin: { id: '' } } as any]);

    const result = await service.getActivePositionCoinIds(USER_ID);
    expect(result.size).toBe(0);
  });
});
