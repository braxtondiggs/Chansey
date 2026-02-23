import { Test, TestingModule } from '@nestjs/testing';

import { MarketData, StrategyExecutorService } from './strategy-executor.service';

import {
  TradingSignal as AlgorithmTradingSignal,
  SignalType
} from '../algorithm/interfaces/algorithm-result.interface';
import { AlgorithmRegistry } from '../algorithm/registry/algorithm-registry.service';
import { AlgorithmContextBuilder } from '../algorithm/services/algorithm-context-builder.service';
import { Coin } from '../coin/coin.entity';
import { SignalThrottleService } from '../order/backtest/shared/throttle';

/**
 * Helper to invoke the private mapAlgorithmSignal via executeStrategy.
 * We mock the algorithm registry to return the signal we want, then call
 * executeStrategy which internally calls mapAlgorithmSignal.
 */
describe('StrategyExecutorService – per-trade position cap', () => {
  let service: StrategyExecutorService;
  let algorithmRegistry: jest.Mocked<AlgorithmRegistry>;
  let algorithmContextBuilder: jest.Mocked<AlgorithmContextBuilder>;

  const coin: Partial<Coin> = { id: 'btc-id', symbol: 'BTC' };

  beforeEach(async () => {
    algorithmRegistry = {
      executeAlgorithm: jest.fn()
    } as unknown as jest.Mocked<AlgorithmRegistry>;

    algorithmContextBuilder = {
      buildContext: jest.fn().mockResolvedValue({
        config: {},
        coins: [coin],
        availableBalance: 0,
        positions: {}
      })
    } as unknown as jest.Mocked<AlgorithmContextBuilder>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StrategyExecutorService,
        { provide: AlgorithmRegistry, useValue: algorithmRegistry },
        { provide: AlgorithmContextBuilder, useValue: algorithmContextBuilder },
        { provide: SignalThrottleService, useValue: { createState: jest.fn().mockReturnValue({}) } }
      ]
    }).compile();

    service = module.get(StrategyExecutorService);
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

  it('caps buy quantity exceeding 20% of allocated capital', async () => {
    // strength=1.0 → uncapped quantity would be (10000 * 1.0) / 50000 = 0.2 BTC
    // 20% cap → max quantity = (10000 * 0.20) / 50000 = 0.04 BTC
    const result = await executeWithSignal({ strength: 1.0 }, 10000, 50000);

    expect(result).not.toBeNull();
    expect(result!.action).toBe('buy');
    expect(result!.quantity).toBeCloseTo(0.04, 8); // 20% of 10000 / 50000
  });

  it('does not cap sell signals', async () => {
    // Sell with quantity that would exceed 20% cap — should pass through
    const result = await executeWithSignal({ type: SignalType.SELL, strength: 1.0, quantity: 0.5 }, 10000, 50000);

    expect(result).not.toBeNull();
    expect(result!.action).toBe('sell');
    expect(result!.quantity).toBe(0.5); // Not capped
  });

  it('applies 5% minimum floor to small buy signals', async () => {
    // strength=0.01 → quantity = (10000 * 0.01) / 50000 = 0.002
    // 5% min → min quantity = (10000 * 0.05) / 50000 = 0.01
    const result = await executeWithSignal({ strength: 0.01 }, 10000, 50000);

    expect(result).not.toBeNull();
    expect(result!.action).toBe('buy');
    expect(result!.quantity).toBeCloseTo(0.01, 8); // 5% of 10000 / 50000
  });

  it('passes through signals within 5%-20% range', async () => {
    // strength=0.10 → quantity = (10000 * 0.10) / 50000 = 0.02
    // 5% min = 0.01, 20% max = 0.04 → 0.02 is within range
    const result = await executeWithSignal({ strength: 0.1 }, 10000, 50000);

    expect(result).not.toBeNull();
    expect(result!.action).toBe('buy');
    expect(result!.quantity).toBeCloseTo(0.02, 8); // Untouched
  });

  it('caps explicit signal.quantity when it exceeds 20%', async () => {
    // explicit quantity=0.1 BTC at 50000 = $5000, which is 50% of $10000 capital
    // Should be capped to 20% → 0.04
    const result = await executeWithSignal({ quantity: 0.1 }, 10000, 50000);

    expect(result).not.toBeNull();
    expect(result!.action).toBe('buy');
    expect(result!.quantity).toBeCloseTo(0.04, 8);
  });
});
