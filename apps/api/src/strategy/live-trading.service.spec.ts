import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ObjectLiteral, Repository } from 'typeorm';

import { CapitalAllocationService } from './capital-allocation.service';
import { ConcentrationGateService } from './concentration-gate.service';
import { DailyLossLimitGateService } from './daily-loss-limit-gate.service';
import { LiveTradingService } from './live-trading.service';
import { PositionTrackingService } from './position-tracking.service';
import { PreTradeRiskGateService } from './pre-trade-risk-gate.service';
import { RiskPoolMappingService } from './risk-pool-mapping.service';
import { StrategyExecutorService, TradingSignal } from './strategy-executor.service';

import { TradingStateService } from '../admin/trading-state/trading-state.service';
import { BalanceService } from '../balance/balance.service';
import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { ExchangeSelectionService } from '../exchange/exchange-selection/exchange-selection.service';
import { CompositeRegimeService } from '../market-regime/composite-regime.service';
import { RegimeGateService } from '../market-regime/regime-gate.service';
import { MetricsService } from '../metrics/metrics.service';
import { OrderService } from '../order/order.service';
import { TradeExecutionService } from '../order/services/trade-execution.service';
import { LOCK_KEYS } from '../shared/distributed-lock.constants';
import { DistributedLockService } from '../shared/distributed-lock.service';
import { TradeCooldownService } from '../shared/trade-cooldown.service';
import { User } from '../users/users.entity';

type MockRepo<T extends ObjectLiteral> = jest.Mocked<Repository<T>>;

