import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type ObjectLiteral, type Repository } from 'typeorm';

import { SignalReasonCode, SignalStatus } from '@chansey/api-interfaces';

import { CapitalAllocationService } from './capital-allocation.service';
import { ConcentrationGateService } from './concentration-gate.service';
import { DailyLossLimitGateService } from './daily-loss-limit-gate.service';
import { LiveSignalService } from './live-signal.service';
import { LiveTradingService } from './live-trading.service';
import { OpportunitySellingExecutionService } from './opportunity-selling-execution.service';
import { OrderPlacementService, type PlaceOrderResult } from './order-placement.service';
import { PositionTrackingService } from './position-tracking.service';
import { PreTradeRiskGateService } from './pre-trade-risk-gate.service';
import { RiskPoolMappingService } from './risk-pool-mapping.service';
import { StrategyExecutorService, type TradingSignal } from './strategy-executor.service';

import { TradingStateService } from '../admin/trading-state/trading-state.service';
import { BalanceService } from '../balance/balance.service';
import { FailedJobService } from '../failed-jobs/failed-job.service';
import { CompositeRegimeService } from '../market-regime/composite-regime.service';
import { MetricsService } from '../metrics/metrics.service';
import { SignalFilterChainService } from '../order/backtest/shared/filters';
import { LOCK_KEYS } from '../shared/distributed-lock.constants';
import { DistributedLockService } from '../shared/distributed-lock.service';
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

const placedResult: PlaceOrderResult = { status: 'placed', orderId: 'order-1', metadata: {} };
const blockedResult: PlaceOrderResult = {
  status: 'blocked',
  reasonCode: SignalReasonCode.TRADE_COOLDOWN,
  reason: 'cooldown active'
};

