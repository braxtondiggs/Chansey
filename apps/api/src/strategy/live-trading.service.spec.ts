import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { CapitalAllocationService } from './capital-allocation.service';
import { LiveTradingService } from './live-trading.service';
import { PositionTrackingService } from './position-tracking.service';
import { RiskPoolMappingService } from './risk-pool-mapping.service';
import { StrategyExecutorService, TradingSignal } from './strategy-executor.service';

import { BalanceService } from '../balance/balance.service';
import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { OrderService } from '../order/order.service';
import { PriceService } from '../price/price.service';
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
  let priceService: jest.Mocked<any>;
  let exchangeManager: jest.Mocked<any>;

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

    priceService = {
      findAll: jest.fn(),
      findAllByDay: jest.fn(),
      findAllByHour: jest.fn()
    } as unknown as jest.Mocked<any>;

    exchangeManager = {
      getPrice: jest.fn()
    } as unknown as jest.Mocked<any>;

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
        { provide: PriceService, useValue: priceService },
        { provide: ExchangeManagerService, useValue: exchangeManager }
      ]
    }).compile();

    service = module.get(LiveTradingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('skips execution when lock is not acquired', async () => {
    lockService.acquire.mockResolvedValue({ acquired: false, lockId: null });

    await service.executeLiveTrading();

    expect(userRepo.find).not.toHaveBeenCalled();
    expect(lockService.release).not.toHaveBeenCalled();
  });

  it('releases lock when no enrolled users are found', async () => {
    lockService.acquire.mockResolvedValue({ acquired: true, lockId: 'lock-1' });
    userRepo.find.mockResolvedValue([]);

    await service.executeLiveTrading();

    expect(lockService.release).toHaveBeenCalledWith(LOCK_KEYS.LIVE_TRADING, 'lock-1');
  });

  it('processes enrolled users and places orders for valid signals', async () => {
    lockService.acquire.mockResolvedValue({ acquired: true, lockId: 'lock-1' });
    const user = createUser();
    userRepo.find.mockResolvedValue([user]);
    balanceService.getUserBalances.mockResolvedValue({
      current: [
        {
          balances: [{ free: '100', locked: '0', usdValue: 100 }]
        }
      ]
    } as any);
    const strategy = { id: 'strategy-1' } as any;
    riskPoolMapping.getActiveStrategiesForUser.mockResolvedValue([strategy]);
    capitalAllocation.allocateCapitalByPerformance.mockResolvedValue(new Map([['strategy-1', 50]]));
    positionTracking.getPositions.mockResolvedValue([{ strategyConfigId: 'strategy-1' }] as any);
    jest.spyOn<any, any>(service as any, 'fetchMarketData').mockResolvedValue([]);

    const signal: TradingSignal = {
      action: 'buy',
      symbol: 'BTC/USDT',
      quantity: 0.01,
      price: 30000
    } as any;
    strategyExecutor.executeStrategy.mockResolvedValue(signal);
    strategyExecutor.validateSignal.mockReturnValue({ valid: true });
    orderService.placeAlgorithmicOrder.mockResolvedValue({ id: 'order-1' } as any);

    await service.executeLiveTrading();

    expect(orderService.placeAlgorithmicOrder).toHaveBeenCalledWith(user.id, 'strategy-1', signal, 'ex-1');
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
    const invalidSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as TradingSignal;
    strategyExecutor.executeStrategy.mockResolvedValue(invalidSignal);
    strategyExecutor.validateSignal.mockReturnValue({ valid: false, reason: 'low confidence' });

    await service.executeLiveTrading();

    expect(orderService.placeAlgorithmicOrder).not.toHaveBeenCalled();
    expect(lockService.release).toHaveBeenCalledWith(LOCK_KEYS.LIVE_TRADING, 'lock-1');
  });

  it('returns status with lock info and enrolled count', async () => {
    lockService.getLockInfo.mockResolvedValue({ exists: true, lockId: 'instance-1', ttlMs: 1000 });
    userRepo.count.mockResolvedValue(5 as any);

    const result = await service.getStatus();

    expect(result).toEqual({ running: true, enrolledUsers: 5, instanceId: 'instance-1' });
  });

  it('skips users without allocation or exchanges or free balance', async () => {
    lockService.acquire.mockResolvedValue({ acquired: true, lockId: 'lock-1' });
    const warnSpy = jest.spyOn((service as any).logger, 'warn');

    const noAllocation = createUser({ algoCapitalAllocationPercentage: 0 });
    const noExchanges = createUser({ exchanges: [] });
    const noBalance = createUser({ id: 'user-3' });

    userRepo.find.mockResolvedValue([noAllocation, noExchanges, noBalance]);
    balanceService.getUserBalances.mockResolvedValue({
      current: [{ balances: [{ free: '0', locked: '0', usdValue: 0 }] }]
    } as any);
    riskPoolMapping.getActiveStrategiesForUser.mockResolvedValue([{ id: 'strategy-1' } as any]);

    await service.executeLiveTrading();

    expect(orderService.placeAlgorithmicOrder).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled(); // at least one warning emitted
    expect(lockService.release).toHaveBeenCalledWith(LOCK_KEYS.LIVE_TRADING, 'lock-1');
  });

  it('releases lock even when executeUserStrategies throws', async () => {
    lockService.acquire.mockResolvedValue({ acquired: true, lockId: 'lock-1' });
    userRepo.find.mockResolvedValue([createUser()]);
    jest.spyOn<any, any>(service as any, 'executeUserStrategies').mockRejectedValue(new Error('boom'));

    await service.executeLiveTrading();

    expect(lockService.release).toHaveBeenCalledWith(LOCK_KEYS.LIVE_TRADING, 'lock-1');
  });

  it('handleUserError disables trading and saves user', async () => {
    const user = createUser();
    // Prime strikes to one below threshold so the next error disables trading
    (service as any).userErrorStrikes.set(user.id, 2);
    await (service as any).handleUserError(user, new Error('fail'));

    expect(user.algoTradingEnabled).toBe(false);
    expect(userRepo.save).toHaveBeenCalledWith(user);
  });

  describe('onApplicationShutdown', () => {
    it('releases lock on shutdown if held', async () => {
      // Simulate acquiring a lock
      lockService.acquire.mockResolvedValue({ acquired: true, lockId: 'shutdown-lock' });
      userRepo.find.mockResolvedValue([]);

      await service.executeLiveTrading();

      // Now trigger shutdown
      await service.onApplicationShutdown('SIGTERM');

      // Lock should have been released in finally block, and again in shutdown
      expect(lockService.release).toHaveBeenCalledWith(LOCK_KEYS.LIVE_TRADING, 'shutdown-lock');
    });

    it('does nothing on shutdown if no lock held', async () => {
      await service.onApplicationShutdown('SIGTERM');

      expect(lockService.release).not.toHaveBeenCalled();
    });
  });

  describe('strike-based error handling', () => {
    it('does not disable user after first error', async () => {
      lockService.acquire.mockResolvedValue({ acquired: true, lockId: 'lock-1' });
      const user = createUser();
      userRepo.find.mockResolvedValue([user]);
      balanceService.getUserBalances.mockRejectedValue(new Error('Balance fetch failed'));

      await service.executeLiveTrading();

      expect(userRepo.save).not.toHaveBeenCalled();
      expect(lockService.release).toHaveBeenCalled();
    });

    it('disables user after 3 consecutive errors', async () => {
      lockService.acquire.mockResolvedValue({ acquired: true, lockId: 'lock-1' });
      const user = createUser();
      userRepo.find.mockResolvedValue([user]);
      balanceService.getUserBalances.mockRejectedValue(new Error('Balance fetch failed'));

      // Execute 3 times to reach the strike limit
      await service.executeLiveTrading();
      await service.executeLiveTrading();
      await service.executeLiveTrading();

      expect(userRepo.save).toHaveBeenCalledWith(expect.objectContaining({ algoTradingEnabled: false }));
    });

    it('resets strikes on successful execution', async () => {
      lockService.acquire.mockResolvedValue({ acquired: true, lockId: 'lock-1' });
      const user = createUser();
      userRepo.find.mockResolvedValue([user]);

      // First call fails
      balanceService.getUserBalances.mockRejectedValueOnce(new Error('Balance fetch failed'));
      await service.executeLiveTrading();

      // Second call fails
      balanceService.getUserBalances.mockRejectedValueOnce(new Error('Balance fetch failed'));
      await service.executeLiveTrading();

      // Third call succeeds (should reset strikes)
      balanceService.getUserBalances.mockResolvedValueOnce({
        current: [{ balances: [{ free: '100', locked: '0', usdValue: 100 }] }]
      } as any);
      riskPoolMapping.getActiveStrategiesForUser.mockResolvedValue([]);
      await service.executeLiveTrading();

      // Fourth call fails again (should be strike 1, not 3)
      balanceService.getUserBalances.mockRejectedValueOnce(new Error('Balance fetch failed'));
      await service.executeLiveTrading();

      // User should not be disabled (only 1 strike after reset)
      expect(userRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('exchange selection', () => {
    it('prefers binance for BTC pairs', async () => {
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

      const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 };
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });
      orderService.placeAlgorithmicOrder.mockResolvedValue({ id: 'order-1' } as any);

      await service.executeLiveTrading();

      // Should use Binance US (ex-2) for BTC pairs
      expect(orderService.placeAlgorithmicOrder).toHaveBeenCalledWith('user-1', 'strategy-1', signal, 'ex-2');
    });
  });
});
