import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { MarketType, SignalReasonCode } from '@chansey/api-interfaces';

import { TradeSignalGeneratorService } from './trade-signal-generator.service';

import { SignalType } from '../../algorithm/interfaces';
import { AlgorithmRegistry } from '../../algorithm/registry/algorithm-registry.service';
import { AlgorithmContextBuilder } from '../../algorithm/services/algorithm-context-builder.service';
import { CoinService } from '../../coin/coin.service';
import { ExchangeSelectionService } from '../../exchange/exchange-selection/exchange-selection.service';
import { StrategyConfig } from '../../strategy/entities/strategy-config.entity';
import { SignalThrottleService } from '../backtest/shared/throttle';

describe('TradeSignalGeneratorService', () => {
  let service: TradeSignalGeneratorService;
  let mockStrategyConfigRepo: any;
  let mockAlgorithmRegistry: any;
  let mockContextBuilder: any;
  let mockCoinService: any;
  let mockSignalThrottle: any;
  let mockExchangeSelectionService: any;

  const buildActivation = (overrides: Partial<any> = {}) =>
    ({
      id: 'activation-1',
      userId: 'user-1',
      algorithmId: 'algo-1',
      allocationPercentage: 5,
      isActive: true,
      algorithm: {
        id: 'algo-1',
        name: 'Test Algorithm',
        strategyId: 'strategy-1',
        service: null
      },
      ...overrides
    }) as any;

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
    mockStrategyConfigRepo = { findOne: jest.fn().mockResolvedValue(null) };
    mockAlgorithmRegistry = { executeAlgorithm: jest.fn() };
    mockContextBuilder = {
      buildContext: jest.fn().mockResolvedValue({
        coins: [{ id: 'coin-1', symbol: 'BTC' }],
        priceData: { 'coin-1': [{ close: 50000 }] },
        timestamp: new Date(),
        config: {}
      }),
      validateContext: jest.fn().mockReturnValue(true)
    };
    mockCoinService = {
      getCoinById: jest.fn().mockResolvedValue({ id: 'coin-1', symbol: 'BTC' })
    };
    mockSignalThrottle = {
      createState: jest.fn().mockReturnValue({ lastSignalTime: {}, tradeTimestamps: [] }),
      resolveConfig: jest.fn().mockReturnValue({ cooldownMs: 86_400_000, maxTradesPerDay: 6, minSellPercent: 0.5 }),
      filterSignals: jest.fn().mockImplementation((signals: any[]) => ({ accepted: signals, rejected: [] })),
      markExecuted: jest.fn(),
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
    mockExchangeSelectionService = {
      selectForBuy: jest.fn().mockResolvedValue({ id: 'key-1', exchange: { slug: 'binance_us' } }),
      selectForSell: jest.fn().mockResolvedValue({ id: 'key-1', exchange: { slug: 'binance_us' } })
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeSignalGeneratorService,
        { provide: getRepositoryToken(StrategyConfig), useValue: mockStrategyConfigRepo },
        { provide: AlgorithmRegistry, useValue: mockAlgorithmRegistry },
        { provide: AlgorithmContextBuilder, useValue: mockContextBuilder },
        { provide: CoinService, useValue: mockCoinService },
        { provide: SignalThrottleService, useValue: mockSignalThrottle },
        { provide: ExchangeSelectionService, useValue: mockExchangeSelectionService }
      ]
    }).compile();

    service = module.get<TradeSignalGeneratorService>(TradeSignalGeneratorService);

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('signal generation', () => {
    it('should skip when algorithm has no strategy configured', async () => {
      const activation = buildActivation({
        algorithm: { id: 'algo-1', name: 'No Strategy', strategyId: null, service: null }
      });

      const result = await service.generateTradeSignal(activation, 10000);

      expect(result.signal).toBeNull();
      expect(mockContextBuilder.buildContext).not.toHaveBeenCalled();
    });

    it('should skip when context validation fails', async () => {
      mockContextBuilder.validateContext.mockReturnValue(false);

      const result = await service.generateTradeSignal(buildActivation(), 10000);

      expect(result.signal).toBeNull();
    });

    it('should skip when algorithm returns no signals', async () => {
      mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [],
        timestamp: new Date()
      });

      const result = await service.generateTradeSignal(buildActivation(), 10000);

      expect(result.signal).toBeNull();
    });

    it('should filter out signals below confidence threshold', async () => {
      // Confidence 0.5 is below MIN_CONFIDENCE_THRESHOLD (0.6) — should be filtered
      mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [{ type: SignalType.BUY, coinId: 'coin-1', strength: 0.9, confidence: 0.5, reason: 'low' }],
        timestamp: new Date()
      });

      const result = await service.generateTradeSignal(buildActivation(), 10000);

      expect(result.signal).toBeNull();
    });

    it('should select signal with highest strength x confidence', async () => {
      mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          { type: SignalType.BUY, coinId: 'coin-weak', strength: 0.5, confidence: 0.7, reason: 'weak' },
          { type: SignalType.SELL, coinId: 'coin-strong', strength: 0.9, confidence: 0.9, reason: 'strong' }
        ],
        timestamp: new Date()
      });

      mockCoinService.getCoinById.mockImplementation((id: string) =>
        id === 'coin-strong' ? { id, symbol: 'ETH' } : { id, symbol: 'BTC' }
      );

      const result = await service.generateTradeSignal(buildActivation(), 10000);

      expect(result.signal?.action).toBe('SELL');
      expect(result.signal?.symbol).toBe('ETH/USDT');
    });

    it('should return complete signal with auto-sizing fields', async () => {
      configureActionableSignal();

      const result = await service.generateTradeSignal(buildActivation({ allocationPercentage: 5 }), 25000);

      expect(result.signal).toEqual(
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
    });
  });

  describe('symbol resolution', () => {
    it.each([
      ['binance_us', 'BTC/USDT'],
      ['coinbase', 'BTC/USD'],
      ['gdax', 'BTC/USD'],
      ['kraken', 'BTC/USD'],
      ['unknown_exchange', 'BTC/USDT']
    ])('should resolve quote currency for %s → %s', async (slug, expectedSymbol) => {
      configureActionableSignal();
      mockExchangeSelectionService.selectForBuy.mockResolvedValue({ id: 'key-1', exchange: { slug } });

      const result = await service.generateTradeSignal(buildActivation(), 10000);

      expect(result.signal?.symbol).toBe(expectedSymbol);
    });

    it('should return SYMBOL_RESOLUTION_FAILED when coin not found', async () => {
      configureActionableSignal('unknown-coin');
      mockCoinService.getCoinById.mockRejectedValue(new Error('Coin not found'));

      const result = await service.generateTradeSignal(buildActivation(), 10000);

      expect(result.signal).toBeNull();
      expect(result.skipReason?.reasonCode).toBe(SignalReasonCode.SYMBOL_RESOLUTION_FAILED);
    });

    it('should return EXCHANGE_SELECTION_FAILED when no exchange keys', async () => {
      configureActionableSignal();
      mockExchangeSelectionService.selectForBuy.mockRejectedValue(new Error('No active exchange keys'));

      const result = await service.generateTradeSignal(buildActivation(), 10000);

      expect(result.signal).toBeNull();
      expect(result.skipReason?.reasonCode).toBe(SignalReasonCode.EXCHANGE_SELECTION_FAILED);
    });
  });

  describe('signal throttle', () => {
    it('should return SIGNAL_THROTTLED when all signals throttled', async () => {
      configureActionableSignal();
      mockSignalThrottle.filterSignals.mockReturnValue({ accepted: [], rejected: [] });

      const result = await service.generateTradeSignal(buildActivation(), 10000);

      expect(result.signal).toBeNull();
      expect(result.skipReason?.reasonCode).toBe(SignalReasonCode.SIGNAL_THROTTLED);
    });

    it('should resolve throttle config from activation.config', async () => {
      configureActionableSignal();

      await service.generateTradeSignal(buildActivation({ config: { cooldownMs: 3600_000 } }), 10000);

      expect(mockSignalThrottle.resolveConfig).toHaveBeenCalledWith({ cooldownMs: 3600_000 });
    });
  });

  describe('market context resolution', () => {
    it('should use activation config metadata for futures', async () => {
      configureActionableSignal();
      const activation = buildActivation({
        config: { metadata: { marketType: MarketType.FUTURES, leverage: 5 } }
      });

      const result = await service.generateTradeSignal(activation, 10000);

      expect(result.signal?.marketType).toBe('futures');
      expect(result.signal?.leverage).toBe(5);
      expect(result.signal?.positionSide).toBe('long');
    });

    it('should fall back to StrategyConfig for futures', async () => {
      configureActionableSignal();
      mockStrategyConfigRepo.findOne.mockResolvedValue({
        marketType: MarketType.FUTURES,
        defaultLeverage: 3
      });

      const result = await service.generateTradeSignal(buildActivation(), 10000);

      expect(result.signal?.marketType).toBe('futures');
      expect(result.signal?.leverage).toBe(3);
    });

    it('should default to spot with leverage 1', async () => {
      configureActionableSignal();

      const result = await service.generateTradeSignal(buildActivation(), 10000);

      expect(result.signal?.marketType).toBe('spot');
      expect(result.signal?.leverage).toBe(1);
      expect(result.signal?.positionSide).toBeUndefined();
    });

    it('should map SHORT_ENTRY to SELL with positionSide short', async () => {
      configureActionableSignal('coin-1', SignalType.SHORT_ENTRY);
      const activation = buildActivation({
        config: { metadata: { marketType: MarketType.FUTURES, leverage: 2 } }
      });

      const result = await service.generateTradeSignal(activation, 10000);

      expect(result.signal?.action).toBe('SELL');
      expect(result.signal?.positionSide).toBe('short');
    });

    it('should map SHORT_EXIT to BUY with positionSide short', async () => {
      configureActionableSignal('coin-1', SignalType.SHORT_EXIT);
      const activation = buildActivation({
        config: { metadata: { marketType: MarketType.FUTURES, leverage: 2 } }
      });

      const result = await service.generateTradeSignal(activation, 10000);

      expect(result.signal?.action).toBe('BUY');
      expect(result.signal?.positionSide).toBe('short');
    });
  });

  describe('mapSignalToAction', () => {
    const mapSignalToAction = (signalType: SignalType, marketType: 'spot' | 'futures') =>
      (service as any).mapSignalToAction(signalType, marketType);

    it('should return null for unmapped signal type', () => {
      const result = mapSignalToAction('UNKNOWN' as SignalType, 'spot');

      expect(result).toBeNull();
    });

    it('should return positionSide long for BUY in futures mode', () => {
      const result = mapSignalToAction(SignalType.BUY, 'futures');

      expect(result).toEqual({ action: 'BUY', positionSide: 'long' });
    });

    it('should return positionSide long for SELL in futures mode', () => {
      const result = mapSignalToAction(SignalType.SELL, 'futures');

      expect(result).toEqual({ action: 'SELL', positionSide: 'long' });
    });
  });

  describe('error resilience', () => {
    it('should skip when algorithm execution fails', async () => {
      mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: false,
        signals: [],
        timestamp: new Date()
      });

      const result = await service.generateTradeSignal(buildActivation(), 10000);

      expect(result.signal).toBeNull();
    });

    it('should default to spot when strategyConfig lookup throws', async () => {
      configureActionableSignal();
      mockStrategyConfigRepo.findOne.mockRejectedValue(new Error('DB timeout'));

      const result = await service.generateTradeSignal(buildActivation(), 10000);

      expect(result.signal?.marketType).toBe('spot');
      expect(result.signal?.leverage).toBe(1);
    });
  });

  describe('exitConfig resolution', () => {
    it('should prefer signal-level exitConfig over result-level', async () => {
      const signalExitConfig = { stopLossPercent: 5, takeProfitPercent: 10 };
      mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          {
            type: SignalType.BUY,
            coinId: 'coin-1',
            strength: 0.8,
            confidence: 0.8,
            reason: 'test',
            exitConfig: signalExitConfig
          }
        ],
        exitConfig: { stopLossPercent: 2, takeProfitPercent: 4 },
        timestamp: new Date()
      });

      const result = await service.generateTradeSignal(buildActivation(), 10000);

      expect(result.signal?.exitConfig).toEqual(signalExitConfig);
    });

    it('should fall back to result-level exitConfig when signal has none', async () => {
      const resultExitConfig = { stopLossPercent: 2, takeProfitPercent: 4 };
      mockAlgorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [{ type: SignalType.BUY, coinId: 'coin-1', strength: 0.8, confidence: 0.8, reason: 'test' }],
        exitConfig: resultExitConfig,
        timestamp: new Date()
      });

      const result = await service.generateTradeSignal(buildActivation(), 10000);

      expect(result.signal?.exitConfig).toEqual(resultExitConfig);
    });
  });

  describe('throttle state cap eviction', () => {
    it('should evict oldest states when exceeding MAX_THROTTLE_STATES but preserve requesting activation', async () => {
      configureActionableSignal();

      // Fill past the cap (MAX_THROTTLE_STATES = 1000)
      for (let i = 0; i < 1001; i++) {
        await service.generateTradeSignal(buildActivation({ id: `act-${i}` }), 10000);
      }
      expect(mockSignalThrottle.createState).toHaveBeenCalledTimes(1001);

      // Next call triggers eviction; the requesting activation should get its state preserved
      await service.generateTradeSignal(buildActivation({ id: 'act-1001' }), 10000);
      const totalCreates = mockSignalThrottle.createState.mock.calls.length;
      // 1001 initial + 1 for the new activation
      expect(totalCreates).toBe(1002);

      // Oldest entries (act-0, act-1, …) should have been evicted — calling them creates new state
      mockSignalThrottle.createState.mockClear();
      await service.generateTradeSignal(buildActivation({ id: 'act-0' }), 10000);
      expect(mockSignalThrottle.createState).toHaveBeenCalledTimes(1);
    });
  });

  describe('pruneThrottleStates', () => {
    it('should remove states for inactive activations', async () => {
      configureActionableSignal();
      await service.generateTradeSignal(buildActivation({ id: 'act-1' }), 10000);
      await service.generateTradeSignal(buildActivation({ id: 'act-2' }), 10000);

      expect(mockSignalThrottle.createState).toHaveBeenCalledTimes(2);

      service.pruneThrottleStates(new Set(['act-1']));

      // act-2 was pruned — generating signal for it should create a new state
      await service.generateTradeSignal(buildActivation({ id: 'act-2' }), 10000);
      expect(mockSignalThrottle.createState).toHaveBeenCalledTimes(3);

      // act-1 was kept — no new state created
      await service.generateTradeSignal(buildActivation({ id: 'act-1' }), 10000);
      expect(mockSignalThrottle.createState).toHaveBeenCalledTimes(3);
    });
  });
});
