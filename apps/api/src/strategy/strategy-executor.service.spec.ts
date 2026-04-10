import { Test, type TestingModule } from '@nestjs/testing';

import { CompositeRegimeType, MarketRegimeType } from '@chansey/api-interfaces';

import { type MarketData, StrategyExecutorService, type TradingSignal } from './strategy-executor.service';

import {
  type TradingSignal as AlgorithmTradingSignal,
  SignalType
} from '../algorithm/interfaces/algorithm-result.interface';
import { AlgorithmRegistry } from '../algorithm/registry/algorithm-registry.service';
import { AlgorithmContextBuilder } from '../algorithm/services/algorithm-context-builder.service';
import { type Coin } from '../coin/coin.entity';
import { CompositeRegimeService } from '../market-regime/composite-regime.service';
import { MetricsService } from '../metrics/metrics.service';
import { SignalThrottleService } from '../order/backtest/shared/throttle';

// ---------------------------------------------------------------------------
// Shared mock factory – eliminates duplication across describe blocks
// ---------------------------------------------------------------------------
interface MockBundle {
  service: StrategyExecutorService;
  algorithmRegistry: jest.Mocked<AlgorithmRegistry>;
  algorithmContextBuilder: jest.Mocked<AlgorithmContextBuilder>;
  signalThrottle: {
    createState: jest.Mock;
    resolveConfig: jest.Mock;
    filterSignals: jest.Mock;
    toThrottleSignal: jest.Mock;
  };
  compositeRegimeService: {
    getCompositeRegime: jest.Mock;
    getVolatilityRegime: jest.Mock;
  };
}

async function createMockModule(
  coins: Partial<Coin>[] = [{ id: 'btc-id', symbol: 'BTC' }],
  overrides?: {
    signalThrottle?: Partial<MockBundle['signalThrottle']>;
  }
): Promise<MockBundle> {
  const algorithmRegistry = {
    executeAlgorithm: jest.fn()
  } as unknown as jest.Mocked<AlgorithmRegistry>;

  const algorithmContextBuilder = {
    buildContext: jest.fn().mockResolvedValue({
      config: {},
      coins,
      availableBalance: 0,
      positions: {}
    })
  } as unknown as jest.Mocked<AlgorithmContextBuilder>;

  const signalThrottle = {
    createState: jest.fn().mockReturnValue({ lastSignalTime: {}, tradeTimestamps: [] }),
    resolveConfig: jest.fn().mockReturnValue({ cooldownMs: 86_400_000, maxTradesPerDay: 6, minSellPercent: 0.5 }),
    filterSignals: jest.fn().mockImplementation((signals) => ({ accepted: signals, rejected: [] })),
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
    }),
    ...overrides?.signalThrottle
  };

  const compositeRegimeService = {
    getCompositeRegime: jest.fn().mockReturnValue(CompositeRegimeType.NEUTRAL),
    getVolatilityRegime: jest.fn().mockReturnValue(MarketRegimeType.NORMAL)
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      StrategyExecutorService,
      { provide: AlgorithmRegistry, useValue: algorithmRegistry },
      { provide: AlgorithmContextBuilder, useValue: algorithmContextBuilder },
      { provide: SignalThrottleService, useValue: signalThrottle },
      { provide: CompositeRegimeService, useValue: compositeRegimeService },
      {
        provide: MetricsService,
        useValue: {
          recordSignalThrottleSuppressed: jest.fn(),
          recordSignalThrottlePassed: jest.fn()
        }
      }
    ]
  }).compile();

  return {
    service: module.get(StrategyExecutorService),
    algorithmRegistry,
    algorithmContextBuilder,
    signalThrottle,
    compositeRegimeService
  };
}

/**
 * Helper to invoke the private mapAlgorithmSignal via executeStrategy.
 * We mock the algorithm registry to return the signal we want, then call
 * executeStrategy which internally calls mapAlgorithmSignal.
 */
