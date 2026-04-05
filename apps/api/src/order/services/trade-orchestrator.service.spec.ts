import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { SignalReasonCode, SignalStatus } from '@chansey/api-interfaces';

import { TradeExecutionService } from './trade-execution.service';
import { TradeOrchestratorService } from './trade-orchestrator.service';
import { TradeSignalGeneratorService } from './trade-signal-generator.service';

import { AlgorithmActivationService } from '../../algorithm/services/algorithm-activation.service';
import { BalanceService } from '../../balance/balance.service';
import { FailedJobService } from '../../failed-jobs/failed-job.service';
import { ConcentrationGateService } from '../../strategy/concentration-gate.service';
import { DailyLossLimitGateService } from '../../strategy/daily-loss-limit-gate.service';
import { LiveSignalService } from '../../strategy/live-signal.service';
import { EntryGateService } from '../../strategy/services/entry-gate.service';
import { User } from '../../users/users.entity';
import { UsersService } from '../../users/users.service';

describe('TradeOrchestratorService', () => {
  let service: TradeOrchestratorService;
  let mockUserRepo: any;
  let mockTradeSignalGenerator: any;
  let mockEntryGate: any;
  let mockTradeExecutionService: any;
  let mockActivationService: any;
  let mockBalanceService: any;
  let mockUsersService: any;
  let mockConcentrationGate: any;
  let mockDailyLossLimitGate: any;
  let mockFailedJobService: any;
  let mockLiveSignalService: any;

  const buildActivation = (overrides: Partial<Record<string, unknown>> = {}) =>
    ({
      id: 'activation-1',
      userId: 'user-1',
      algorithmId: 'algo-1',
      allocationPercentage: 5,
      algorithm: { id: 'algo-1', name: 'Test Algorithm' },
      ...overrides
    }) as any;

  const buildSignal = (overrides: Partial<Record<string, unknown>> = {}) => ({
    algorithmActivationId: 'activation-1',
    userId: 'user-1',
    exchangeKeyId: 'key-1',
    action: 'BUY',
    symbol: 'BTC/USDT',
    quantity: 0,
    confidence: 0.8,
    autoSize: true,
    portfolioValue: 10000,
    allocationPercentage: 5,
    ...overrides
  });

  beforeEach(async () => {
    mockUserRepo = { find: jest.fn().mockResolvedValue([]) };
    mockTradeSignalGenerator = {
      generateTradeSignal: jest.fn().mockResolvedValue({ signal: null }),
      pruneThrottleStates: jest.fn()
    };
    mockEntryGate = {
      checkEntryGates: jest.fn().mockResolvedValue({ allowed: true }),
      clearCooldownOnFailure: jest.fn().mockResolvedValue(undefined)
    };
    mockTradeExecutionService = {
      executeTradeSignal: jest.fn().mockResolvedValue({ id: 'order-1', quantity: 0.1 })
    };
    mockActivationService = {
      findAllActiveAlgorithms: jest.fn().mockResolvedValue([])
    };
    mockBalanceService = {
      getUserBalances: jest.fn().mockResolvedValue({ totalUsdValue: 10000, current: [] })
    };
    mockUsersService = {
      getById: jest.fn().mockResolvedValue({ id: 'user-1', effectiveCalculationRiskLevel: 3 })
    };
    mockConcentrationGate = {
      buildAssetAllocations: jest.fn().mockReturnValue([])
    };
    mockDailyLossLimitGate = {
      isEntryBlocked: jest.fn().mockResolvedValue({ blocked: false })
    };
    mockFailedJobService = { recordFailure: jest.fn() };
    mockLiveSignalService = { recordOutcome: jest.fn().mockResolvedValue({ id: 'sig-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeOrchestratorService,
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: TradeSignalGeneratorService, useValue: mockTradeSignalGenerator },
        { provide: EntryGateService, useValue: mockEntryGate },
        { provide: TradeExecutionService, useValue: mockTradeExecutionService },
        { provide: AlgorithmActivationService, useValue: mockActivationService },
        { provide: BalanceService, useValue: mockBalanceService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: ConcentrationGateService, useValue: mockConcentrationGate },
        { provide: DailyLossLimitGateService, useValue: mockDailyLossLimitGate },
        { provide: FailedJobService, useValue: mockFailedJobService },
        { provide: LiveSignalService, useValue: mockLiveSignalService }
      ]
    }).compile();

    service = module.get<TradeOrchestratorService>(TradeOrchestratorService);

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('executeTrades', () => {
    it('should return zero counts when no activations exist', async () => {
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([]);

      const result = await service.executeTrades();

      expect(result).toEqual({
        totalActivations: 0,
        successCount: 0,
        failCount: 0,
        skippedCount: 0,
        blockedCount: 0,
        timestamp: expect.any(String)
      });
    });

    it('should exclude robo-advisor users from processing', async () => {
      const activation1 = buildActivation({ id: 'act-1', userId: 'robo-user' });
      const activation2 = buildActivation({ id: 'act-2', userId: 'manual-user' });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation1, activation2]);
      mockUserRepo.find.mockResolvedValue([{ id: 'robo-user' }]);

      const result = await service.executeTrades();

      expect(result.totalActivations).toBe(1);
    });

    it('should fetch portfolio data once per unique user', async () => {
      const activation1 = buildActivation({ id: 'act-1', userId: 'user-1' });
      const activation2 = buildActivation({ id: 'act-2', userId: 'user-1' });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation1, activation2]);

      await service.executeTrades();

      expect(mockUsersService.getById).toHaveBeenCalledTimes(1);
      expect(mockBalanceService.getUserBalances).toHaveBeenCalledTimes(1);
    });

    it('should invoke progress callback at start, during, and end', async () => {
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([buildActivation()]);
      const progress: number[] = [];

      await service.executeTrades(async (pct) => {
        progress.push(pct);
      });

      expect(progress[0]).toBe(10);
      expect(progress[progress.length - 1]).toBe(100);
      expect(progress.length).toBeGreaterThanOrEqual(3);
    });

    it('should continue processing remaining activations after one fails', async () => {
      const activation1 = buildActivation({ id: 'act-1' });
      const activation2 = buildActivation({ id: 'act-2' });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation1, activation2]);

      mockTradeSignalGenerator.generateTradeSignal.mockImplementation(async (act: any) => {
        if (act.id === 'act-1') throw new Error('algo failure');
        return { signal: null };
      });

      const result = await service.executeTrades();

      expect(result.failCount).toBe(1);
      expect(result.skippedCount).toBe(1);
    });

    it('should record failure details via FailedJobService on activation error', async () => {
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([buildActivation({ id: 'act-err' })]);
      mockTradeSignalGenerator.generateTradeSignal.mockRejectedValue(new Error('algo crash'));

      await service.executeTrades();

      expect(mockFailedJobService.recordFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          queueName: 'trade-execution',
          jobId: 'activation:act-err',
          jobName: 'processActivation',
          errorMessage: 'algo crash'
        })
      );
    });

    it('should prune throttle states with active activation IDs', async () => {
      const act1 = buildActivation({ id: 'act-1' });
      const act2 = buildActivation({ id: 'act-2', userId: 'user-2' });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([act1, act2]);
      mockUsersService.getById.mockImplementation(async (id: string) => ({
        id,
        effectiveCalculationRiskLevel: 3
      }));

      await service.executeTrades();

      expect(mockTradeSignalGenerator.pruneThrottleStates).toHaveBeenCalledWith(new Set(['act-1', 'act-2']));
    });
  });

  describe('processActivation (via executeTrades)', () => {
    it('should skip when user lookup throws', async () => {
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([buildActivation()]);
      mockUsersService.getById.mockRejectedValue(new Error('User not found'));

      const result = await service.executeTrades();

      expect(result.skippedCount).toBe(1);
      expect(mockTradeSignalGenerator.generateTradeSignal).not.toHaveBeenCalled();
    });

    it('should skip when portfolio value is 0', async () => {
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([buildActivation()]);
      mockBalanceService.getUserBalances.mockResolvedValue({ totalUsdValue: 0, current: [] });

      const result = await service.executeTrades();

      expect(result.skippedCount).toBe(1);
      expect(mockTradeSignalGenerator.generateTradeSignal).not.toHaveBeenCalled();
    });

    it('should execute trade and record PLACED outcome when signal and gates pass', async () => {
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([buildActivation()]);
      mockTradeSignalGenerator.generateTradeSignal.mockResolvedValue({ signal: buildSignal() });

      const result = await service.executeTrades();

      expect(result.successCount).toBe(1);
      expect(mockTradeExecutionService.executeTradeSignal).toHaveBeenCalled();
      expect(mockLiveSignalService.recordOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ status: SignalStatus.PLACED, orderId: 'order-1' })
      );
    });

    it('should block and record BLOCKED outcome when entry gate rejects', async () => {
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([buildActivation()]);
      mockTradeSignalGenerator.generateTradeSignal.mockResolvedValue({ signal: buildSignal() });
      mockEntryGate.checkEntryGates.mockResolvedValue({
        allowed: false,
        reasonCode: SignalReasonCode.TRADE_COOLDOWN,
        reason: 'Cooldown active'
      });

      const result = await service.executeTrades();

      expect(result.blockedCount).toBe(1);
      expect(mockTradeExecutionService.executeTradeSignal).not.toHaveBeenCalled();
      expect(mockLiveSignalService.recordOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          status: SignalStatus.BLOCKED,
          reasonCode: SignalReasonCode.TRADE_COOLDOWN
        })
      );
    });

    it('should clear cooldown and record FAILED outcome on trade execution failure', async () => {
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([buildActivation()]);
      mockTradeSignalGenerator.generateTradeSignal.mockResolvedValue({ signal: buildSignal() });
      mockTradeExecutionService.executeTradeSignal.mockRejectedValue(new Error('Exchange error'));

      const result = await service.executeTrades();

      expect(result.failCount).toBe(1);
      expect(mockEntryGate.clearCooldownOnFailure).toHaveBeenCalledWith('user-1', 'BTC/USDT', 'BUY');
      expect(mockLiveSignalService.recordOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          status: SignalStatus.FAILED,
          reasonCode: SignalReasonCode.ORDER_EXECUTION_FAILED
        })
      );
    });

    it('should record BLOCKED outcome when signal skipped with skipReason', async () => {
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([buildActivation()]);
      mockTradeSignalGenerator.generateTradeSignal.mockResolvedValue({
        signal: null,
        skipReason: {
          reasonCode: SignalReasonCode.SIGNAL_THROTTLED,
          reason: 'Confidence too low',
          partialSignal: { action: 'BUY', symbol: 'ETH/USDT', confidence: 0.4 }
        }
      });

      const result = await service.executeTrades();

      expect(result.blockedCount).toBe(1);
      expect(mockLiveSignalService.recordOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          status: SignalStatus.BLOCKED,
          reasonCode: SignalReasonCode.SIGNAL_THROTTLED,
          symbol: 'ETH/USDT',
          quantity: 0
        })
      );
    });
  });

  describe('daily loss limit — user preflight', () => {
    it('should propagate isDailyLossBlocked to entry gates', async () => {
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([buildActivation()]);
      mockDailyLossLimitGate.isEntryBlocked.mockResolvedValue({
        blocked: true,
        reason: 'Daily loss limit exceeded'
      });
      mockTradeSignalGenerator.generateTradeSignal.mockResolvedValue({ signal: buildSignal() });

      await service.executeTrades();

      expect(mockEntryGate.checkEntryGates).toHaveBeenCalledWith(expect.objectContaining({ isDailyLossBlocked: true }));
    });

    it('should mark user as daily-loss-blocked when preflight fails', async () => {
      const act1 = buildActivation({ id: 'act-1' });
      const act2 = buildActivation({ id: 'act-2' });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([act1, act2]);
      mockUsersService.getById.mockRejectedValue(new Error('DB timeout'));

      const result = await service.executeTrades();

      expect(result.skippedCount).toBe(2);
      expect(mockTradeExecutionService.executeTradeSignal).not.toHaveBeenCalled();
    });
  });

  describe('recordOutcome resilience', () => {
    it('should not crash and still count success when recordOutcome rejects', async () => {
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([buildActivation()]);
      mockTradeSignalGenerator.generateTradeSignal.mockResolvedValue({ signal: buildSignal() });
      mockLiveSignalService.recordOutcome.mockRejectedValue(new Error('DB write failed'));

      const result = await service.executeTrades();

      expect(result.successCount).toBe(1);
      expect(result.failCount).toBe(0);
    });
  });
});