const createUser = (overrides: Record<string, unknown> = {}): User =>
  ({
    id: 'user-1',
    algoTradingEnabled: true,
    algoCapitalAllocationPercentage: 50,
    coinRisk: { level: 3 } as any,
    effectiveCalculationRiskLevel: 3,
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
  let regimeGateService: jest.Mocked<RegimeGateService>;
  let preTradeRiskGate: jest.Mocked<PreTradeRiskGateService>;
  let dailyLossLimitGate: jest.Mocked<DailyLossLimitGateService>;
  let tradeExecutionService: jest.Mocked<TradeExecutionService>;
  let tradeCooldownService: jest.Mocked<TradeCooldownService>;

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
      allocateCapitalByKelly: jest.fn()
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

    regimeGateService = {
      filterLiveSignal: jest.fn().mockReturnValue({ allowed: true })
    } as unknown as jest.Mocked<RegimeGateService>;

    preTradeRiskGate = {
      checkDrawdown: jest.fn().mockResolvedValue({ allowed: true })
    } as unknown as jest.Mocked<PreTradeRiskGateService>;

    dailyLossLimitGate = {
      isEntryBlocked: jest.fn().mockResolvedValue({ blocked: false }),
      checkDailyLossLimit: jest.fn().mockResolvedValue({ allowed: true })
    } as unknown as jest.Mocked<DailyLossLimitGateService>;

    tradeExecutionService = {
      executeTradeSignal: jest.fn().mockResolvedValue({ id: 'order-1' })
    } as unknown as jest.Mocked<TradeExecutionService>;

    tradeCooldownService = {
      checkAndClaim: jest.fn().mockResolvedValue({ allowed: true }),
      clearCooldown: jest.fn().mockResolvedValue(undefined)
    } as unknown as jest.Mocked<TradeCooldownService>;

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
        { provide: TradingStateService, useValue: tradingStateService },
        {
          provide: CompositeRegimeService,
          useValue: {
            getCompositeRegime: jest.fn().mockReturnValue('BULL'),
            getVolatilityRegime: jest.fn().mockReturnValue('normal'),
            getTrendAboveSma: jest.fn().mockReturnValue(true),
            isOverrideActive: jest.fn().mockReturnValue(false)
          }
        },
        { provide: RegimeGateService, useValue: regimeGateService },
        { provide: PreTradeRiskGateService, useValue: preTradeRiskGate },
        { provide: DailyLossLimitGateService, useValue: dailyLossLimitGate },
        {
          provide: ConcentrationGateService,
          useValue: {
            buildAssetAllocations: jest.fn().mockReturnValue([]),
            checkTrade: jest.fn().mockReturnValue({ allowed: true })
          }
        },
        { provide: TradeExecutionService, useValue: tradeExecutionService },
        { provide: TradeCooldownService, useValue: tradeCooldownService },
        {
          provide: ExchangeSelectionService,
          useValue: {
            selectForBuy: jest.fn().mockResolvedValue({ id: 'ek-1', exchange: { slug: 'binance_us' } }),
            selectForSell: jest.fn().mockResolvedValue({ id: 'ek-1', exchange: { slug: 'binance_us' } })
          }
        },
        {
          provide: MetricsService,
          useValue: {
            recordTradeCooldownBlock: jest.fn(),
            recordTradeCooldownClaim: jest.fn(),
            recordTradeCooldownCleared: jest.fn(),
            recordRegimeGateBlock: jest.fn(),
            recordDrawdownGateBlock: jest.fn(),
            recordDailyLossGateBlock: jest.fn(),
            recordConcentrationGateBlock: jest.fn(),
            recordLiveOrderPlaced: jest.fn()
          }
        }
      ]
    }).compile();

    service = module.get(LiveTradingService);
  });

  /** Mocks the common setup for tests that reach the signal execution path */
  const setupSignalPath = (opts?: { user?: Record<string, unknown>; strategies?: any[] }): User => {
    lockService.acquire.mockResolvedValue({ acquired: true, lockId: 'lock-1' });
    const user = createUser(opts?.user);
    userRepo.find.mockResolvedValue([user]);
    balanceService.getUserBalances.mockResolvedValue({
      current: [{ balances: [{ free: '100', locked: '0', usdValue: 100 }] }]
    } as any);
    riskPoolMapping.getActiveStrategiesForUser.mockResolvedValue(opts?.strategies ?? [{ id: 'strategy-1' } as any]);
    capitalAllocation.allocateCapitalByKelly.mockResolvedValue(new Map([['strategy-1', 50]]));
    positionTracking.getPositions.mockResolvedValue([]);
    jest.spyOn<any, any>(service as any, 'fetchMarketData').mockResolvedValue([]);
    return user;
  };

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

  it('places spot order on preferred exchange and tracks buy as long', async () => {
    const user = setupSignalPath({
      user: {
        exchanges: [
          { id: 'ex-1', name: 'Coinbase', slug: 'coinbase', isActive: true },
          { id: 'ex-2', name: 'Binance US', slug: 'binance_us', isActive: true }
        ] as any
      }
    });

    const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
    strategyExecutor.executeStrategy.mockResolvedValue(signal);
    strategyExecutor.validateSignal.mockReturnValue({ valid: true });
    orderService.placeAlgorithmicOrder.mockResolvedValue({ id: 'order-1' } as any);

    await service.executeLiveTrading();

    expect(orderService.placeAlgorithmicOrder).toHaveBeenCalledWith(user.id, 'strategy-1', signal, 'ek-1');
    expect(positionTracking.updatePosition).toHaveBeenCalledWith(
      user.id,
      'strategy-1',
      'BTC/USDT',
      0.01,
      30000,
      'buy',
      'long',
      'ek-1'
    );
    expect(lockService.release).toHaveBeenCalledWith(LOCK_KEYS.LIVE_TRADING, 'lock-1');
  });

  it('skips invalid signals without placing orders', async () => {
    setupSignalPath();

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

  it('tracks sell signal as side=sell positionSide=long via spot path', async () => {
    const user = setupSignalPath();

    const signal: TradingSignal = { action: 'sell', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
    strategyExecutor.executeStrategy.mockResolvedValue(signal);
    strategyExecutor.validateSignal.mockReturnValue({ valid: true });
    orderService.placeAlgorithmicOrder.mockResolvedValue({ id: 'order-1' } as any);

    await service.executeLiveTrading();

    expect(orderService.placeAlgorithmicOrder).toHaveBeenCalled();
    expect(positionTracking.updatePosition).toHaveBeenCalledWith(
      user.id,
      'strategy-1',
      'BTC/USDT',
      0.01,
      30000,
      'sell',
      'long',
      undefined
    );
  });

  it('routes short_entry through futures path and tracks as buy/short', async () => {
    const user = setupSignalPath({
      strategies: [{ id: 'strategy-1', marketType: 'futures', defaultLeverage: 1 } as any]
    });

    const signal: TradingSignal = { action: 'short_entry', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
    strategyExecutor.executeStrategy.mockResolvedValue(signal);
    strategyExecutor.validateSignal.mockReturnValue({ valid: true });

    await service.executeLiveTrading();

    expect(tradeExecutionService.executeTradeSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SELL',
        symbol: 'BTC/USDT',
        quantity: 0.01,
        marketType: 'futures',
        positionSide: 'short',
        leverage: 1
      })
    );
    expect(orderService.placeAlgorithmicOrder).not.toHaveBeenCalled();
    expect(positionTracking.updatePosition).toHaveBeenCalledWith(
      user.id,
      'strategy-1',
      'BTC/USDT',
      0.01,
      30000,
      'buy',
      'short',
      undefined
    );
  });

  it('routes short_exit through futures path and tracks as sell/short', async () => {
    const user = setupSignalPath({
      strategies: [{ id: 'strategy-1', marketType: 'futures', defaultLeverage: 1 } as any]
    });

    const signal: TradingSignal = { action: 'short_exit', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
    strategyExecutor.executeStrategy.mockResolvedValue(signal);
    strategyExecutor.validateSignal.mockReturnValue({ valid: true });

    await service.executeLiveTrading();

    expect(tradeExecutionService.executeTradeSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'BUY',
        symbol: 'BTC/USDT',
        quantity: 0.01,
        marketType: 'futures',
        positionSide: 'short',
        leverage: 1
      })
    );
    expect(orderService.placeAlgorithmicOrder).not.toHaveBeenCalled();
    expect(positionTracking.updatePosition).toHaveBeenCalledWith(
      user.id,
      'strategy-1',
      'BTC/USDT',
      0.01,
      30000,
      'sell',
      'short',
      'ek-1'
    );
  });

  it('blocks signal when regime gate rejects', async () => {
    setupSignalPath();
    regimeGateService.filterLiveSignal.mockReturnValue({
      allowed: false,
      reason: 'BEAR regime — BUY signals blocked'
    } as any);

    const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
    strategyExecutor.executeStrategy.mockResolvedValue(signal);
    strategyExecutor.validateSignal.mockReturnValue({ valid: true });

    await service.executeLiveTrading();

    expect(orderService.placeAlgorithmicOrder).not.toHaveBeenCalled();
    expect(tradeExecutionService.executeTradeSignal).not.toHaveBeenCalled();
  });

  it('blocks signal when drawdown gate rejects', async () => {
    setupSignalPath();
    preTradeRiskGate.checkDrawdown.mockResolvedValue({ allowed: false, reason: 'drawdown breach' } as any);

    const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
    strategyExecutor.executeStrategy.mockResolvedValue(signal);
    strategyExecutor.validateSignal.mockReturnValue({ valid: true });

    await service.executeLiveTrading();

    expect(orderService.placeAlgorithmicOrder).not.toHaveBeenCalled();
  });

  it('blocks signal when trade cooldown rejects', async () => {
    setupSignalPath();
    tradeCooldownService.checkAndClaim.mockResolvedValue({
      allowed: false,
      existingClaim: { pipeline: 'pipeline:abc' }
    } as any);

    const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
    strategyExecutor.executeStrategy.mockResolvedValue(signal);
    strategyExecutor.validateSignal.mockReturnValue({ valid: true });

    await service.executeLiveTrading();

    expect(orderService.placeAlgorithmicOrder).not.toHaveBeenCalled();
  });

  it('clears cooldown when order placement fails', async () => {
    setupSignalPath();

    const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
    strategyExecutor.executeStrategy.mockResolvedValue(signal);
    strategyExecutor.validateSignal.mockReturnValue({ valid: true });
    orderService.placeAlgorithmicOrder.mockRejectedValue(new Error('Exchange error'));

    await service.executeLiveTrading();

    expect(tradeCooldownService.clearCooldown).toHaveBeenCalledWith('user-1', 'BTC/USDT', 'BUY');
  });

  it('releases lock on shutdown when held', async () => {
    (service as any).currentLockId = 'shutdown-lock';

    await service.onApplicationShutdown('SIGTERM');

    expect(lockService.release).toHaveBeenCalledWith(LOCK_KEYS.LIVE_TRADING, 'shutdown-lock');
  });

  it('does not release lock on shutdown when none is held', async () => {
    await service.onApplicationShutdown('SIGTERM');

    expect(lockService.release).not.toHaveBeenCalled();
  });
});