describe('StrategyExecutorService – per-trade position cap', () => {
  let service: StrategyExecutorService;
  let algorithmRegistry: jest.Mocked<AlgorithmRegistry>;

  const coin: Partial<Coin> = { id: 'btc-id', symbol: 'BTC' };

  beforeEach(async () => {
    const mocks = await createMockModule([coin]);
    service = mocks.service;
    algorithmRegistry = mocks.algorithmRegistry;
  });

  /** Helper: execute a strategy that returns a single signal with given params */
  async function executeWithSignal(
    signalOverrides: Partial<AlgorithmTradingSignal>,
    availableCapital: number,
    price = 50000
  ) {
    const signal: AlgorithmTradingSignal = {
      type: SignalType.BUY,
      coinId: 'btc-id',
      strength: 1.0,
      confidence: 0.9,
      reason: 'test',
      ...signalOverrides
    };

    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [signal],
      timestamp: new Date()
    });

    const marketData: MarketData[] = [{ symbol: 'BTC/USDT', price, timestamp: new Date() }];

    const result = await service.executeStrategy(
      { id: 'strat-1', algorithm: { id: 'algo-1' }, parameters: {} } as any,
      marketData,
      [],
      availableCapital
    );

    return result;
  }

  it.each([
    {
      scenario: 'caps buy quantity exceeding 20% of allocated capital',
      signalOverrides: { strength: 1.0 },
      availableCapital: 10000,
      price: 50000,
      expectedAction: 'buy' as const,
      expectedQuantity: 0.04 // 20% of 10000 / 50000
    },
    {
      scenario: 'applies 5% minimum floor to small buy signals',
      signalOverrides: { strength: 0.01 },
      availableCapital: 10000,
      price: 50000,
      expectedAction: 'buy' as const,
      expectedQuantity: 0.01 // 5% of 10000 / 50000
    },
    {
      scenario: 'passes through signals within 5%-20% range',
      signalOverrides: { strength: 0.1 },
      availableCapital: 10000,
      price: 50000,
      expectedAction: 'buy' as const,
      expectedQuantity: 0.02 // (10000 * 0.10) / 50000 = 0.02, within range
    },
    {
      scenario: 'caps explicit signal.quantity when it exceeds 20%',
      signalOverrides: { quantity: 0.1 },
      availableCapital: 10000,
      price: 50000,
      expectedAction: 'buy' as const,
      expectedQuantity: 0.04 // explicit 0.1 BTC at 50000 = $5000 = 50%, capped to 20% -> 0.04
    }
  ])('$scenario', async ({ signalOverrides, availableCapital, price, expectedAction, expectedQuantity }) => {
    const result = await executeWithSignal(signalOverrides, availableCapital, price);

    if (!result) throw new Error('expected result');
    expect(result.action).toBe(expectedAction);
    expect(result.quantity).toBeCloseTo(expectedQuantity, 8);
  });

  it('does not cap sell signals', async () => {
    // Sell with quantity that would exceed 20% cap — should pass through
    const result = await executeWithSignal({ type: SignalType.SELL, strength: 1.0, quantity: 0.5 }, 10000, 50000);

    if (!result) throw new Error('expected result');
    expect(result.action).toBe('sell');
    expect(result.quantity).toBe(0.5); // Not capped
  });
});

