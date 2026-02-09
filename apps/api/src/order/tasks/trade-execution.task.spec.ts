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

  describe('generateTradeSignal', () => {
    it('should return null when algorithm has no strategy configured', async () => {
      const activation = buildActivation({
        algorithm: { id: 'algo-1', name: 'No Strategy', strategyId: null, service: null }
      });

      const result = await task.generateTradeSignal(activation, 10000);

      expect(result).toBeNull();
      expect(mockContextBuilder.buildContext).not.toHaveBeenCalled();
    });

    it('should return null when context validation fails', async () => {
      const activation = buildActivation();
      mockContextBuilder.validateContext.mockReturnValue(false);

      const result = await task.generateTradeSignal(activation, 10000);

      expect(result).toBeNull();
      expect(mockAlgorithmRegistry.executeAlgorithm).not.toHaveBeenCalled();
    });

    it('should return null when algorithm returns success: false', async () => {
      const activation = buildActivation();
      mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: false,
        signals: [],
        timestamp: new Date()
      });

      const result = await task.generateTradeSignal(activation, 10000);

      expect(result).toBeNull();
    });

    it('should return null when algorithm returns no signals', async () => {
      const activation = buildActivation();
      mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [],
        timestamp: new Date()
      });

      const result = await task.generateTradeSignal(activation, 10000);

      expect(result).toBeNull();
    });

    it('should filter out HOLD, STOP_LOSS, TAKE_PROFIT signals', async () => {
      const activation = buildActivation();
      mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          { type: SignalType.HOLD, coinId: 'coin-1', strength: 0.9, confidence: 0.9, reason: 'hold' },
          { type: SignalType.STOP_LOSS, coinId: 'coin-1', strength: 0.9, confidence: 0.9, reason: 'sl' },
          { type: SignalType.TAKE_PROFIT, coinId: 'coin-1', strength: 0.9, confidence: 0.9, reason: 'tp' }
        ],
        timestamp: new Date()
      });

      const result = await task.generateTradeSignal(activation, 10000);

      expect(result).toBeNull();
    });

    it('should filter out signals with confidence below 0.6', async () => {
      const activation = buildActivation();
      mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          { type: SignalType.BUY, coinId: 'coin-1', strength: 0.9, confidence: 0.5, reason: 'low conf' },
          { type: SignalType.SELL, coinId: 'coin-2', strength: 0.8, confidence: 0.59, reason: 'low conf' }
        ],
        timestamp: new Date()
      });

      const result = await task.generateTradeSignal(activation, 10000);

      expect(result).toBeNull();
    });

    it('should select signal with highest strength x confidence', async () => {
      const activation = buildActivation();
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

      const result = await task.generateTradeSignal(activation, 10000);

      expect(result).not.toBeNull();
      expect(result.action).toBe('SELL');
      expect(result.symbol).toBe('ETH/USDT');
    });

    it('should return correct TradeSignalWithExit with autoSize: true', async () => {
      const activation = buildActivation();
      mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [{ type: SignalType.BUY, coinId: 'coin-1', strength: 0.8, confidence: 0.7, reason: 'buy' }],
        timestamp: new Date()
      });

      const result = await task.generateTradeSignal(activation, 25000);

      expect(result).toEqual({
        algorithmActivationId: 'activation-1',
        userId: 'user-1',
        exchangeKeyId: 'key-1',
        action: 'BUY',
        symbol: 'BTC/USDT',
        quantity: 0,
        autoSize: true,
        portfolioValue: 25000
      });
    });

    it('should map BUY and SELL signal types correctly', async () => {
      const activation = buildActivation();

      // Test BUY
      mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [{ type: SignalType.BUY, coinId: 'coin-1', strength: 0.8, confidence: 0.8, reason: 'buy' }],
        timestamp: new Date()
      });

      let result = await task.generateTradeSignal(activation, 10000);
      expect(result.action).toBe('BUY');

      // Test SELL
      mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [{ type: SignalType.SELL, coinId: 'coin-1', strength: 0.8, confidence: 0.8, reason: 'sell' }],
        timestamp: new Date()
      });

      result = await task.generateTradeSignal(activation, 10000);
      expect(result.action).toBe('SELL');
    });

    it('should return null when coin symbol resolution fails', async () => {
      const activation = buildActivation();
      mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [{ type: SignalType.BUY, coinId: 'unknown-coin', strength: 0.8, confidence: 0.8, reason: 'buy' }],
        timestamp: new Date()
      });
      mockCoinService.getCoinById.mockRejectedValue(new Error('Coin not found'));

      const result = await task.generateTradeSignal(activation, 10000);

      expect(result).toBeNull();
    });

    it('should use legacy service field when strategyId is missing', async () => {
      const activation = buildActivation({
        algorithm: { id: 'algo-1', name: 'Legacy', strategyId: null, service: 'SomeService' }
      });
      mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [{ type: SignalType.BUY, coinId: 'coin-1', strength: 0.8, confidence: 0.8, reason: 'buy' }],
        timestamp: new Date()
      });

      const result = await task.generateTradeSignal(activation, 10000);

      expect(result).not.toBeNull();
      expect(mockContextBuilder.buildContext).toHaveBeenCalled();
    });
  });

  describe('resolveTradingSymbol', () => {
    it('should return "BTC/USDT" for binance_us', async () => {
      const activation = buildActivation({ exchangeKey: { exchange: { slug: 'binance_us' } } });

      const result = await task.resolveTradingSymbol('coin-1', activation);

      expect(result).toBe('BTC/USDT');
    });

    it('should return "BTC/USD" for coinbase', async () => {
      const activation = buildActivation({ exchangeKey: { exchange: { slug: 'coinbase' } } });

      const result = await task.resolveTradingSymbol('coin-1', activation);

      expect(result).toBe('BTC/USD');
    });

    it('should default to USDT for unknown exchange slugs', async () => {
      const activation = buildActivation({ exchangeKey: { exchange: { slug: 'kraken' } } });

      const result = await task.resolveTradingSymbol('coin-1', activation);

      expect(result).toBe('BTC/USDT');
    });

    it('should return null when coin not found', async () => {
      mockCoinService.getCoinById.mockRejectedValue(new Error('Coin not found'));
      const activation = buildActivation();

      const result = await task.resolveTradingSymbol('unknown-coin', activation);

      expect(result).toBeNull();
    });

    it('should uppercase the coin symbol', async () => {
      mockCoinService.getCoinById.mockResolvedValue({ id: 'coin-1', symbol: 'eth' });
      const activation = buildActivation();

      const result = await task.resolveTradingSymbol('coin-1', activation);

      expect(result).toBe('ETH/USDT');
    });
  });

  describe('handleExecuteTrades', () => {
    const mockJob = {
      id: 'job-1',
      name: 'execute-trades',
      updateProgress: jest.fn()
    } as any;

    it('should cache portfolio value per user (one balance call for multiple activations)', async () => {
      const activation1 = buildActivation({ id: 'act-1', userId: 'user-1' });
      const activation2 = buildActivation({ id: 'act-2', userId: 'user-1' });
      const activation3 = buildActivation({ id: 'act-3', userId: 'user-2' });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation1, activation2, activation3]);

      // generateTradeSignal returns null so we test caching without side effects
      jest.spyOn(task, 'generateTradeSignal').mockResolvedValue(null);
      jest.spyOn(task, 'fetchPortfolioValue').mockResolvedValue(10000);

      await task.process(mockJob);

      // user-1 fetched once (cached for second activation), user-2 fetched once
      expect(task.fetchPortfolioValue).toHaveBeenCalledTimes(2);
    });

    it('should continue after individual activation failure', async () => {
      const activation1 = buildActivation({ id: 'act-1' });
      const activation2 = buildActivation({ id: 'act-2' });
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue([activation1, activation2]);

      jest.spyOn(task, 'fetchPortfolioValue').mockResolvedValue(10000);

      let callCount = 0;
      jest.spyOn(task, 'generateTradeSignal').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('algo failure');
        return null;
      });

      const result: any = await task.process(mockJob);

      expect(result.failCount).toBe(1);
      expect(result.skippedCount).toBe(1);
      expect(result.totalActivations).toBe(2);
    });

    it('should return counts: successCount, failCount, skippedCount', async () => {
      const activations = [
        buildActivation({ id: 'act-1' }),
        buildActivation({ id: 'act-2' }),
        buildActivation({ id: 'act-3' })
      ];
      mockActivationService.findAllActiveAlgorithms.mockResolvedValue(activations);

      jest.spyOn(task, 'fetchPortfolioValue').mockResolvedValue(10000);

      let callCount = 0;
      jest.spyOn(task, 'generateTradeSignal').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            algorithmActivationId: 'act-1',
            userId: 'user-1',
            exchangeKeyId: 'key-1',
            action: 'BUY' as const,
            symbol: 'BTC/USDT',
            quantity: 0,
            autoSize: true,
            portfolioValue: 10000
          };
        }
        if (callCount === 2) throw new Error('failure');
        return null;
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
  });

  describe('fetchPortfolioValue', () => {
    it('should return totalUsdValue on success', async () => {
      mockUsersService.getById.mockResolvedValue({ id: 'user-1' });
      mockBalanceService.getUserBalances.mockResolvedValue({ totalUsdValue: 50000 });

      const activation = buildActivation();
      const result = await task.fetchPortfolioValue(activation);

      expect(result).toBe(50000);
      expect(mockUsersService.getById).toHaveBeenCalledWith('user-1', true);
    });

    it('should return 0 on error', async () => {
      mockUsersService.getById.mockRejectedValue(new Error('User not found'));

      const activation = buildActivation();
      const result = await task.fetchPortfolioValue(activation);

      expect(result).toBe(0);
    });

    it('should return 0 when totalUsdValue is null/undefined', async () => {
      mockUsersService.getById.mockResolvedValue({ id: 'user-1' });
      mockBalanceService.getUserBalances.mockResolvedValue({ totalUsdValue: null });

      const activation = buildActivation();
      const result = await task.fetchPortfolioValue(activation);

      expect(result).toBe(0);
    });
  });
});