describe('LiveTradingService', () => {
  let service: LiveTradingService;
  let userRepo: MockRepo<User>;
  let lockService: jest.Mocked<DistributedLockService>;
  let riskPoolMapping: jest.Mocked<RiskPoolMappingService>;
  let capitalAllocation: jest.Mocked<CapitalAllocationService>;
  let positionTracking: jest.Mocked<PositionTrackingService>;
  let strategyExecutor: jest.Mocked<StrategyExecutorService>;
  let balanceService: jest.Mocked<BalanceService>;
  let tradingStateService: jest.Mocked<TradingStateService>;
  let signalFilterChain: jest.Mocked<SignalFilterChainService>;
  let preTradeRiskGate: jest.Mocked<PreTradeRiskGateService>;
  let dailyLossLimitGate: jest.Mocked<DailyLossLimitGateService>;
  let concentrationGate: jest.Mocked<ConcentrationGateService>;
  let liveSignalService: jest.Mocked<LiveSignalService>;
  let orderPlacement: jest.Mocked<OrderPlacementService>;
  let opportunitySellingExecution: jest.Mocked<OpportunitySellingExecutionService>;
  let failedJobService: jest.Mocked<FailedJobService>;

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
      getPositions: jest.fn()
    } as unknown as jest.Mocked<PositionTrackingService>;

    strategyExecutor = {
      executeStrategy: jest.fn(),
      validateSignal: jest.fn()
    } as unknown as jest.Mocked<StrategyExecutorService>;

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
      isEntryBlocked: jest.fn().mockResolvedValue({ blocked: false })
    } as unknown as jest.Mocked<DailyLossLimitGateService>;

    concentrationGate = {
      buildAssetAllocations: jest.fn().mockReturnValue([]),
      checkTrade: jest.fn().mockReturnValue({ allowed: true })
    } as unknown as jest.Mocked<ConcentrationGateService>;

    liveSignalService = {
      recordFromTradingSignal: jest.fn().mockResolvedValue(undefined)
    } as unknown as jest.Mocked<LiveSignalService>;

    orderPlacement = {
      placeOrder: jest.fn().mockResolvedValue(placedResult)
    } as unknown as jest.Mocked<OrderPlacementService>;

    opportunitySellingExecution = {
      execute: jest.fn().mockResolvedValue({ freed: true }),
      fetchMarketData: jest.fn().mockResolvedValue([])
    } as unknown as jest.Mocked<OpportunitySellingExecutionService>;

    failedJobService = {
      recordFailure: jest.fn()
    } as unknown as jest.Mocked<FailedJobService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiveTradingService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: RiskPoolMappingService, useValue: riskPoolMapping },
        { provide: CapitalAllocationService, useValue: capitalAllocation },
        { provide: PositionTrackingService, useValue: positionTracking },
        { provide: StrategyExecutorService, useValue: strategyExecutor },
        { provide: BalanceService, useValue: balanceService },
        { provide: DistributedLockService, useValue: lockService },
        { provide: TradingStateService, useValue: tradingStateService },
        {
          provide: CompositeRegimeService,
          useValue: {
            getCompositeRegime: jest.fn().mockReturnValue('BULL'),
            isOverrideActive: jest.fn().mockReturnValue(false)
          }
        },
        { provide: SignalFilterChainService, useValue: signalFilterChain },
        { provide: PreTradeRiskGateService, useValue: preTradeRiskGate },
        { provide: DailyLossLimitGateService, useValue: dailyLossLimitGate },
        { provide: ConcentrationGateService, useValue: concentrationGate },
        {
          provide: MetricsService,
          useValue: {
            recordRegimeGateBlock: jest.fn(),
            recordDrawdownGateBlock: jest.fn(),
            recordDailyLossGateBlock: jest.fn(),
            recordConcentrationGateBlock: jest.fn()
          }
        },
        { provide: FailedJobService, useValue: failedJobService },
        { provide: LiveSignalService, useValue: liveSignalService },
        { provide: OrderPlacementService, useValue: orderPlacement },
        { provide: OpportunitySellingExecutionService, useValue: opportunitySellingExecution }
      ]
    }).compile();

    service = module.get(LiveTradingService);
  });

  /** Sets up the common happy path to reach signal execution */
  const setupSignalPath = (opts?: { user?: Record<string, unknown>; strategies?: any[] }): User => {
    lockService.acquire.mockResolvedValue({ acquired: true, lockId: 'lock-1', token: 'lock-1' });
    const user = createUser(opts?.user);
    userRepo.find.mockResolvedValue([user]);
    balanceService.getUserBalances.mockResolvedValue({
      current: [{ balances: [{ free: '100', locked: '0', usdValue: 100 }] }]
    } as any);
    riskPoolMapping.getActiveStrategiesForUser.mockResolvedValue(opts?.strategies ?? [{ id: 'strategy-1' } as any]);
    capitalAllocation.allocateCapitalByKelly.mockResolvedValue(new Map([['strategy-1', 50]]));
    positionTracking.getPositions.mockResolvedValue([]);
    return user;
  };

  describe('executeLiveTrading — early exits', () => {
    it('returns early when trading is globally disabled', async () => {
      tradingStateService.isTradingEnabled.mockReturnValue(false);

      await service.executeLiveTrading();

      expect(lockService.acquire).not.toHaveBeenCalled();
    });

    it('skips execution when lock is not acquired', async () => {
      lockService.acquire.mockResolvedValue({ acquired: false, lockId: null, token: null });

      await service.executeLiveTrading();

      expect(userRepo.find).not.toHaveBeenCalled();
      expect(lockService.release).not.toHaveBeenCalled();
    });

    it('skips user with zero capital allocation percentage', async () => {
      setupSignalPath({ user: { algoCapitalAllocationPercentage: 0 } });

      await service.executeLiveTrading();

      expect(riskPoolMapping.getActiveStrategiesForUser).not.toHaveBeenCalled();
    });

    it('skips user with no free balance and opportunity selling disabled', async () => {
      setupSignalPath({ user: { enableOpportunitySelling: false } });
      balanceService.getUserBalances.mockResolvedValue({
        current: [{ balances: [{ free: '0', locked: '0', usdValue: 0 }] }]
      } as any);

      await service.executeLiveTrading();

      expect(riskPoolMapping.getActiveStrategiesForUser).not.toHaveBeenCalled();
    });

    it('allows strategy execution with zero free balance when opportunity selling is enabled', async () => {
      setupSignalPath({ user: { enableOpportunitySelling: true } });
      balanceService.getUserBalances.mockResolvedValue({
        current: [{ balances: [{ free: '0', locked: '500', usdValue: 500 }] }]
      } as any);

      await service.executeLiveTrading();

      expect(strategyExecutor.executeStrategy).toHaveBeenCalled();
    });
  });

  describe('signal gating', () => {
    it('skips invalid signals without placing orders', async () => {
      setupSignalPath();
      const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: false, reason: 'low confidence' });

      await service.executeLiveTrading();

      expect(orderPlacement.placeOrder).not.toHaveBeenCalled();
      expect(liveSignalService.recordFromTradingSignal).toHaveBeenCalledWith(
        'user-1',
        'strategy-1',
        expect.anything(),
        SignalStatus.BLOCKED,
        expect.objectContaining({ reasonCode: SignalReasonCode.SIGNAL_VALIDATION_FAILED })
      );
    });

    it('skips BUY when long position already exists for symbol', async () => {
      setupSignalPath();
      positionTracking.getPositions.mockResolvedValue([
        { symbol: 'BTC/USDT', positionSide: 'long', quantity: '0.01', strategyConfigId: 'strategy-1' } as any
      ]);
      const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      await service.executeLiveTrading();

      expect(orderPlacement.placeOrder).not.toHaveBeenCalled();
    });

    it('blocks entry signal when daily loss limit gate is breached', async () => {
      setupSignalPath();
      dailyLossLimitGate.isEntryBlocked.mockResolvedValue({ blocked: true, reason: 'daily loss exceeded' } as any);
      const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      await service.executeLiveTrading();

      expect(orderPlacement.placeOrder).not.toHaveBeenCalled();
      expect(liveSignalService.recordFromTradingSignal).toHaveBeenCalledWith(
        'user-1',
        'strategy-1',
        expect.anything(),
        SignalStatus.BLOCKED,
        expect.objectContaining({ reasonCode: SignalReasonCode.DAILY_LOSS_LIMIT })
      );
    });

    it('does not block sell signals when daily loss limit is breached', async () => {
      setupSignalPath();
      dailyLossLimitGate.isEntryBlocked.mockResolvedValue({ blocked: true, reason: 'daily loss exceeded' } as any);
      const signal: TradingSignal = { action: 'sell', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      await service.executeLiveTrading();

      expect(orderPlacement.placeOrder).toHaveBeenCalled();
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

      expect(orderPlacement.placeOrder).not.toHaveBeenCalled();
      expect(liveSignalService.recordFromTradingSignal).toHaveBeenCalledWith(
        'user-1',
        'strategy-1',
        expect.anything(),
        SignalStatus.BLOCKED,
        expect.objectContaining({ reasonCode: SignalReasonCode.REGIME_GATE })
      );
    });

    it('passes override flag and risk level through to signal filter chain', async () => {
      setupSignalPath({ user: { effectiveCalculationRiskLevel: 5, coinRisk: { level: 5 } as any } });
      const compositeRegimeService = (service as any).compositeRegimeService;
      compositeRegimeService.isOverrideActive.mockReturnValue(true);
      const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      await service.executeLiveTrading();

      expect(signalFilterChain.apply).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tradingContext: 'live',
          overrideActive: true,
          riskLevel: 5,
          regimeGateEnabled: true
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

      expect(orderPlacement.placeOrder).not.toHaveBeenCalled();
      expect(liveSignalService.recordFromTradingSignal).toHaveBeenCalledWith(
        'user-1',
        'strategy-1',
        expect.anything(),
        SignalStatus.BLOCKED,
        expect.objectContaining({ reasonCode: SignalReasonCode.DRAWDOWN_GATE })
      );
    });

    it('blocks entry when concentration gate rejects', async () => {
      setupSignalPath();
      concentrationGate.checkTrade.mockReturnValue({ allowed: false, reason: 'concentration too high' });
      const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      await service.executeLiveTrading();

      expect(orderPlacement.placeOrder).not.toHaveBeenCalled();
      expect(liveSignalService.recordFromTradingSignal).toHaveBeenCalledWith(
        'user-1',
        'strategy-1',
        expect.anything(),
        SignalStatus.BLOCKED,
        expect.objectContaining({ reasonCode: SignalReasonCode.CONCENTRATION_LIMIT })
      );
    });

    it('reduces signal quantity when concentration gate applies adjustment', async () => {
      setupSignalPath();
      concentrationGate.checkTrade.mockReturnValue({ allowed: true, adjustedQuantity: 0.5 });
      const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      await service.executeLiveTrading();

      expect(orderPlacement.placeOrder).toHaveBeenCalledWith(
        expect.anything(),
        'strategy-1',
        expect.objectContaining({ quantity: 0.005 }),
        expect.anything()
      );
    });

    it('does nothing for hold signals', async () => {
      setupSignalPath();
      strategyExecutor.executeStrategy.mockResolvedValue({
        action: 'hold',
        symbol: 'BTC/USDT',
        quantity: 0,
        price: 30000
      } as any);

      await service.executeLiveTrading();

      expect(orderPlacement.placeOrder).not.toHaveBeenCalled();
      expect(liveSignalService.recordFromTradingSignal).not.toHaveBeenCalled();
    });
  });

  describe('opportunity selling integration', () => {
    it('triggers opportunity selling when buy amount exceeds available cash', async () => {
      setupSignalPath({ user: { enableOpportunitySelling: true } });
      const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      await service.executeLiveTrading();

      // Buy amount ($300) > available cash ($100) → triggers opp selling
      expect(opportunitySellingExecution.execute).toHaveBeenCalledWith(
        expect.anything(),
        signal,
        'strategy-1',
        'BULL',
        [],
        expect.anything(),
        300,
        100
      );
    });

    it('does not trigger opportunity selling when BUY has sufficient funds', async () => {
      setupSignalPath({ user: { enableOpportunitySelling: true } });
      const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.001, price: 30000 } as any;
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      await service.executeLiveTrading();

      expect(opportunitySellingExecution.execute).not.toHaveBeenCalled();
    });

    it('does not trigger opportunity selling when disabled', async () => {
      setupSignalPath({ user: { enableOpportunitySelling: false } });
      const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      await service.executeLiveTrading();

      expect(opportunitySellingExecution.execute).not.toHaveBeenCalled();
      expect(orderPlacement.placeOrder).toHaveBeenCalled();
    });

    it('blocks BUY when opportunity selling fails to free capital', async () => {
      setupSignalPath({ user: { enableOpportunitySelling: true } });
      opportunitySellingExecution.execute.mockResolvedValue({ freed: false, reason: 'low confidence' });
      const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      await service.executeLiveTrading();

      expect(orderPlacement.placeOrder).not.toHaveBeenCalled();
      expect(liveSignalService.recordFromTradingSignal).toHaveBeenCalledWith(
        'user-1',
        'strategy-1',
        expect.anything(),
        SignalStatus.BLOCKED,
        expect.objectContaining({ reasonCode: SignalReasonCode.OPPORTUNITY_SELLING_REJECTED })
      );
    });

    it('skips buy when balance re-verification shows insufficient funds after sells', async () => {
      setupSignalPath({ user: { enableOpportunitySelling: true } });
      opportunitySellingExecution.execute.mockResolvedValue({ freed: true });
      // After opp sells, re-fetched balance is still insufficient
      balanceService.getUserBalances
        .mockReset()
        .mockResolvedValueOnce({ current: [{ balances: [{ free: '100', locked: '0', usdValue: 100 }] }] } as any)
        .mockResolvedValueOnce({ current: [{ balances: [{ free: '10', locked: '0', usdValue: 10 }] }] } as any);
      const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      await service.executeLiveTrading();

      expect(orderPlacement.placeOrder).not.toHaveBeenCalled();
      expect(liveSignalService.recordFromTradingSignal).toHaveBeenCalledWith(
        'user-1',
        'strategy-1',
        expect.anything(),
        SignalStatus.BLOCKED,
        expect.objectContaining({ reasonCode: SignalReasonCode.INSUFFICIENT_FUNDS })
      );
    });

    it('refreshes balances and asset allocations after opportunity sells', async () => {
      const strategies = [{ id: 'strategy-1' } as any, { id: 'strategy-2' } as any];
      setupSignalPath({ user: { enableOpportunitySelling: true }, strategies });
      capitalAllocation.allocateCapitalByKelly.mockResolvedValue(
        new Map([
          ['strategy-1', 25],
          ['strategy-2', 25]
        ])
      );

      const signal1: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
      const signal2: TradingSignal = { action: 'buy', symbol: 'ETH/USDT', quantity: 0.1, price: 2000 } as any;
      strategyExecutor.executeStrategy.mockResolvedValueOnce(signal1).mockResolvedValueOnce(signal2);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      balanceService.getUserBalances
        .mockReset()
        .mockResolvedValueOnce({ current: [{ balances: [{ free: '100', locked: '0', usdValue: 100 }] }] } as any)
        .mockResolvedValueOnce({ current: [{ balances: [{ free: '1100', locked: '0', usdValue: 1100 }] }] } as any);

      await service.executeLiveTrading();

      // buildAssetAllocations called at init + after opp sell balance refresh
      expect(concentrationGate.buildAssetAllocations).toHaveBeenCalledTimes(2);
      const secondCallArg = concentrationGate.buildAssetAllocations.mock.calls[1][0];
      expect(secondCallArg).toEqual([{ balances: [{ free: '1100', locked: '0', usdValue: 1100 }] }]);
    });

    it('does not trigger opportunity selling for SELL signals', async () => {
      setupSignalPath({ user: { enableOpportunitySelling: true } });
      const signal: TradingSignal = { action: 'sell', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      await service.executeLiveTrading();

      expect(opportunitySellingExecution.execute).not.toHaveBeenCalled();
    });
  });

  describe('order placement and signal recording', () => {
    it('records PLACED outcome on successful order', async () => {
      setupSignalPath();
      const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      await service.executeLiveTrading();

      expect(orderPlacement.placeOrder).toHaveBeenCalled();
      expect(liveSignalService.recordFromTradingSignal).toHaveBeenCalledWith(
        'user-1',
        'strategy-1',
        expect.anything(),
        SignalStatus.PLACED,
        expect.objectContaining({ orderId: 'order-1' })
      );
    });

    it('records BLOCKED outcome when order placement returns blocked', async () => {
      setupSignalPath();
      orderPlacement.placeOrder.mockResolvedValue(blockedResult);
      const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      await service.executeLiveTrading();

      expect(liveSignalService.recordFromTradingSignal).toHaveBeenCalledWith(
        'user-1',
        'strategy-1',
        expect.anything(),
        SignalStatus.BLOCKED,
        expect.objectContaining({ reasonCode: SignalReasonCode.TRADE_COOLDOWN })
      );
    });

    it('records concentration-reduced reason when quantity is adjusted', async () => {
      setupSignalPath();
      concentrationGate.checkTrade.mockReturnValue({
        allowed: true,
        adjustedQuantity: 0.5,
        reason: 'reduced for concentration'
      });
      const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      await service.executeLiveTrading();

      expect(liveSignalService.recordFromTradingSignal).toHaveBeenCalledWith(
        'user-1',
        'strategy-1',
        expect.anything(),
        SignalStatus.PLACED,
        expect.objectContaining({ reasonCode: SignalReasonCode.CONCENTRATION_REDUCED })
      );
    });

    it('does not propagate recordFromTradingSignal rejection', async () => {
      setupSignalPath();
      const signal: TradingSignal = { action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any;
      strategyExecutor.executeStrategy.mockResolvedValue(signal);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });
      liveSignalService.recordFromTradingSignal.mockRejectedValue(new Error('DB write failed'));

      await expect(service.executeLiveTrading()).resolves.not.toThrow();
      expect(orderPlacement.placeOrder).toHaveBeenCalled();
    });
  });

  describe('error handling and resilience', () => {
    it('disables user after three consecutive errors', async () => {
      lockService.acquire.mockResolvedValue({ acquired: true, lockId: 'lock-1', token: 'lock-1' });
      const user = createUser();
      userRepo.find.mockResolvedValue([user]);
      balanceService.getUserBalances.mockRejectedValue(new Error('Balance fetch failed'));

      await service.executeLiveTrading();
      await service.executeLiveTrading();
      await service.executeLiveTrading();

      expect(userRepo.save).toHaveBeenCalledWith(expect.objectContaining({ algoTradingEnabled: false }));
    });

    it('resets error strikes after successful execution', async () => {
      lockService.acquire.mockResolvedValue({ acquired: true, lockId: 'lock-1', token: 'lock-1' });
      const user = createUser();
      userRepo.find.mockResolvedValue([user]);

      // Two failures
      balanceService.getUserBalances.mockRejectedValue(new Error('fail'));
      await service.executeLiveTrading();
      await service.executeLiveTrading();

      // One success resets strikes
      balanceService.getUserBalances.mockResolvedValue({
        current: [{ balances: [{ free: '100', locked: '0', usdValue: 100 }] }]
      } as any);
      riskPoolMapping.getActiveStrategiesForUser.mockResolvedValue([]);
      await service.executeLiveTrading();

      // Another failure should NOT disable (strikes reset)
      balanceService.getUserBalances.mockRejectedValue(new Error('fail again'));
      await service.executeLiveTrading();

      expect(userRepo.save).not.toHaveBeenCalled();
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

      strategyExecutor.executeStrategy
        .mockRejectedValueOnce(new Error('Strategy 1 blew up'))
        .mockResolvedValueOnce({ action: 'buy', symbol: 'BTC/USDT', quantity: 0.01, price: 30000 } as any);
      strategyExecutor.validateSignal.mockReturnValue({ valid: true });

      await service.executeLiveTrading();

      expect(strategyExecutor.executeStrategy).toHaveBeenCalledTimes(2);
      expect(orderPlacement.placeOrder).toHaveBeenCalledTimes(1);
    });

    it('records strategy failure in failed jobs', async () => {
      const strategies = [{ id: 'strategy-1' } as any];
      setupSignalPath({ strategies });
      strategyExecutor.executeStrategy.mockRejectedValue(new Error('boom'));

      await service.executeLiveTrading();

      expect(failedJobService.recordFailure).toHaveBeenCalledWith(
        expect.objectContaining({ queueName: 'live-trading-cron', jobName: 'executeStrategy' })
      );
    });

    it('releases lock even when cycle-level error occurs', async () => {
      lockService.acquire.mockResolvedValue({ acquired: true, lockId: 'lock-1', token: 'lock-1' });
      userRepo.find.mockRejectedValue(new Error('DB connection lost'));

      await service.executeLiveTrading();

      expect(lockService.release).toHaveBeenCalledWith(LOCK_KEYS.LIVE_TRADING, 'lock-1');
    });
  });

  describe('getStatus', () => {
    it('returns status with lock info and enrolled count', async () => {
      lockService.getLockInfo.mockResolvedValue({ exists: true, lockId: 'instance-1', ttlMs: 1000 });
      userRepo.count.mockResolvedValue(5 as any);

      const result = await service.getStatus();

      expect(result).toEqual({ running: true, enrolledUsers: 5, instanceId: 'instance-1' });
    });
  });

  describe('onApplicationShutdown', () => {
    it('releases lock on shutdown when held', async () => {
      (service as any).currentLockToken = 'shutdown-lock';

      await service.onApplicationShutdown('SIGTERM');

      expect(lockService.release).toHaveBeenCalledWith(LOCK_KEYS.LIVE_TRADING, 'shutdown-lock');
    });

    it('does not release lock on shutdown when none is held', async () => {
      await service.onApplicationShutdown('SIGTERM');

      expect(lockService.release).not.toHaveBeenCalled();
    });
  });
});