describe('StrategyExecutorService – signal throttle integration', () => {
  let service: StrategyExecutorService;
  let algorithmRegistry: jest.Mocked<AlgorithmRegistry>;
  let signalThrottle: MockBundle['signalThrottle'];

  const coins: Partial<Coin>[] = [
    { id: 'btc-id', symbol: 'BTC' },
    { id: 'eth-id', symbol: 'ETH' }
  ];

  const strategy = {
    id: 'strat-1',
    algorithm: { id: 'algo-1' },
    parameters: { cooldownMs: 3600_000 }
  } as any;

  const marketData: MarketData[] = [
    { symbol: 'BTC/USDT', price: 50000, timestamp: new Date() },
    { symbol: 'ETH/USDT', price: 3000, timestamp: new Date() }
  ];

  beforeEach(async () => {
    const mocks = await createMockModule(coins);
    service = mocks.service;
    algorithmRegistry = mocks.algorithmRegistry;
    signalThrottle = mocks.signalThrottle;
  });

  it('calls filterSignals with correct args and converted signals', async () => {
    const btcSignal: AlgorithmTradingSignal = {
      type: SignalType.BUY,
      coinId: 'btc-id',
      strength: 0.5,
      confidence: 0.9,
      reason: 'bullish'
    };

    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [btcSignal],
      timestamp: new Date()
    });

    await service.executeStrategy(strategy, marketData, [], 10000);

    expect(signalThrottle.resolveConfig).toHaveBeenCalledWith(strategy.parameters);
    expect(signalThrottle.filterSignals).toHaveBeenCalledTimes(1);

    const [signals] = signalThrottle.filterSignals.mock.calls[0];
    expect(signals).toHaveLength(1);
    expect(signals[0]).toEqual(
      expect.objectContaining({
        action: 'BUY',
        coinId: 'btc-id',
        originalType: SignalType.BUY
      })
    );
  });

  it('returns null when all signals are throttled', async () => {
    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [{ type: SignalType.BUY, coinId: 'btc-id', strength: 0.5, confidence: 0.9, reason: 'buy' }],
      timestamp: new Date()
    });

    signalThrottle.filterSignals.mockReturnValue({ accepted: [], rejected: [] });

    const result = await service.executeStrategy(strategy, marketData, [], 10000);

    expect(result).toBeNull();
  });

  it('falls back to second-best signal when best is throttled', async () => {
    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [
        { type: SignalType.BUY, coinId: 'btc-id', strength: 0.8, confidence: 0.95, reason: 'btc buy' },
        { type: SignalType.BUY, coinId: 'eth-id', strength: 0.6, confidence: 0.85, reason: 'eth buy' }
      ],
      timestamp: new Date()
    });

    // Filter out BTC, keep ETH
    signalThrottle.filterSignals.mockImplementation((signals: any[]) => ({
      accepted: signals.filter((s: any) => s.coinId !== 'btc-id'),
      rejected: signals.filter((s: any) => s.coinId === 'btc-id')
    }));

    const result = await service.executeStrategy(strategy, marketData, [], 10000);

    if (!result) throw new Error('expected result');
    expect(result.symbol).toBe('ETH/USDT');
  });

  it('preserves originalType for STOP_LOSS bypass', async () => {
    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [
        {
          type: SignalType.STOP_LOSS,
          coinId: 'btc-id',
          strength: 1.0,
          confidence: 1.0,
          reason: 'stop loss',
          quantity: 0.1
        }
      ],
      timestamp: new Date()
    });

    await service.executeStrategy(strategy, marketData, [], 10000);

    const [signals] = signalThrottle.filterSignals.mock.calls[0];
    expect(signals[0].originalType).toBe(SignalType.STOP_LOSS);
    expect(signals[0].action).toBe('SELL');
  });
});

describe('StrategyExecutorService – validateSignal', () => {
  let service: StrategyExecutorService;

  beforeEach(async () => {
    const mocks = await createMockModule();
    service = mocks.service;
  });

  it('returns invalid when signal is null', () => {
    const result = service.validateSignal(null as unknown as TradingSignal, 10000);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('No signal provided');
  });

  it('returns invalid when signal is undefined', () => {
    const result = service.validateSignal(undefined as unknown as TradingSignal, 10000);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('No signal provided');
  });

  it('returns valid for hold action without further validation', () => {
    const signal: TradingSignal = {
      action: 'hold',
      symbol: 'BTC/USDT',
      quantity: 0,
      price: 0
    };

    const result = service.validateSignal(signal, 10000);

    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns invalid when quantity is zero', () => {
    const signal: TradingSignal = {
      action: 'buy',
      symbol: 'BTC/USDT',
      quantity: 0,
      price: 50000
    };

    const result = service.validateSignal(signal, 10000);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Quantity must be greater than 0');
  });

  it('returns invalid when quantity is negative', () => {
    const signal: TradingSignal = {
      action: 'buy',
      symbol: 'BTC/USDT',
      quantity: -0.1,
      price: 50000
    };

    const result = service.validateSignal(signal, 10000);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Quantity must be greater than 0');
  });

  it('returns invalid when price is zero', () => {
    const signal: TradingSignal = {
      action: 'buy',
      symbol: 'BTC/USDT',
      quantity: 0.1,
      price: 0
    };

    const result = service.validateSignal(signal, 10000);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Price must be greater than 0');
  });

  it('returns invalid when price is negative', () => {
    const signal: TradingSignal = {
      action: 'buy',
      symbol: 'BTC/USDT',
      quantity: 0.1,
      price: -100
    };

    const result = service.validateSignal(signal, 10000);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Price must be greater than 0');
  });

  it('returns invalid when buy cost exceeds available capital', () => {
    const signal: TradingSignal = {
      action: 'buy',
      symbol: 'BTC/USDT',
      quantity: 1,
      price: 50000
      // cost = 50000, capital = 10000
    };

    const result = service.validateSignal(signal, 10000);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Insufficient capital');
    expect(result.reason).toContain('50000.00');
    expect(result.reason).toContain('10000.00');
  });

  it('returns valid for a buy within available capital', () => {
    const signal: TradingSignal = {
      action: 'buy',
      symbol: 'BTC/USDT',
      quantity: 0.1,
      price: 50000
      // cost = 5000 <= 10000
    };

    const result = service.validateSignal(signal, 10000);

    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns invalid for short_entry exceeding available capital', () => {
    const signal: TradingSignal = {
      action: 'short_entry',
      symbol: 'BTC/USDT',
      quantity: 1,
      price: 50000
      // cost = 50000, capital = 10000
    };

    const result = service.validateSignal(signal, 10000);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Insufficient capital');
  });

  it('does not check capital for sell signals', () => {
    const signal: TradingSignal = {
      action: 'sell',
      symbol: 'BTC/USDT',
      quantity: 10,
      price: 50000
      // cost would be 500000, but sell should not be checked
    };

    const result = service.validateSignal(signal, 100);

    expect(result.valid).toBe(true);
  });

  it('does not check capital for short_exit signals', () => {
    const signal: TradingSignal = {
      action: 'short_exit',
      symbol: 'BTC/USDT',
      quantity: 10,
      price: 50000
    };

    const result = service.validateSignal(signal, 100);

    expect(result.valid).toBe(true);
  });
});

