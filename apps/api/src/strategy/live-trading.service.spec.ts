import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { CapitalAllocationService } from './capital-allocation.service';
import { LiveTradingService } from './live-trading.service';
import { PositionTrackingService } from './position-tracking.service';
import { RiskPoolMappingService } from './risk-pool-mapping.service';
import { StrategyExecutorService, TradingSignal } from './strategy-executor.service';

import { TradingStateService } from '../admin/trading-state/trading-state.service';
import { BalanceService } from '../balance/balance.service';
import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { OrderService } from '../order/order.service';
import { LOCK_KEYS } from '../shared/distributed-lock.constants';
import { DistributedLockService } from '../shared/distributed-lock.service';
import { User } from '../users/users.entity';

type MockRepo<T> = jest.Mocked<Repository<T>>;

const createUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 'user-1',
    algoTradingEnabled: true,
    algoCapitalAllocationPercentage: 50,
    exchanges: [{ id: 'ex-1', name: 'Binance US', slug: 'binance_us', isActive: true }],
    risk: { level: 'medium' } as any,
    ...overrides
  }) as User;

describe('LiveTradingService', () => {
  let service: LiveTradingService;
  let userRepo: MockRepo<User>;
  let lockService: jest.Mocked<DistributedLockService>;
  let riskPoolMapping: jest.Mocked<RiskPoolMappingService>;
  let capitalAllocation: jest.Mocked<CapitalAllocationService>;
  let positionTracking: jest.Mocked<PositionTrackingService>;
  let strategyExecutor: jest.Mocked<StrategyExecutorService>;
  let orderService: jest.Mocked<OrderService>;
  let balanceService: jest.Mocked<BalanceService>;
  let tradingStateService: jest.Mocked<TradingStateService>;

  beforeEach(async () => {
    userRepo = {
      find: jest.fn(),
      count: jest.fn(),
      save: jest.fn()
    } as unknown as MockRepo<User>;

    lockService = {
      acquire: jest.fn(),
      release: jest.fn(),
      getLockInfo: jest.fn()
    } as unknown as jest.Mocked<DistributedLockService>;

    riskPoolMapping = {
      getActiveStrategiesForUser: jest.fn()
    } as unknown as jest.Mocked<RiskPoolMappingService>;

    capitalAllocation = {
      allocateCapitalByPerformance: jest.fn()
    } as unknown as jest.Mocked<CapitalAllocationService>;

    positionTracking = {
      getPositions: jest.fn(),
      updatePosition: jest.fn()
    } as unknown as jest.Mocked<PositionTrackingService>;

    strategyExecutor = {
      executeStrategy: jest.fn(),
      validateSignal: jest.fn()
    } as unknown as jest.Mocked<StrategyExecutorService>;

    orderService = {
      placeAlgorithmicOrder: jest.fn()
    } as unknown as jest.Mocked<OrderService>;

    balanceService = {
      getUserBalances: jest.fn()
    } as unknown as jest.Mocked<BalanceService>;

    tradingStateService = {
      isTradingEnabled: jest.fn().mockReturnValue(true)
    } as unknown as jest.Mocked<TradingStateService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiveTradingService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: RiskPoolMappingService, useValue: riskPoolMapping },
        { provide: CapitalAllocationService, useValue: capitalAllocation },
        { provide: PositionTrackingService, useValue: positionTracking },
        { provide: StrategyExecutorService, useValue: strategyExecutor },
        { provide: OrderService, useValue: orderService },
        { provide: BalanceService, useValue: balanceService },
        { provide: DistributedLockService, useValue: lockService },
        { provide: ExchangeManagerService, useValue: { getPrice: jest.fn() } },
        { provide: TradingStateService, useValue: tradingStateService }
      ]
    }).compile();

    service = module.get(LiveTradingService);
  });

  it('returns early when trading is globally disabled', async () => {
    tradingStateService.isTradingEnabled.mockReturnValue(false);

    await service.executeLiveTrading();

    expect(lockService.acquire).not.toHaveBeenCalled();
  });

  it('skips execution when lock is not acquired', async () => {
    lockService.acquire.mockResolvedValue({ acquired: false, lockId: null });

    await service.executeLiveTrading();

    expect(userRepo.find).not.toHaveBeenCalled();
    expect(lockService.release).not.toHaveBeenCalled();
  });

  it('places orders for valid signals on preferred exchange', async () => {
    lockService.acquire.mockResolvedValue({ acquired: true, lockId: 'lock-1' });
    const user = createUser({
      exchanges: [
        { id: 'ex-1', name: 'Coinbase', slug: 'coinbase', isActive: true },
        { id: 'ex-2', name: 'Binance US', slug: 'binance_us', isActive: true }
      ] as any
    });
    userRepo.find.mockResolvedValue([user]);
    balanceService.getUserBalances.mockResolvedValue({
      current: [{ balances: [{ free: '100', locked: '0', usdValue: 100 }] }]
    } as any);
    riskPoolMapping.getActiveStrategiesForUser.mockResolvedValue([{ id: 'strategy-1' } as any]);
    capitalAllocation.allocateCapitalByPerformance.mockResolvedValue(new Map([['strategy-1', 50]]));
    positionTracking.getPositions.mockResolvedValue([]);
    jest.spyOn<any, any>(service as any, 'fetchMarketData').mockResolvedValue([]);

    const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
    strategyExecutor.executeStrategy.mockResolvedValue(signal);
    strategyExecutor.validateSignal.mockReturnValue({ valid: true });
    orderService.placeAlgorithmicOrder.mockResolvedValue({ id: 'order-1' } as any);

    await service.executeLiveTrading();

    expect(orderService.placeAlgorithmicOrder).toHaveBeenCalledWith(user.id, 'strategy-1', signal, 'ex-2');
    expect(positionTracking.updatePosition).toHaveBeenCalled();
    expect(lockService.release).toHaveBeenCalledWith(LOCK_KEYS.LIVE_TRADING, 'lock-1');
  });

  it('skips invalid signals', async () => {
    lockService.acquire.mockResolvedValue({ acquired: true, lockId: 'lock-1' });
    const user = createUser();
    userRepo.find.mockResolvedValue([user]);
    balanceService.getUserBalances.mockResolvedValue({
      current: [{ balances: [{ free: '100', locked: '0', usdValue: 100 }] }]
    } as any);
    riskPoolMapping.getActiveStrategiesForUser.mockResolvedValue([{ id: 'strategy-1' } as any]);
    capitalAllocation.allocateCapitalByPerformance.mockResolvedValue(new Map([['strategy-1', 50]]));
    positionTracking.getPositions.mockResolvedValue([]);
    jest.spyOn<any, any>(service as any, 'fetchMarketData').mockResolvedValue([]);

    const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
    strategyExecutor.executeStrategy.mockResolvedValue(signal);
    strategyExecutor.validateSignal.mockReturnValue({ valid: false, reason: 'low confidence' });

    await service.executeLiveTrading();

    expect(orderService.placeAlgorithmicOrder).not.toHaveBeenCalled();
    expect(lockService.release).toHaveBeenCalledWith(LOCK_KEYS.LIVE_TRADING, 'lock-1');
  });

  it('disables user after three consecutive errors', async () => {
    lockService.acquire.mockResolvedValue({ acquired: true, lockId: 'lock-1' });
    const user = createUser();
    userRepo.find.mockResolvedValue([user]);
    balanceService.getUserBalances.mockRejectedValue(new Error('Balance fetch failed'));

    await service.executeLiveTrading();
    await service.executeLiveTrading();
    await service.executeLiveTrading();

    expect(userRepo.save).toHaveBeenCalledWith(expect.objectContaining({ algoTradingEnabled: false }));
  });

  it('returns status with lock info and enrolled count', async () => {
    lockService.getLockInfo.mockResolvedValue({ exists: true, lockId: 'instance-1', ttlMs: 1000 });
    userRepo.count.mockResolvedValue(5 as any);

    const result = await service.getStatus();

    expect(result).toEqual({ running: true, enrolledUsers: 5, instanceId: 'instance-1' });
  });

  it('releases lock on shutdown when held', async () => {
    (service as any).currentLockId = 'shutdown-lock';

    await service.onApplicationShutdown('SIGTERM');

    expect(lockService.release).toHaveBeenCalledWith(LOCK_KEYS.LIVE_TRADING, 'shutdown-lock');
  });
});
