import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { MarketType } from '@chansey/api-interfaces';

import { TradeExecutionTask } from './trade-execution.task';

import { TradingStateService } from '../../admin/trading-state/trading-state.service';
import { SignalType } from '../../algorithm/interfaces';
import { AlgorithmRegistry } from '../../algorithm/registry/algorithm-registry.service';
import { AlgorithmActivationService } from '../../algorithm/services/algorithm-activation.service';
import { AlgorithmContextBuilder } from '../../algorithm/services/algorithm-context-builder.service';
import { BalanceService } from '../../balance/balance.service';
import { CoinService } from '../../coin/coin.service';
import { MetricsService } from '../../metrics/metrics.service';
import { TradeCooldownService } from '../../shared/trade-cooldown.service';
import { DailyLossLimitGateService } from '../../strategy/daily-loss-limit-gate.service';
import { StrategyConfig } from '../../strategy/entities/strategy-config.entity';
import { User } from '../../users/users.entity';
import { UsersService } from '../../users/users.service';
import { SignalThrottleService } from '../backtest/shared/throttle';
import { TradeExecutionService } from '../services/trade-execution.service';

describe('TradeExecutionTask', () => {
  let task: TradeExecutionTask;
  let mockQueue: any;
  let mockStrategyConfigRepo: any;
  let mockUserRepo: any;
  let mockTradeExecutionService: any;
  let mockActivationService: any;
  let mockAlgorithmRegistry: any;
  let mockContextBuilder: any;
  let mockBalanceService: any;
  let mockCoinService: any;
  let mockUsersService: any;
  let mockTradingStateService: any;
  let mockTradeCooldownService: any;
  let mockSignalThrottle: any;
  let mockDailyLossLimitGate: any;
  let mockMetricsService: any;

  const mockJob = {
    id: 'job-1',
    name: 'execute-trades',
    updateProgress: jest.fn()
  } as any;

  const buildActivation = (overrides: Partial<any> = {}) =>
    ({
      id: 'activation-1',
      userId: 'user-1',
      algorithmId: 'algo-1',
      exchangeKeyId: 'key-1',
      allocationPercentage: 5,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      algorithm: {
        id: 'algo-1',
        name: 'Test Algorithm',
        strategyId: 'strategy-1',
        service: null
      },
      exchangeKey: {
        exchange: { slug: 'binance_us' }
      },
      user: { id: 'user-1' },
      activate: jest.fn(),
      deactivate: jest.fn(),
      updateAllocation: jest.fn(),
      ...overrides
    }) as any;

  /** Helper: configure mocks so a single activation produces an actionable BUY signal */
  const configureActionableSignal = (
    coinId = 'coin-1',
    signalType: SignalType = SignalType.BUY,
    strength = 0.8,
    confidence = 0.8
  ) => {
    mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [{ type: signalType, coinId, strength, confidence, reason: 'test' }],
      timestamp: new Date()
    });
  };

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn(),
      getRepeatableJobs: jest.fn().mockResolvedValue([])
    };

    mockStrategyConfigRepo = {
      findOne: jest.fn().mockResolvedValue(null)
    };

    mockUserRepo = {
      find: jest.fn().mockResolvedValue([])
    };

    mockTradingStateService = {
      isTradingEnabled: jest.fn().mockReturnValue(true)
    };

    mockTradeCooldownService = {
      checkAndClaim: jest.fn().mockResolvedValue({ allowed: true }),
      clearCooldown: jest.fn().mockResolvedValue(undefined)
    };

    mockSignalThrottle = {
      createState: jest.fn().mockReturnValue({ lastSignalTime: {}, tradeTimestamps: [] }),
      resolveConfig: jest.fn().mockReturnValue({ cooldownMs: 86_400_000, maxTradesPerDay: 6, minSellPercent: 0.5 }),
      filterSignals: jest.fn().mockImplementation((signals: any[]) => signals),
      toThrottleSignal: jest.fn().mockImplementation((s: any) => {
        const map: Record<string, string> = {
          BUY: 'BUY',
          SELL: 'SELL',
          HOLD: 'HOLD',
          SHORT_ENTRY: 'OPEN_SHORT',
          SHORT_EXIT: 'CLOSE_SHORT',
          STOP_LOSS: 'SELL',
          TAKE_PROFIT: 'SELL'
        };
        return {
          action: map[s.type] ?? 'HOLD',
          coinId: s.coinId,
          quantity: s.quantity,
          reason: s.reason,
          confidence: s.confidence,
          originalType: s.type
        };
      })
    };

    mockTradeExecutionService = {
      executeTradeSignal: jest.fn().mockResolvedValue({ id: 'order-1' })
    };

    mockActivationService = {
      findAllActiveAlgorithms: jest.fn().mockResolvedValue([])
    };

    mockAlgorithmRegistry = {
      executeAlgorithm: jest.fn()
    };

    mockContextBuilder = {
      buildContext: jest.fn().mockResolvedValue({
        coins: [{ id: 'coin-1', symbol: 'BTC' }],
        priceData: { 'coin-1': [{ close: 50000 }] },
        timestamp: new Date(),
        config: {}
      }),
      validateContext: jest.fn().mockReturnValue(true)
    };

    mockBalanceService = {
      getUserBalances: jest.fn().mockResolvedValue({ totalUsdValue: 10000 })
    };

    mockCoinService = {
      getCoinById: jest.fn().mockResolvedValue({ id: 'coin-1', symbol: 'BTC' })
    };

    mockUsersService = {
      getById: jest.fn().mockResolvedValue({ id: 'user-1' })
    };

    mockDailyLossLimitGate = {
      isEntryBlocked: jest.fn().mockResolvedValue({ blocked: false })
    };

    mockMetricsService = {
      recordDailyLossGateBlock: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeExecutionTask,
        { provide: getQueueToken('trade-execution'), useValue: mockQueue },
        { provide: getRepositoryToken(StrategyConfig), useValue: mockStrategyConfigRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: TradeExecutionService, useValue: mockTradeExecutionService },
        { provide: AlgorithmActivationService, useValue: mockActivationService },
        { provide: AlgorithmRegistry, useValue: mockAlgorithmRegistry },
        { provide: AlgorithmContextBuilder, useValue: mockContextBuilder },
        { provide: BalanceService, useValue: mockBalanceService },
        { provide: CoinService, useValue: mockCoinService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: TradingStateService, useValue: mockTradingStateService },
        { provide: TradeCooldownService, useValue: mockTradeCooldownService },
        { provide: SignalThrottleService, useValue: mockSignalThrottle },
        { provide: DailyLossLimitGateService, useValue: mockDailyLossLimitGate },
        { provide: MetricsService, useValue: mockMetricsService }
      ]
    }).compile();

    task = module.get<TradeExecutionTask>(TradeExecutionTask);

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('process() — unknown job type', () => {
    it('should return failure for unknown job type', async () => {
      const result: any = await task.process({ ...mockJob, name: 'unknown-job' } as any);
      expect(result).toEqual({ success: false, message: 'Unknown job type: unknown-job' });
    });
  });

  describe('signal generation (via process)', () => {
    it('should skip activation when algorithm has no strategy configured', async () => {
      const activation = buildActivation({
        algorithm: { id: 'algo-1', name: 'No Strategy', strategyId: null, service: null }
      });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);

      const result: any = await task.process(mockJob);

      expect(result.skippedCount).toBe(1);
      expect(mockContextBuilder.buildContext).not.toHaveBeenCalled();
    });

    it('should skip activation when context validation fails', async () => {
      const activation = buildActivation();
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      mockContextBuilder.validateContext.mockReturnValue(false);

      const result: any = await task.process(mockJob);

      expect(result.skippedCount).toBe(1);
      expect(mockAlgorithmRegistry.executeAlgorithm).not.toHaveBeenCalled();
    });

    it('should skip when algorithm returns success: false', async () => {
      const activation = buildActivation();
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: false,
        signals: [],
        timestamp: new Date()
      });

      const result: any = await task.process(mockJob);

      expect(result.skippedCount).toBe(1);
    });

    it('should filter out HOLD, STOP_LOSS, TAKE_PROFIT signals', async () => {
      const activation = buildActivation();
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          { type: SignalType.HOLD, coinId: 'coin-1', strength: 0.9, confidence: 0.9, reason: 'hold' },
          { type: SignalType.STOP_LOSS, coinId: 'coin-1', strength: 0.9, confidence: 0.9, reason: 'sl' },
          { type: SignalType.TAKE_PROFIT, coinId: 'coin-1', strength: 0.9, confidence: 0.9, reason: 'tp' }
        ],
        timestamp: new Date()
      });

      const result: any = await task.process(mockJob);

      expect(result.skippedCount).toBe(1);
      expect(mockTradeExecutionService.executeTradeSignal).not.toHaveBeenCalled();
    });

    it('should filter out signals with confidence below 0.6', async () => {
      const activation = buildActivation();
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          { type: SignalType.BUY, coinId: 'coin-1', strength: 0.9, confidence: 0.5, reason: 'low conf' },
          { type: SignalType.SELL, coinId: 'coin-2', strength: 0.8, confidence: 0.59, reason: 'low conf' }
        ],
        timestamp: new Date()
      });

      const result: any = await task.process(mockJob);

      expect(result.skippedCount).toBe(1);
    });

    it('should select signal with highest strength x confidence', async () => {
      const activation = buildActivation();
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          { type: SignalType.BUY, coinId: 'coin-weak', strength: 0.5, confidence: 0.7, reason: 'weak' },
          { type: SignalType.SELL, coinId: 'coin-strong', strength: 0.9, confidence: 0.9, reason: 'strong' },
          { type: SignalType.BUY, coinId: 'coin-mid', strength: 0.7, confidence: 0.8, reason: 'mid' }
        ],
        timestamp: new Date()
      });

      mockCoinService.getCoinById.mockImplementation(async (id: string) => {
        if (id === 'coin-strong') return { id, symbol: 'ETH' };
        if (id === 'coin-weak') return { id, symbol: 'BTC' };
        return { id, symbol: 'SOL' };
      });

      const result: any = await task.process(mockJob);

      expect(result.successCount).toBe(1);
      const signalArg = mockTradeExecutionService.executeTradeSignal.mock.calls[0][0];
      expect(signalArg.action).toBe('SELL');
      expect(signalArg.symbol).toBe('ETH/USDT');
    });

    it('should pass complete trade signal with auto-sizing and market context fields', async () => {
      const activation = buildActivation({ allocationPercentage: 5 });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      mockBalanceService.getUserBalances.mockResolvedValue({ totalUsdValue: 25000 });
      configureActionableSignal();

      const result: any = await task.process(mockJob);

      expect(result.successCount).toBe(1);
      const signalArg = mockTradeExecutionService.executeTradeSignal.mock.calls[0][0];
      expect(signalArg).toEqual(
        expect.objectContaining({
          algorithmActivationId: 'activation-1',
          userId: 'user-1',
          exchangeKeyId: 'key-1',
          action: 'BUY',
          symbol: 'BTC/USDT',
          quantity: 0,
          autoSize: true,
          portfolioValue: 25000,
          allocationPercentage: 5,
          marketType: 'spot',
          leverage: 1
        })
      );
      expect(signalArg.positionSide).toBeUndefined();
    });

    it('should skip when coin symbol resolution fails', async () => {
      const activation = buildActivation();
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      configureActionableSignal('unknown-coin');
      mockCoinService.getCoinById.mockRejectedValue(new Error('Coin not found'));

      const result: any = await task.process(mockJob);

      expect(result.skippedCount).toBe(1);
      expect(mockTradeExecutionService.executeTradeSignal).not.toHaveBeenCalled();
    });

    it('should use legacy service field when strategyId is missing', async () => {
      const activation = buildActivation({
        algorithm: { id: 'algo-1', name: 'Legacy', strategyId: null, service: 'SomeService' }
      });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      configureActionableSignal();

      const result: any = await task.process(mockJob);

      expect(result.successCount).toBe(1);
      expect(mockContextBuilder.buildContext).toHaveBeenCalled();
    });

    it('should default allocationPercentage to 5.0 when not set on activation', async () => {
      const activation = buildActivation({ allocationPercentage: undefined });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      configureActionableSignal();

      await task.process(mockJob);

      const signalArg = mockTradeExecutionService.executeTradeSignal.mock.calls[0][0];
      expect(signalArg.allocationPercentage).toBe(5.0);
    });
  });

  describe('symbol resolution (via process)', () => {
    it.each([
      ['binance_us', 'BTC/USDT'],
      ['coinbase', 'BTC/USD'],
      ['gdax', 'BTC/USD'],
      ['kraken', 'BTC/USD'],
      ['unknown_exchange', 'BTC/USDT']
    ])('should resolve quote currency for %s → %s', async (slug, expectedSymbol) => {
      const activation = buildActivation({ exchangeKey: { exchange: { slug } } });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      configureActionableSignal();

      await task.process(mockJob);

      expect(mockTradeExecutionService.executeTradeSignal.mock.calls[0][0].symbol).toBe(expectedSymbol);
    });

    it('should skip when exchange relation is missing (null-safety)', async () => {
      const activation = buildActivation({ exchangeKey: null });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      configureActionableSignal();

      const result: any = await task.process(mockJob);

      expect(result.skippedCount).toBe(1);
      expect(mockTradeExecutionService.executeTradeSignal).not.toHaveBeenCalled();
    });
  });

  describe('handleExecuteTrades (via process)', () => {
    it('should cache portfolio value per user (one balance call for multiple activations)', async () => {
      const activation1 = buildActivation({ id: 'act-1', userId: 'user-1' });
      const activation2 = buildActivation({ id: 'act-2', userId: 'user-1' });
      const activation3 = buildActivation({ id: 'act-3', userId: 'user-2' });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation1, activation2, activation3]);

      // Algorithms return no actionable signals so we only test caching
      mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [],
        timestamp: new Date()
      });

      await task.process(mockJob);

      // user-1 fetched once, user-2 fetched once = 2 total (no duplicate)
      expect(mockUsersService.getById).toHaveBeenCalledTimes(2);
      expect(mockBalanceService.getUserBalances).toHaveBeenCalledTimes(2);
    });

    it('should continue after individual activation failure', async () => {
      const activation1 = buildActivation({ id: 'act-1', algorithmId: 'algo-fail' });
      const activation2 = buildActivation({ id: 'act-2', algorithmId: 'algo-ok' });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation1, activation2]);

      mockAlgorithmRegistry.executeAlgorithm.mockImplementation(async (algoId: string) => {
        if (algoId === 'algo-fail') throw new Error('algo failure');
        return { success: true, signals: [], timestamp: new Date() };
      });

      const result: any = await task.process(mockJob);

      expect(result.failCount).toBe(1);
      expect(result.skippedCount).toBe(1);
      expect(result.totalActivations).toBe(2);
    });

    it('should return counts: successCount, failCount, skippedCount, blockedCount', async () => {
      const activation1 = buildActivation({ id: 'act-1', algorithmId: 'algo-buy' });
      const activation2 = buildActivation({ id: 'act-2', algorithmId: 'algo-fail' });
      const activation3 = buildActivation({ id: 'act-3', algorithmId: 'algo-skip' });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation1, activation2, activation3]);

      mockAlgorithmRegistry.executeAlgorithm.mockImplementation(async (algoId: string) => {
        if (algoId === 'algo-buy') {
          return {
            success: true,
            signals: [{ type: SignalType.BUY, coinId: 'coin-1', strength: 0.8, confidence: 0.8, reason: 'buy' }],
            timestamp: new Date()
          };
        }
        if (algoId === 'algo-fail') throw new Error('failure');
        return { success: true, signals: [], timestamp: new Date() };
      });

      const result: any = await task.process(mockJob);

      expect(result.successCount).toBe(1);
      expect(result.failCount).toBe(1);
      expect(result.skippedCount).toBe(1);
      expect(result.blockedCount).toBe(0);
      expect(result.totalActivations).toBe(3);
    });

    it('should return zero counts when no active activations', async () => {
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([]);

      const result: any = await task.process(mockJob);

      expect(result).toEqual({
        totalActivations: 0,
        successCount: 0,
        failCount: 0,
        skippedCount: 0,
        blockedCount: 0,
        timestamp: expect.any(String)
      });
    });
  });

  describe('kill switch', () => {
    it('should return early when trading is globally halted', async () => {
      mockTradingStateService.isTradingEnabled.mockReturnValue(false);

      const result: any = await task.process(mockJob);

      expect(result).toEqual({ success: false, message: 'Trading globally halted' });
      expect(mockActivationService.findAllActiveAlgorithms).not.toHaveBeenCalled();
    });
  });

  describe('mutual exclusion — filterRoboAdvisorUsers', () => {
    it('should filter out activations for users with algoTradingEnabled=true', async () => {
      const activation1 = buildActivation({ id: 'act-1', userId: 'robo-user' });
      const activation2 = buildActivation({ id: 'act-2', userId: 'manual-user' });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation1, activation2]);
      mockUserRepo.find.mockResolvedValue([{ id: 'robo-user' }]);

      // manual-user has no signal
      mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [],
        timestamp: new Date()
      });

      const result: any = await task.process(mockJob);

      // Only manual-user's activation should be processed (1 total, 1 skipped due to no signal)
      expect(result.totalActivations).toBe(1);
    });
  });

  describe('trade cooldown', () => {
    it('should block activation when cooldown rejects the trade', async () => {
      const activation = buildActivation();
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      configureActionableSignal();
      mockTradeCooldownService.checkAndClaim.mockResolvedValue({
        allowed: false,
        existingClaim: { pipeline: 'strategy:config-1', claimedAt: Date.now() }
      });

      const result: any = await task.process(mockJob);

      expect(result.blockedCount).toBe(1);
      expect(result.skippedCount).toBe(0);
      expect(mockTradeExecutionService.executeTradeSignal).not.toHaveBeenCalled();
    });

    it('should clear cooldown on trade execution failure', async () => {
      const activation = buildActivation();
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      configureActionableSignal();
      mockTradeCooldownService.checkAndClaim.mockResolvedValue({ allowed: true });
      mockTradeExecutionService.executeTradeSignal.mockRejectedValue(new Error('Exchange error'));

      const result: any = await task.process(mockJob);

      expect(result.failCount).toBe(1);
      expect(mockTradeCooldownService.clearCooldown).toHaveBeenCalledWith('user-1', 'BTC/USDT', 'BUY');
    });
  });

  describe('fetchPortfolioValue (via process)', () => {
    it('should skip activation when portfolio value is 0 (balance fetch failed)', async () => {
      const activation = buildActivation();
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      mockUsersService.getById.mockRejectedValue(new Error('User not found'));
      configureActionableSignal();

      const result: any = await task.process(mockJob);

      expect(result.skippedCount).toBe(1);
      expect(mockTradeExecutionService.executeTradeSignal).not.toHaveBeenCalled();
    });

    it('should skip activation when totalUsdValue is null', async () => {
      const activation = buildActivation();
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      mockUsersService.getById.mockResolvedValue({ id: 'user-1' });
      mockBalanceService.getUserBalances.mockResolvedValue({ totalUsdValue: null });
      configureActionableSignal();

      const result: any = await task.process(mockJob);

      expect(result.skippedCount).toBe(1);
      expect(mockTradeExecutionService.executeTradeSignal).not.toHaveBeenCalled();
    });
  });

  describe('signal throttle integration', () => {
    it('should call filterSignals with converted signals for actionable activations', async () => {
      const activation = buildActivation();
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      configureActionableSignal('coin-1', SignalType.BUY, 0.8, 0.8);

      await task.process(mockJob);

      expect(mockSignalThrottle.filterSignals).toHaveBeenCalledTimes(1);
      const [signals] = mockSignalThrottle.filterSignals.mock.calls[0];
      expect(signals).toHaveLength(1);
      expect(signals[0]).toEqual(
        expect.objectContaining({
          action: 'BUY',
          coinId: 'coin-1',
          originalType: SignalType.BUY
        })
      );
    });

    it('should skip activation when all signals are throttled', async () => {
      const activation = buildActivation();
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      configureActionableSignal();
      mockSignalThrottle.filterSignals.mockReturnValue([]);

      const result: any = await task.process(mockJob);

      expect(result.skippedCount).toBe(1);
      expect(mockTradeExecutionService.executeTradeSignal).not.toHaveBeenCalled();
    });

    it('should resolve throttle config from activation.config', async () => {
      const activation = buildActivation({ config: { cooldownMs: 3600_000 } });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      configureActionableSignal();

      await task.process(mockJob);

      expect(mockSignalThrottle.resolveConfig).toHaveBeenCalledWith({ cooldownMs: 3600_000 });
    });

    it('should apply throttle before TradeCooldownService dedup', async () => {
      const activation = buildActivation();
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      configureActionableSignal();
      mockSignalThrottle.filterSignals.mockReturnValue([]);

      await task.process(mockJob);

      // Signal was throttled before reaching cooldown service
      expect(mockTradeCooldownService.checkAndClaim).not.toHaveBeenCalled();
    });
  });

  describe('futures / market context resolution', () => {
    it('should use activation config metadata for futures market type', async () => {
      const activation = buildActivation({
        config: { metadata: { marketType: MarketType.FUTURES, leverage: 5 } }
      });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      configureActionableSignal();

      await task.process(mockJob);

      const signalArg = mockTradeExecutionService.executeTradeSignal.mock.calls[0][0];
      expect(signalArg.marketType).toBe('futures');
      expect(signalArg.leverage).toBe(5);
      expect(signalArg.positionSide).toBe('long');
    });

    it('should fall back to StrategyConfig for futures market type', async () => {
      const activation = buildActivation();
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      mockStrategyConfigRepo.findOne.mockResolvedValue({
        marketType: MarketType.FUTURES,
        defaultLeverage: 3
      });
      configureActionableSignal();

      await task.process(mockJob);

      const signalArg = mockTradeExecutionService.executeTradeSignal.mock.calls[0][0];
      expect(signalArg.marketType).toBe('futures');
      expect(signalArg.leverage).toBe(3);
    });

    it('should default to spot with leverage 1 when no futures config exists', async () => {
      const activation = buildActivation();
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      mockStrategyConfigRepo.findOne.mockResolvedValue(null);
      configureActionableSignal();

      await task.process(mockJob);

      const signalArg = mockTradeExecutionService.executeTradeSignal.mock.calls[0][0];
      expect(signalArg.marketType).toBe('spot');
      expect(signalArg.leverage).toBe(1);
      expect(signalArg.positionSide).toBeUndefined();
    });

    it('should map SHORT_ENTRY to SELL with positionSide short', async () => {
      const activation = buildActivation({
        config: { metadata: { marketType: MarketType.FUTURES, leverage: 2 } }
      });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      configureActionableSignal('coin-1', SignalType.SHORT_ENTRY);

      await task.process(mockJob);

      const signalArg = mockTradeExecutionService.executeTradeSignal.mock.calls[0][0];
      expect(signalArg.action).toBe('SELL');
      expect(signalArg.positionSide).toBe('short');
    });

    it('should map SHORT_EXIT to BUY with positionSide short', async () => {
      const activation = buildActivation({
        config: { metadata: { marketType: MarketType.FUTURES, leverage: 2 } }
      });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      configureActionableSignal('coin-1', SignalType.SHORT_EXIT);

      await task.process(mockJob);

      const signalArg = mockTradeExecutionService.executeTradeSignal.mock.calls[0][0];
      expect(signalArg.action).toBe('BUY');
      expect(signalArg.positionSide).toBe('short');
    });
  });

  describe('daily loss limit gate — entry signal blocking', () => {
    it.each([
      [SignalType.BUY, undefined, 'spot BUY'],
      [SignalType.SHORT_ENTRY, { metadata: { marketType: MarketType.FUTURES, leverage: 2 } }, 'futures SHORT_ENTRY']
    ])('should block entry signal %s when user is daily-loss-blocked (%s)', async (signalType, config, _label) => {
      const activation = buildActivation(config ? { config } : {});
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      mockDailyLossLimitGate.isEntryBlocked.mockResolvedValue({
        blocked: true,
        reason: 'Daily loss limit exceeded'
      });
      configureActionableSignal('coin-1', signalType as SignalType);

      const result: any = await task.process(mockJob);

      expect(result.blockedCount).toBe(1);
      expect(mockTradeExecutionService.executeTradeSignal).not.toHaveBeenCalled();
      expect(mockMetricsService.recordDailyLossGateBlock).toHaveBeenCalled();
    });

    it.each([
      [SignalType.SELL, undefined, 'spot SELL'],
      [SignalType.SHORT_EXIT, { metadata: { marketType: MarketType.FUTURES, leverage: 2 } }, 'futures SHORT_EXIT']
    ])('should allow exit signal %s when user is daily-loss-blocked (%s)', async (signalType, config, _label) => {
      const activation = buildActivation(config ? { config } : {});
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      mockDailyLossLimitGate.isEntryBlocked.mockResolvedValue({
        blocked: true,
        reason: 'Daily loss limit exceeded'
      });
      configureActionableSignal('coin-1', signalType as SignalType);

      const result: any = await task.process(mockJob);

      expect(result.successCount).toBe(1);
      expect(mockTradeExecutionService.executeTradeSignal).toHaveBeenCalled();
    });

    it('should block all activations and set portfolio=0 when user preflight fails', async () => {
      const activation = buildActivation();
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      mockUsersService.getById.mockRejectedValue(new Error('DB timeout'));
      configureActionableSignal('coin-1', SignalType.BUY);

      const result: any = await task.process(mockJob);

      // Fail-closed: portfolio=0 skips activation before daily loss gate even checked
      expect(result.skippedCount).toBe(1);
      expect(mockTradeExecutionService.executeTradeSignal).not.toHaveBeenCalled();
    });
  });
});