describe('StrategyExecutorService – executeStrategy edge cases', () => {
  let service: StrategyExecutorService;
  let algorithmRegistry: jest.Mocked<AlgorithmRegistry>;

  const strategy = {
    id: 'strat-1',
    algorithm: { id: 'algo-1' },
    parameters: {}
  } as any;

  const marketData: MarketData[] = [{ symbol: 'BTC/USDT', price: 50000, timestamp: new Date() }];

  beforeEach(async () => {
    const mocks = await createMockModule([{ id: 'btc-id', symbol: 'BTC' }]);
    service = mocks.service;
    algorithmRegistry = mocks.algorithmRegistry;
  });

  it('returns null when algorithm returns success: false', async () => {
    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: false,
      signals: [],
      timestamp: new Date()
    });

    const result = await service.executeStrategy(strategy, marketData, [], 10000);

    expect(result).toBeNull();
  });

  it('returns null when algorithm returns empty signals array', async () => {
    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [],
      timestamp: new Date()
    });

    const result = await service.executeStrategy(strategy, marketData, [], 10000);

    expect(result).toBeNull();
  });

  it('returns null when all signals are below confidence threshold', async () => {
    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [
        {
          type: SignalType.BUY,
          coinId: 'btc-id',
          strength: 0.8,
          confidence: 0.3, // Below MIN_CONFIDENCE_THRESHOLD of 0.5
          reason: 'low confidence signal'
        }
      ],
      timestamp: new Date()
    });

    const result = await service.executeStrategy(strategy, marketData, [], 10000);

    expect(result).toBeNull();
  });

  it('returns null when algorithm throws an error', async () => {
    algorithmRegistry.executeAlgorithm.mockRejectedValue(new Error('Algorithm crashed'));

    const result = await service.executeStrategy(strategy, marketData, [], 10000);

    expect(result).toBeNull();
  });

  it('returns null when coinId does not match any coin in context', async () => {
    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [
        {
          type: SignalType.BUY,
          coinId: 'unknown-coin-id', // Not in context coins
          strength: 0.8,
          confidence: 0.9,
          reason: 'buy unknown'
        }
      ],
      timestamp: new Date()
    });

    const result = await service.executeStrategy(strategy, marketData, [], 10000);

    expect(result).toBeNull();
  });

  it('applies cap to short_entry signals same as buy', async () => {
    // strength=1.0 -> uncapped quantity would be (10000 * 1.0) / 50000 = 0.2 BTC
    // 20% cap -> max quantity = (10000 * 0.20) / 50000 = 0.04 BTC
    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [
        {
          type: SignalType.SHORT_ENTRY,
          coinId: 'btc-id',
          strength: 1.0,
          confidence: 0.9,
          reason: 'short entry test'
        }
      ],
      timestamp: new Date()
    });

    const result = await service.executeStrategy(strategy, marketData, [], 10000);

    if (!result) throw new Error('expected result');
    expect(result.action).toBe('short_entry');
    expect(result.quantity).toBeCloseTo(0.04, 8); // 20% of 10000 / 50000
  });
});
