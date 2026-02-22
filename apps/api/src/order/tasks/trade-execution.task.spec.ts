import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { TradeExecutionTask } from './trade-execution.task';

import { SignalType } from '../../algorithm/interfaces';
import { AlgorithmRegistry } from '../../algorithm/registry/algorithm-registry.service';
import { AlgorithmActivationService } from '../../algorithm/services/algorithm-activation.service';
import { AlgorithmContextBuilder } from '../../algorithm/services/algorithm-context-builder.service';
import { BalanceService } from '../../balance/balance.service';
import { CoinService } from '../../coin/coin.service';
import { UsersService } from '../../users/users.service';
import { TradeExecutionService } from '../services/trade-execution.service';

describe('TradeExecutionTask', () => {
  let task: TradeExecutionTask;
  let mockQueue: any;
  let mockTradeExecutionService: any;
  let mockActivationService: any;
  let mockAlgorithmRegistry: any;
  let mockContextBuilder: any;
  let mockBalanceService: any;
  let mockCoinService: any;
  let mockUsersService: any;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeExecutionTask,
        { provide: getQueueToken('trade-execution'), useValue: mockQueue },
        { provide: TradeExecutionService, useValue: mockTradeExecutionService },
        { provide: AlgorithmActivationService, useValue: mockActivationService },
        { provide: AlgorithmRegistry, useValue: mockAlgorithmRegistry },
        { provide: AlgorithmContextBuilder, useValue: mockContextBuilder },
        { provide: BalanceService, useValue: mockBalanceService },
        { provide: CoinService, useValue: mockCoinService },
        { provide: UsersService, useValue: mockUsersService }
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

    it('should skip when algorithm returns no signals', async () => {
      const activation = buildActivation();
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
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

    it('should pass autoSize, portfolioValue, and allocationPercentage in the signal', async () => {
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
          allocationPercentage: 5
        })
      );
    });

    it('should map BUY and SELL signal types correctly', async () => {
      const activation = buildActivation();
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);

      // BUY
      configureActionableSignal('coin-1', SignalType.BUY);
      await task.process(mockJob);
      expect(mockTradeExecutionService.executeTradeSignal.mock.calls[0][0].action).toBe('BUY');

      jest.clearAllMocks();
      mockJob.updateProgress.mockClear();
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);

      // SELL
      configureActionableSignal('coin-1', SignalType.SELL);
      await task.process(mockJob);
      expect(mockTradeExecutionService.executeTradeSignal.mock.calls[0][0].action).toBe('SELL');
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
    it('should return "BTC/USDT" for binance_us', async () => {
      const activation = buildActivation({ exchangeKey: { exchange: { slug: 'binance_us' } } });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      configureActionableSignal();

      await task.process(mockJob);

      expect(mockTradeExecutionService.executeTradeSignal.mock.calls[0][0].symbol).toBe('BTC/USDT');
    });

    it('should return "BTC/USD" for coinbase', async () => {
      const activation = buildActivation({ exchangeKey: { exchange: { slug: 'coinbase' } } });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      configureActionableSignal();

      await task.process(mockJob);

      expect(mockTradeExecutionService.executeTradeSignal.mock.calls[0][0].symbol).toBe('BTC/USD');
    });

    it('should return "BTC/USD" for gdax (Coinbase Pro)', async () => {
      const activation = buildActivation({ exchangeKey: { exchange: { slug: 'gdax' } } });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      configureActionableSignal();

      await task.process(mockJob);

      expect(mockTradeExecutionService.executeTradeSignal.mock.calls[0][0].symbol).toBe('BTC/USD');
    });

    it('should return "BTC/USD" for kraken', async () => {
      const activation = buildActivation({ exchangeKey: { exchange: { slug: 'kraken' } } });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      configureActionableSignal();

      await task.process(mockJob);

      expect(mockTradeExecutionService.executeTradeSignal.mock.calls[0][0].symbol).toBe('BTC/USD');
    });

    it('should default to USDT for unknown exchange slugs', async () => {
      const activation = buildActivation({ exchangeKey: { exchange: { slug: 'unknown_exchange' } } });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      configureActionableSignal();

      await task.process(mockJob);

      expect(mockTradeExecutionService.executeTradeSignal.mock.calls[0][0].symbol).toBe('BTC/USDT');
    });

    it('should uppercase the coin symbol', async () => {
      mockCoinService.getCoinById.mockResolvedValue({ id: 'coin-1', symbol: 'eth' });
      const activation = buildActivation();
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      configureActionableSignal();

      await task.process(mockJob);

      expect(mockTradeExecutionService.executeTradeSignal.mock.calls[0][0].symbol).toBe('ETH/USDT');
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

      // user-1 fetched once, user-2 fetched once = 2 total
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

    it('should return counts: successCount, failCount, skippedCount', async () => {
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
        timestamp: expect.any(String)
      });
    });

    it('should process 12 activations across 3 users with only 3 balance fetches', async () => {
      const activations = [];
      const userIds = ['user-1', 'user-2', 'user-3'];
      for (let i = 0; i < 12; i++) {
        activations.push(
          buildActivation({
            id: `act-${i}`,
            userId: userIds[i % 3],
            algorithmId: `algo-${i}`
          })
        );
      }
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue(activations);

      // All return no actionable signals
      mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [],
        timestamp: new Date()
      });

      await task.process(mockJob);

      // Only 3 unique users → 3 balance fetches
      expect(mockUsersService.getById).toHaveBeenCalledTimes(3);
      expect(mockBalanceService.getUserBalances).toHaveBeenCalledTimes(3);

      // All 12 activations processed (as skipped, since no signals)
      expect(mockAlgorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(12);
    });
  });

  describe('fetchPortfolioValue (via process)', () => {
    it('should use totalUsdValue from balance service', async () => {
      const activation = buildActivation();
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation]);
      mockUsersService.getById.mockResolvedValue({ id: 'user-1' });
      mockBalanceService.getUserBalances.mockResolvedValue({ totalUsdValue: 50000 });
      configureActionableSignal();

      await task.process(mockJob);

      expect(mockUsersService.getById).toHaveBeenCalledWith('user-1', true);
      const signalArg = mockTradeExecutionService.executeTradeSignal.mock.calls[0][0];
      expect(signalArg.portfolioValue).toBe(50000);
    });

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
});
