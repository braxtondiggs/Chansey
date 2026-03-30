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
import { FailedJobService } from '../failed-jobs/failed-job.service';
import { CompositeRegimeService } from '../market-regime/composite-regime.service';
import { MetricsService } from '../metrics/metrics.service';
import { SignalFilterChainService } from '../order/backtest/shared/filters';
import {
  OpportunitySellDecision,
  DEFAULT_OPPORTUNITY_SELLING_CONFIG
} from '../order/interfaces/opportunity-selling.interface';
import { OrderService } from '../order/order.service';
import { OpportunitySellService } from '../order/services/opportunity-sell.service';
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

/** Helper to build OpportunitySellService.evaluateAndPersist result with sensible defaults */
const createOppSellResult = (overrides: Record<string, unknown> = {}) => ({
  decision: OpportunitySellDecision.APPROVED,
  sellOrders: [{ coinId: 'ETH', quantity: 0.5, currentPrice: 2000, estimatedProceeds: 1000, score: {} as any }],
  reason: 'Selling 1 position(s)',
  projectedProceeds: 1000,
  buySignalCoinId: 'BTC',
  buySignalConfidence: 0.8,
  shortfall: 200,
  availableCash: 100,
  portfolioValue: 5000,
  evaluatedPositions: [],
  liquidationPercent: 20,
  ...overrides
});

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
  let signalFilterChain: jest.Mocked<SignalFilterChainService>;
  let preTradeRiskGate: jest.Mocked<PreTradeRiskGateService>;
  let dailyLossLimitGate: jest.Mocked<DailyLossLimitGateService>;
  let tradeExecutionService: jest.Mocked<TradeExecutionService>;
  let tradeCooldownService: jest.Mocked<TradeCooldownService>;
  let opportunitySellService: jest.Mocked<OpportunitySellService>;

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

    signalFilterChain = {
      apply: jest.fn().mockReturnValue({
        signals: [{ action: 'buy', originalType: undefined }],
        maxAllocation: 1,
        minAllocation: 0,
        regimeGateBlockedCount: 0,
        regimeMultiplier: 1
      })
    } as unknown as jest.Mocked<SignalFilterChainService>;

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

    opportunitySellService = {
      evaluateAndPersist: jest.fn().mockResolvedValue({
        decision: OpportunitySellDecision.APPROVED,
        sellOrders: [],
        reason: 'test',
        projectedProceeds: 0
      })
    } as unknown as jest.Mocked<OpportunitySellService>;

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
        { provide: SignalFilterChainService, useValue: signalFilterChain },
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
        { provide: OpportunitySellService, useValue: opportunitySellService },
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
        },
        { provide: FailedJobService, useValue: { recordFailure: jest.fn() } }
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

  it('blocks entry signal when daily loss limit gate is breached', async () => {
    setupSignalPath();
    dailyLossLimitGate.isEntryBlocked.mockResolvedValue({ blocked: true, reason: 'daily loss exceeded' } as any);

    const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
    strategyExecutor.executeStrategy.mockResolvedValue(signal);
    strategyExecutor.validateSignal.mockReturnValue({ valid: true });

    await service.executeLiveTrading();

    expect(orderService.placeAlgorithmicOrder).not.toHaveBeenCalled();
    expect(tradeExecutionService.executeTradeSignal).not.toHaveBeenCalled();
  });

  it('blocks entry signal when concentration gate rejects', async () => {
    setupSignalPath();
    const concentrationGateService = (service as any).concentrationGate;
    concentrationGateService.checkTrade.mockReturnValue({ allowed: false, reason: 'concentration too high' });

    const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
    strategyExecutor.executeStrategy.mockResolvedValue(signal);
    strategyExecutor.validateSignal.mockReturnValue({ valid: true });

    await service.executeLiveTrading();

    expect(orderService.placeAlgorithmicOrder).not.toHaveBeenCalled();
  });

  it('reduces signal quantity when concentration gate applies adjustment', async () => {
    setupSignalPath();
    const concentrationGateService = (service as any).concentrationGate;
    concentrationGateService.checkTrade.mockReturnValue({ allowed: true, adjustedQuantity: 0.5 });

    const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
    strategyExecutor.executeStrategy.mockResolvedValue(signal);
    strategyExecutor.validateSignal.mockReturnValue({ valid: true });
    orderService.placeAlgorithmicOrder.mockResolvedValue({ id: 'order-1' } as any);

    await service.executeLiveTrading();

    expect(orderService.placeAlgorithmicOrder).toHaveBeenCalledWith(
      'user-1',
      'strategy-1',
      expect.objectContaining({ quantity: 0.005 }),
      'ek-1'
    );
  });

  it('resets error strikes after successful execution', async () => {
    lockService.acquire.mockResolvedValue({ acquired: true, lockId: 'lock-1' });
    const user = createUser();
    userRepo.find.mockResolvedValue([user]);

    // Two failures to accumulate strikes
    balanceService.getUserBalances.mockRejectedValue(new Error('fail'));
    await service.executeLiveTrading();
    await service.executeLiveTrading();

    // One success resets strikes
    balanceService.getUserBalances.mockResolvedValue({
      current: [{ balances: [{ free: '100', locked: '0', usdValue: 100 }] }]
    } as any);
    riskPoolMapping.getActiveStrategiesForUser.mockResolvedValue([]);
    jest.spyOn<any, any>(service as any, 'fetchMarketData').mockResolvedValue([]);
    await service.executeLiveTrading();

    // Another failure should NOT disable (strikes reset to 0, now at 1)
    balanceService.getUserBalances.mockRejectedValue(new Error('fail again'));
    await service.executeLiveTrading();

    expect(userRepo.save).not.toHaveBeenCalled();
  });

  it('blocks signal when regime gate rejects', async () => {
    setupSignalPath();
    signalFilterChain.apply.mockReturnValue({
      signals: [],
      maxAllocation: 1,
      minAllocation: 0,
      regimeGateBlockedCount: 1,
      regimeMultiplier: 1
    });

    const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
    strategyExecutor.executeStrategy.mockResolvedValue(signal);
    strategyExecutor.validateSignal.mockReturnValue({ valid: true });

    await service.executeLiveTrading();

    expect(orderService.placeAlgorithmicOrder).not.toHaveBeenCalled();
    expect(tradeExecutionService.executeTradeSignal).not.toHaveBeenCalled();
  });

  it('passes override flag through to signal filter chain', async () => {
    setupSignalPath();
    const compositeRegimeService = (service as any).compositeRegimeService;
    compositeRegimeService.isOverrideActive.mockReturnValue(true);

    const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
    strategyExecutor.executeStrategy.mockResolvedValue(signal);
    strategyExecutor.validateSignal.mockReturnValue({ valid: true });
    orderService.placeAlgorithmicOrder.mockResolvedValue({ id: 'order-1' } as any);

    await service.executeLiveTrading();

    expect(signalFilterChain.apply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tradingContext: 'live',
        overrideActive: true,
        regimeGateEnabled: true
      }),
      expect.anything()
    );
  });

  it('passes risk level through to signal filter chain', async () => {
    setupSignalPath({ user: { effectiveCalculationRiskLevel: 5, coinRisk: { level: 5 } as any } });

    const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
    strategyExecutor.executeStrategy.mockResolvedValue(signal);
    strategyExecutor.validateSignal.mockReturnValue({ valid: true });
    orderService.placeAlgorithmicOrder.mockResolvedValue({ id: 'order-1' } as any);

    await service.executeLiveTrading();

    expect(signalFilterChain.apply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tradingContext: 'live',
        riskLevel: 5
      }),
      expect.anything()
    );
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

  it('skips user with zero capital allocation percentage', async () => {
    setupSignalPath({ user: { algoCapitalAllocationPercentage: 0 } });

    await service.executeLiveTrading();

    expect(riskPoolMapping.getActiveStrategiesForUser).not.toHaveBeenCalled();
    expect(orderService.placeAlgorithmicOrder).not.toHaveBeenCalled();
  });

  it('skips order when no exchange key is found for user', async () => {
    setupSignalPath();
    const exchangeSelectionService = (service as any).exchangeSelectionService;
    exchangeSelectionService.selectForBuy.mockRejectedValue(new Error('No suitable exchange key'));

    const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
    strategyExecutor.executeStrategy.mockResolvedValue(signal);
    strategyExecutor.validateSignal.mockReturnValue({ valid: true });

    await service.executeLiveTrading();

    expect(orderService.placeAlgorithmicOrder).not.toHaveBeenCalled();
  });

  it('continues processing remaining strategies when one throws', async () => {
    const strategies = [{ id: 'strategy-1' } as any, { id: 'strategy-2' } as any];
    setupSignalPath({ strategies });
    capitalAllocation.allocateCapitalByKelly.mockResolvedValue(
      new Map([
        ['strategy-1', 25],
        ['strategy-2', 25]
      ])
    );

    // First strategy throws, second produces a valid signal
    strategyExecutor.executeStrategy
      .mockRejectedValueOnce(new Error('Strategy 1 blew up'))
      .mockResolvedValueOnce({ action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any);
    strategyExecutor.validateSignal.mockReturnValue({ valid: true });
    orderService.placeAlgorithmicOrder.mockResolvedValue({ id: 'order-1' } as any);

    await service.executeLiveTrading();

    // Strategy 2 should still have been executed and placed an order
    expect(strategyExecutor.executeStrategy).toHaveBeenCalledTimes(2);
    expect(orderService.placeAlgorithmicOrder).toHaveBeenCalledTimes(1);
  });

  it('does not block sell signals when daily loss limit is breached', async () => {
    setupSignalPath();
    dailyLossLimitGate.isEntryBlocked.mockResolvedValue({ blocked: true, reason: 'daily loss exceeded' } as any);

    const signal: TradingSignal = { action: 'sell', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
    strategyExecutor.executeStrategy.mockResolvedValue(signal);
    strategyExecutor.validateSignal.mockReturnValue({ valid: true });
    orderService.placeAlgorithmicOrder.mockResolvedValue({ id: 'order-1' } as any);

    await service.executeLiveTrading();

    expect(orderService.placeAlgorithmicOrder).toHaveBeenCalled();
  });

  describe('opportunity selling', () => {
    it('does not trigger opportunity selling when BUY has sufficient funds', async () => {
      setupSignalPath({
        user: { enableOpportunitySelling: true, opportunitySellingConfig: DEFAULT_OPPORTUNITY_SELLING_CONFIG }
      });

      // Signal costs $300 but balance is $100 free — however quantity*price = 0.01*30000 = $300
      // Balance is $100, so this will trigger... let's make the signal cheap enough
      const signal: TradingSignal = {
        action: 'buy',
        symbol: 'BTC/USDT',
        quantity: 0.001,
        price: 30000,
        confidence: 0.8
      };
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });
      orderService.placeAlgorithmicOrder.mockResolvedValue({ id: 'order-1' } as any);

      await service.executeLiveTrading();

      expect(opportunitySellService.evaluateAndPersist).not.toHaveBeenCalled();
      expect(orderService.placeAlgorithmicOrder).toHaveBeenCalled();
    });

    it('proceeds with BUY when opportunity selling is disabled even with insufficient funds', async () => {
      setupSignalPath({
        user: { enableOpportunitySelling: false, opportunitySellingConfig: DEFAULT_OPPORTUNITY_SELLING_CONFIG }
      });

      const signal: TradingSignal = {
        action: 'buy',
        symbol: 'BTC/USDT',
        quantity: 0.01,
        price: 30000,
        confidence: 0.8
      };
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });
      orderService.placeAlgorithmicOrder.mockResolvedValue({ id: 'order-1' } as any);

      await service.executeLiveTrading();

      // Opportunity selling not triggered because disabled
      expect(opportunitySellService.evaluateAndPersist).not.toHaveBeenCalled();
      // BUY still proceeds (the placeOrder call itself may fail on exchange, but we don't gate on balance here)
      expect(orderService.placeAlgorithmicOrder).toHaveBeenCalled();
    });

    it('executes opportunity sells and proceeds with BUY when approved', async () => {
      setupSignalPath({
        user: { enableOpportunitySelling: true, opportunitySellingConfig: DEFAULT_OPPORTUNITY_SELLING_CONFIG }
      });
      jest.spyOn<any, any>(service as any, 'fetchMarketData').mockResolvedValue([
        { symbol: 'BTC/USDT', price: 30000, timestamp: new Date() },
        { symbol: 'ETH/USDT', price: 2000, timestamp: new Date() }
      ]);

      opportunitySellService.evaluateAndPersist.mockResolvedValue(createOppSellResult());

      // First call: initial balance (low cash triggers opp selling), Second call: after sells (sufficient)
      balanceService.getUserBalances
        .mockReset()
        .mockResolvedValueOnce({
          current: [{ balances: [{ free: '100', locked: '0', usdValue: 100 }] }]
        } as any)
        .mockResolvedValueOnce({
          current: [{ balances: [{ free: '1100', locked: '0', usdValue: 1100 }] }]
        } as any);

      const signal: TradingSignal = {
        action: 'buy',
        symbol: 'BTC/USDT',
        quantity: 0.01,
        price: 30000,
        confidence: 0.8
      };
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });
      orderService.placeAlgorithmicOrder.mockResolvedValue({ id: 'order-1' } as any);

      await service.executeLiveTrading();

      // Opportunity sell was evaluated
      expect(opportunitySellService.evaluateAndPersist).toHaveBeenCalled();
      // Sell order placed for ETH
      expect(orderService.placeAlgorithmicOrder).toHaveBeenCalledWith(
        'user-1',
        'strategy-1',
        expect.objectContaining({ action: 'sell', symbol: 'ETH/USDT', quantity: 0.5 }),
        'ek-1'
      );
      // Then BUY order placed for BTC
      expect(orderService.placeAlgorithmicOrder).toHaveBeenCalledWith(
        'user-1',
        'strategy-1',
        expect.objectContaining({ action: 'buy', symbol: 'BTC/USDT', quantity: 0.01 }),
        'ek-1'
      );
    });

    it('skips BUY when opportunity selling rejects (low confidence)', async () => {
      setupSignalPath({
        user: { enableOpportunitySelling: true, opportunitySellingConfig: DEFAULT_OPPORTUNITY_SELLING_CONFIG }
      });

      opportunitySellService.evaluateAndPersist.mockResolvedValue(
        createOppSellResult({
          decision: OpportunitySellDecision.REJECTED_LOW_CONFIDENCE,
          sellOrders: [],
          reason: 'Buy signal confidence too low',
          projectedProceeds: 0,
          buySignalConfidence: 0.3,
          liquidationPercent: 0
        })
      );

      const signal: TradingSignal = {
        action: 'buy',
        symbol: 'BTC/USDT',
        quantity: 0.01,
        price: 30000,
        confidence: 0.3
      };
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      await service.executeLiveTrading();

      expect(opportunitySellService.evaluateAndPersist).toHaveBeenCalled();
      // BUY should NOT have been placed
      expect(orderService.placeAlgorithmicOrder).not.toHaveBeenCalled();
    });

    it('does not trigger opportunity selling for SELL signals', async () => {
      setupSignalPath({
        user: { enableOpportunitySelling: true, opportunitySellingConfig: DEFAULT_OPPORTUNITY_SELLING_CONFIG }
      });

      const signal: TradingSignal = {
        action: 'sell',
        symbol: 'BTC/USDT',
        quantity: 0.01,
        price: 30000,
        confidence: 0.8
      };
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });
      orderService.placeAlgorithmicOrder.mockResolvedValue({ id: 'order-1' } as any);

      await service.executeLiveTrading();

      expect(opportunitySellService.evaluateAndPersist).not.toHaveBeenCalled();
      expect(orderService.placeAlgorithmicOrder).toHaveBeenCalled();
    });

    it('skips opportunity selling in extreme/bear regime even when enabled', async () => {
      setupSignalPath({
        user: { enableOpportunitySelling: true, opportunitySellingConfig: DEFAULT_OPPORTUNITY_SELLING_CONFIG }
      });

      // Override composite regime to BEAR
      const compositeRegimeService = (service as any).compositeRegimeService;
      compositeRegimeService.getCompositeRegime.mockReturnValue('BEAR');

      const signal: TradingSignal = {
        action: 'buy',
        symbol: 'BTC/USDT',
        quantity: 0.01,
        price: 30000,
        confidence: 0.8
      };
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      await service.executeLiveTrading();

      // Regime gate (mocked to allow) passes, but attemptOpportunitySelling skips due to bear regime
      // → BUY not placed because opportunity selling returned false and the flow continued to skip
      expect(orderService.placeAlgorithmicOrder).not.toHaveBeenCalled();
    });

    it('allows strategy execution with zero free balance when opportunity selling is enabled (Fix #1)', async () => {
      lockService.acquire.mockResolvedValue({ acquired: true, lockId: 'lock-1' });
      const user = createUser({
        enableOpportunitySelling: true,
        opportunitySellingConfig: DEFAULT_OPPORTUNITY_SELLING_CONFIG
      });
      userRepo.find.mockResolvedValue([user]);

      // Zero free balance — fully invested
      balanceService.getUserBalances.mockResolvedValue({
        current: [{ balances: [{ free: '0', locked: '500', usdValue: 500 }] }]
      } as any);
      riskPoolMapping.getActiveStrategiesForUser.mockResolvedValue([{ id: 'strategy-1' } as any]);
      capitalAllocation.allocateCapitalByKelly.mockResolvedValue(new Map([['strategy-1', 250]]));
      positionTracking.getPositions.mockResolvedValue([]);
      jest
        .spyOn<any, any>(service as any, 'fetchMarketData')
        .mockResolvedValue([{ symbol: 'BTC/USDT', price: 30000, timestamp: new Date() }]);

      const signal: TradingSignal = {
        action: 'buy',
        symbol: 'BTC/USDT',
        quantity: 0.001,
        price: 30000,
        confidence: 0.8
      };
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });
      orderService.placeAlgorithmicOrder.mockResolvedValue({ id: 'order-1' } as any);

      await service.executeLiveTrading();

      // Strategies should still execute — estimatePortfolioCapital used as fallback
      expect(strategyExecutor.executeStrategy).toHaveBeenCalled();
    });

    it('skips buy when balance re-verification shows insufficient funds after sells (Fix #2)', async () => {
      setupSignalPath({
        user: { enableOpportunitySelling: true, opportunitySellingConfig: DEFAULT_OPPORTUNITY_SELLING_CONFIG }
      });
      jest.spyOn<any, any>(service as any, 'fetchMarketData').mockResolvedValue([
        { symbol: 'BTC/USDT', price: 30000, timestamp: new Date() },
        { symbol: 'ETH/USDT', price: 2000, timestamp: new Date() }
      ]);

      opportunitySellService.evaluateAndPersist.mockResolvedValue(createOppSellResult());

      // Sell order succeeds
      orderService.placeAlgorithmicOrder.mockResolvedValueOnce({ id: 'sell-order-1' } as any);

      // Re-fetched balance after sells shows insufficient funds (only $10 freed vs $300 needed)
      balanceService.getUserBalances
        .mockResolvedValueOnce({
          current: [{ balances: [{ free: '100', locked: '0', usdValue: 100 }] }]
        } as any)
        .mockResolvedValueOnce({
          current: [{ balances: [{ free: '10', locked: '0', usdValue: 10 }] }]
        } as any);

      const signal: TradingSignal = {
        action: 'buy',
        symbol: 'BTC/USDT',
        quantity: 0.01,
        price: 30000,
        confidence: 0.8
      };
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      await service.executeLiveTrading();

      // Sell was placed but BUY was skipped due to insufficient post-sell balance
      expect(orderService.placeAlgorithmicOrder).toHaveBeenCalledTimes(1);
      expect(orderService.placeAlgorithmicOrder).toHaveBeenCalledWith(
        'user-1',
        'strategy-1',
        expect.objectContaining({ action: 'sell', symbol: 'ETH/USDT' }),
        'ek-1'
      );
    });

    it('logs warning for symbol without / separator (Fix #4)', async () => {
      const warnSpy = jest.spyOn((service as any).logger, 'warn');
      const result = (service as any).extractCoinIdFromSymbol('BTCUSDT');

      expect(result).toBe('BTCUSDT');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unexpected symbol format'));
    });

    it('excludes short positions from opportunity selling position map (Fix #5)', async () => {
      setupSignalPath({
        user: { enableOpportunitySelling: true, opportunitySellingConfig: DEFAULT_OPPORTUNITY_SELLING_CONFIG }
      });
      jest.spyOn<any, any>(service as any, 'fetchMarketData').mockResolvedValue([
        { symbol: 'BTC/USDT', price: 30000, timestamp: new Date() },
        { symbol: 'ETH/USDT', price: 2000, timestamp: new Date() }
      ]);

      // Mix of long and short positions
      positionTracking.getPositions.mockResolvedValue([
        {
          id: 'pos-1',
          symbol: 'ETH/USDT',
          positionSide: 'long',
          quantity: '1.0',
          avgEntryPrice: '1800',
          strategyConfigId: 'strategy-1',
          createdAt: new Date()
        } as any,
        {
          id: 'pos-2',
          symbol: 'ETH/USDT',
          positionSide: 'short',
          quantity: '0.5',
          avgEntryPrice: '2100',
          strategyConfigId: 'strategy-1',
          createdAt: new Date()
        } as any
      ]);

      const signal: TradingSignal = {
        action: 'buy',
        symbol: 'BTC/USDT',
        quantity: 0.01,
        price: 30000,
        confidence: 0.8
      };
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      await service.executeLiveTrading();

      // Verify evaluateAndPersist was called with only long positions in the map
      expect(opportunitySellService.evaluateAndPersist).toHaveBeenCalledWith(
        expect.objectContaining({
          positions: expect.any(Map)
        }),
        'user-1',
        false
      );

      const callArgs = opportunitySellService.evaluateAndPersist.mock.calls[0][0];
      const posMap = callArgs.positions as Map<string, any>;
      // Only 1 long ETH position (qty=1.0), the short (qty=0.5) should be excluded
      expect(posMap.get('ETH')?.quantity).toBe(1.0);
    });

    it('clears cooldowns for orphaned sells on partial sell failure (Fix #6)', async () => {
      setupSignalPath({
        user: { enableOpportunitySelling: true, opportunitySellingConfig: DEFAULT_OPPORTUNITY_SELLING_CONFIG }
      });
      jest.spyOn<any, any>(service as any, 'fetchMarketData').mockResolvedValue([
        { symbol: 'BTC/USDT', price: 30000, timestamp: new Date() },
        { symbol: 'ETH/USDT', price: 2000, timestamp: new Date() },
        { symbol: 'SOL/USDT', price: 100, timestamp: new Date() }
      ]);

      opportunitySellService.evaluateAndPersist.mockResolvedValue(
        createOppSellResult({
          sellOrders: [
            { coinId: 'ETH', quantity: 0.5, currentPrice: 2000, estimatedProceeds: 1000, score: {} as any },
            { coinId: 'SOL', quantity: 5, currentPrice: 100, estimatedProceeds: 500, score: {} as any }
          ],
          reason: 'Selling 2 position(s)',
          projectedProceeds: 1500
        })
      );

      // First sell succeeds, second fails
      orderService.placeAlgorithmicOrder
        .mockResolvedValueOnce({ id: 'sell-order-1' } as any)
        .mockRejectedValueOnce(new Error('Exchange error on SOL'));

      const signal: TradingSignal = {
        action: 'buy',
        symbol: 'BTC/USDT',
        quantity: 0.01,
        price: 30000,
        confidence: 0.8
      };
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      await service.executeLiveTrading();

      // SOL sell failed → its cooldown cleared directly in the catch
      expect(tradeCooldownService.clearCooldown).toHaveBeenCalledWith('user-1', 'SOL/USDT', 'SELL');
      // ETH sell succeeded but is now orphaned → cooldown cleared by cleanupOrphanedSells
      expect(tradeCooldownService.clearCooldown).toHaveBeenCalledWith('user-1', 'ETH/USDT', 'SELL');
      // BUY was never placed
      expect(orderService.placeAlgorithmicOrder).toHaveBeenCalledTimes(2); // 2 sell attempts only
    });

    it('keeps earliest entryDate when merging positions for same coin', async () => {
      setupSignalPath({
        user: { enableOpportunitySelling: true, opportunitySellingConfig: DEFAULT_OPPORTUNITY_SELLING_CONFIG }
      });
      jest.spyOn<any, any>(service as any, 'fetchMarketData').mockResolvedValue([
        { symbol: 'BTC/USDT', price: 30000, timestamp: new Date() },
        { symbol: 'ETH/USDT', price: 2000, timestamp: new Date() }
      ]);

      const earlierDate = new Date('2025-01-01');
      const laterDate = new Date('2025-06-01');

      positionTracking.getPositions.mockResolvedValue([
        {
          id: 'pos-1',
          symbol: 'ETH/USDT',
          positionSide: 'long',
          quantity: '1.0',
          avgEntryPrice: '1800',
          strategyConfigId: 'strategy-1',
          createdAt: laterDate
        } as any,
        {
          id: 'pos-2',
          symbol: 'ETH/USDT',
          positionSide: 'long',
          quantity: '0.5',
          avgEntryPrice: '2000',
          strategyConfigId: 'strategy-1',
          createdAt: earlierDate
        } as any
      ]);

      const signal: TradingSignal = {
        action: 'buy',
        symbol: 'BTC/USDT',
        quantity: 0.01,
        price: 30000,
        confidence: 0.8
      };
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      await service.executeLiveTrading();

      expect(opportunitySellService.evaluateAndPersist).toHaveBeenCalled();
      const callArgs = opportunitySellService.evaluateAndPersist.mock.calls[0][0];
      const posMap = callArgs.positions as Map<string, any>;
      expect(posMap.get('ETH')?.entryDate).toEqual(earlierDate);
    });

    it('uses source position strategyConfigId for position tracking', async () => {
      const strategies = [{ id: 'strategy-A' } as any, { id: 'strategy-B' } as any];
      setupSignalPath({
        user: { enableOpportunitySelling: true, opportunitySellingConfig: DEFAULT_OPPORTUNITY_SELLING_CONFIG },
        strategies
      });
      capitalAllocation.allocateCapitalByKelly.mockResolvedValue(
        new Map([
          ['strategy-A', 25],
          ['strategy-B', 25]
        ])
      );
      jest.spyOn<any, any>(service as any, 'fetchMarketData').mockResolvedValue([
        { symbol: 'BTC/USDT', price: 30000, timestamp: new Date() },
        { symbol: 'ETH/USDT', price: 2000, timestamp: new Date() }
      ]);

      // Position belongs to strategy-A
      positionTracking.getPositions.mockResolvedValue([
        {
          id: 'pos-1',
          symbol: 'ETH/USDT',
          positionSide: 'long',
          quantity: '1.0',
          avgEntryPrice: '1800',
          strategyConfigId: 'strategy-A',
          createdAt: new Date()
        } as any
      ]);

      opportunitySellService.evaluateAndPersist.mockResolvedValue(createOppSellResult());

      // Buy signal comes from strategy-B
      const signal: TradingSignal = {
        action: 'buy',
        symbol: 'BTC/USDT',
        quantity: 0.01,
        price: 30000,
        confidence: 0.8
      };
      // strategy-A returns hold, strategy-B returns the buy signal
      strategyExecutor.executeStrategy
        .mockResolvedValueOnce({ action: 'hold', symbol: 'ETH/USDT', quantity: 0, price: 2000 } as any)
        .mockResolvedValueOnce(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });
      orderService.placeAlgorithmicOrder.mockResolvedValue({ id: 'order-1' } as any);

      balanceService.getUserBalances
        .mockReset()
        .mockResolvedValueOnce({
          current: [{ balances: [{ free: '100', locked: '0', usdValue: 100 }] }]
        } as any)
        .mockResolvedValueOnce({
          current: [{ balances: [{ free: '1100', locked: '0', usdValue: 1100 }] }]
        } as any);

      await service.executeLiveTrading();

      // Position tracking for the sell should use strategy-A (the source), not strategy-B (the buyer)
      expect(positionTracking.updatePosition).toHaveBeenCalledWith(
        'user-1',
        'strategy-A',
        'ETH/USDT',
        0.5,
        2000,
        'sell',
        'long'
      );
    });

    it('refreshes balances for subsequent strategies after opportunity sells', async () => {
      const strategies = [{ id: 'strategy-1' } as any, { id: 'strategy-2' } as any];
      setupSignalPath({
        user: { enableOpportunitySelling: true, opportunitySellingConfig: DEFAULT_OPPORTUNITY_SELLING_CONFIG },
        strategies
      });
      capitalAllocation.allocateCapitalByKelly.mockResolvedValue(
        new Map([
          ['strategy-1', 25],
          ['strategy-2', 25]
        ])
      );
      jest.spyOn<any, any>(service as any, 'fetchMarketData').mockResolvedValue([
        { symbol: 'BTC/USDT', price: 30000, timestamp: new Date() },
        { symbol: 'ETH/USDT', price: 2000, timestamp: new Date() }
      ]);

      positionTracking.getPositions.mockResolvedValue([
        {
          id: 'pos-1',
          symbol: 'ETH/USDT',
          positionSide: 'long',
          quantity: '1.0',
          avgEntryPrice: '1800',
          strategyConfigId: 'strategy-1',
          createdAt: new Date()
        } as any
      ]);

      opportunitySellService.evaluateAndPersist.mockResolvedValue(createOppSellResult());

      const concentrationGateService = (service as any).concentrationGate;

      // Strategy 1 triggers opportunity sell, strategy 2 also triggers buy
      const signal1: TradingSignal = {
        action: 'buy',
        symbol: 'BTC/USDT',
        quantity: 0.01,
        price: 30000,
        confidence: 0.8
      };
      const signal2: TradingSignal = {
        action: 'buy',
        symbol: 'ETH/USDT',
        quantity: 0.1,
        price: 2000,
        confidence: 0.7
      };
      strategyExecutor.executeStrategy.mockResolvedValueOnce(signal1).mockResolvedValueOnce(signal2);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });
      orderService.placeAlgorithmicOrder.mockResolvedValue({ id: 'order-1' } as any);

      // First call: initial balance, second: after sells (refreshed), third: for strategy-2 opp selling check
      balanceService.getUserBalances
        .mockReset()
        .mockResolvedValueOnce({
          current: [{ balances: [{ free: '100', locked: '0', usdValue: 100 }] }]
        } as any)
        .mockResolvedValueOnce({
          current: [{ balances: [{ free: '1100', locked: '0', usdValue: 1100 }] }]
        } as any);

      await service.executeLiveTrading();

      // buildAssetAllocations should have been called at least twice:
      // once at init, once after opportunity sells refreshed balances
      expect(concentrationGateService.buildAssetAllocations).toHaveBeenCalledTimes(2);
      // The second call should use the refreshed balances
      const secondCallArg = concentrationGateService.buildAssetAllocations.mock.calls[1][0];
      expect(secondCallArg).toEqual([{ balances: [{ free: '1100', locked: '0', usdValue: 1100 }] }]);
    });

    it('skips BUY when opportunity sell order execution fails', async () => {
      setupSignalPath({
        user: { enableOpportunitySelling: true, opportunitySellingConfig: DEFAULT_OPPORTUNITY_SELLING_CONFIG }
      });
      jest.spyOn<any, any>(service as any, 'fetchMarketData').mockResolvedValue([
        { symbol: 'BTC/USDT', price: 30000, timestamp: new Date() },
        { symbol: 'ETH/USDT', price: 2000, timestamp: new Date() }
      ]);

      opportunitySellService.evaluateAndPersist.mockResolvedValue(createOppSellResult());

      // First call is the opportunity sell (will fail), second would be the BUY
      orderService.placeAlgorithmicOrder.mockRejectedValueOnce(new Error('Exchange error'));

      const signal: TradingSignal = {
        action: 'buy',
        symbol: 'BTC/USDT',
        quantity: 0.01,
        price: 30000,
        confidence: 0.8
      };
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      await service.executeLiveTrading();

      // Only the failed sell was attempted, BUY was not placed
      expect(orderService.placeAlgorithmicOrder).toHaveBeenCalledTimes(1);
      expect(orderService.placeAlgorithmicOrder).toHaveBeenCalledWith(
        'user-1',
        'strategy-1',
        expect.objectContaining({ action: 'sell', symbol: 'ETH/USDT' }),
        'ek-1'
      );
    });
  });
});
