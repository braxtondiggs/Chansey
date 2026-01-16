import { BacktestEngine, MarketData, Portfolio, TradingSignal } from './backtest-engine.service';
import { SlippageModelType } from './slippage-model';

import { AlgorithmNotRegisteredException } from '../../common/exceptions';
import { SharpeRatioCalculator } from '../../common/metrics/sharpe-ratio.calculator';
import { OHLCCandle } from '../../ohlc/ohlc-candle.entity';

describe('BacktestEngine.executeTrade', () => {
  const createEngine = () =>
    new BacktestEngine({} as any, {} as any, {} as any, {} as any, {} as any, new SharpeRatioCalculator(), {} as any);

  const createMarketData = (coinId: string, price: number): MarketData => ({
    timestamp: new Date(),
    prices: new Map([[coinId, price]])
  });

  const noSlippage = { type: SlippageModelType.NONE };

  it('calculates realized P&L for partial sells', async () => {
    const engine = createEngine();
    const portfolio: Portfolio = {
      cashBalance: 0,
      totalValue: 100,
      positions: new Map([
        [
          'BTC',
          {
            coinId: 'BTC',
            quantity: 10,
            averagePrice: 10,
            totalValue: 100
          }
        ]
      ])
    };
    const random = () => 0.5;

    const sellSignal: TradingSignal = {
      action: 'SELL',
      coinId: 'BTC',
      quantity: 4,
      reason: 'take-profit',
      confidence: 1
    };

    const result = await (engine as any).executeTrade(
      sellSignal,
      portfolio,
      createMarketData('BTC', 15),
      0,
      random,
      noSlippage
    );

    expect(result).toBeTruthy();
    expect(result.trade.realizedPnL).toBeCloseTo(20);
    expect(result.trade.realizedPnLPercent).toBeCloseTo(0.5);
    expect(result.trade.costBasis).toBeCloseTo(10);

    const position = portfolio.positions.get('BTC');
    expect(position?.quantity).toBeCloseTo(6);
  });

  it('applies slippage and trading fees to BUY trades', async () => {
    const engine = createEngine();
    const portfolio: Portfolio = {
      cashBalance: 200,
      totalValue: 200,
      positions: new Map()
    };

    const buySignal: TradingSignal = {
      action: 'BUY',
      coinId: 'BTC',
      quantity: 1,
      reason: 'entry',
      confidence: 0.8
    };

    const result = await (engine as any).executeTrade(
      buySignal,
      portfolio,
      createMarketData('BTC', 100),
      0.01,
      { next: () => 0.5 },
      { type: SlippageModelType.FIXED, fixedBps: 100 }
    );

    expect(result?.trade.price).toBeCloseTo(101);
    expect(result?.trade.fee).toBeCloseTo(1.01);
    expect(result?.trade.metadata?.basePrice).toBe(100);
    expect(result?.trade.metadata?.slippageBps).toBe(100);
    expect(portfolio.cashBalance).toBeCloseTo(97.99);
  });

  it('uses slippage-adjusted price for SELL realized P&L', async () => {
    const engine = createEngine();
    const portfolio: Portfolio = {
      cashBalance: 0,
      totalValue: 80,
      positions: new Map([
        [
          'BTC',
          {
            coinId: 'BTC',
            quantity: 1,
            averagePrice: 80,
            totalValue: 80
          }
        ]
      ])
    };

    const sellSignal: TradingSignal = {
      action: 'SELL',
      coinId: 'BTC',
      quantity: 1,
      reason: 'exit',
      confidence: 1
    };

    const result = await (engine as any).executeTrade(
      sellSignal,
      portfolio,
      createMarketData('BTC', 100),
      0.01,
      { next: () => 0.5 },
      { type: SlippageModelType.FIXED, fixedBps: 100 }
    );

    expect(result?.trade.price).toBeCloseTo(99);
    expect(result?.trade.realizedPnL).toBeCloseTo(18.01);
    expect(result?.trade.costBasis).toBeCloseTo(80);
  });
});

describe('BacktestEngine.executeOptimizationBacktest', () => {
  const createEngine = (algorithmRegistry: any, ohlcService: any) =>
    new BacktestEngine(
      {} as any,
      algorithmRegistry,
      {} as any,
      ohlcService,
      {} as any,
      new SharpeRatioCalculator(),
      {} as any
    );

  it('rethrows AlgorithmNotRegisteredException', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockRejectedValue(new AlgorithmNotRegisteredException('algo-1'))
    };
    const startDate = new Date('2024-01-01T00:00:00.000Z');
    const endDate = new Date('2024-01-02T00:00:00.000Z');
    const candle = new OHLCCandle({
      coinId: 'coin-1',
      exchangeId: 'exchange-1',
      timestamp: startDate,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 1000
    });
    const ohlcService = {
      getCandlesByDateRange: jest.fn().mockResolvedValue([candle])
    };
    const engine = createEngine(algorithmRegistry, ohlcService);

    const config = {
      algorithmId: 'algo-1',
      parameters: {},
      startDate,
      endDate
    };

    await expect(engine.executeOptimizationBacktest(config, [{ id: 'coin-1' }] as any)).rejects.toBeInstanceOf(
      AlgorithmNotRegisteredException
    );
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledWith(
      'algo-1',
      expect.objectContaining({
        config: {},
        metadata: expect.objectContaining({ isOptimization: true, algorithmId: 'algo-1' })
      })
    );
  });

  it('returns neutral metrics when there is no price data', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn()
    };
    const ohlcService = {
      getCandlesByDateRange: jest.fn().mockResolvedValue([])
    };
    const engine = createEngine(algorithmRegistry, ohlcService);

    const result = await engine.executeOptimizationBacktest(
      {
        algorithmId: 'algo-1',
        parameters: {},
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-02T00:00:00.000Z')
      },
      [{ id: 'coin-1' }] as any
    );

    expect(result).toEqual(
      expect.objectContaining({
        sharpeRatio: 0,
        totalReturn: 0,
        maxDrawdown: 0,
        winRate: 0,
        volatility: 0,
        profitFactor: 1,
        tradeCount: 0
      })
    );
    expect(algorithmRegistry.executeAlgorithm).not.toHaveBeenCalled();
  });
});

describe('BacktestEngine checkpointing', () => {
  const createEngine = () =>
    new BacktestEngine({} as any, {} as any, {} as any, {} as any, {} as any, new SharpeRatioCalculator(), {} as any);

  const createCheckpoint = (engine: BacktestEngine) => {
    const portfolio: Portfolio = {
      cashBalance: 1000,
      totalValue: 1200,
      positions: new Map([
        [
          'BTC',
          {
            coinId: 'BTC',
            quantity: 2,
            averagePrice: 100,
            totalValue: 200
          }
        ]
      ])
    };

    return (engine as any).buildCheckpointState(1, '2024-01-02T00:00:00.000Z', portfolio, 1250, 0.1, 12345, 2, 3, 4, 5);
  };

  it('validates checkpoints with matching checksum', () => {
    const engine = createEngine();
    const checkpoint = createCheckpoint(engine);

    const result = engine.validateCheckpoint(checkpoint, [
      '2024-01-01T00:00:00.000Z',
      '2024-01-02T00:00:00.000Z',
      '2024-01-03T00:00:00.000Z'
    ]);

    expect(result).toEqual({ valid: true });
  });

  it('detects corrupted checkpoints via checksum', () => {
    const engine = createEngine();
    const checkpoint = createCheckpoint(engine);
    checkpoint.portfolio.cashBalance += 10;

    const result = engine.validateCheckpoint(checkpoint, ['2024-01-01T00:00:00.000Z', '2024-01-02T00:00:00.000Z']);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('checksum');
  });

  it('rejects checkpoints with timestamp mismatches', () => {
    const engine = createEngine();
    const checkpoint = createCheckpoint(engine);

    const result = engine.validateCheckpoint(checkpoint, ['2024-01-01T00:00:00.000Z', '2024-01-04T00:00:00.000Z']);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Timestamp mismatch');
  });

  it('rejects checkpoints that are out of bounds', () => {
    const engine = createEngine();
    const checkpoint = createCheckpoint(engine);
    checkpoint.lastProcessedIndex = 5;

    const result = engine.validateCheckpoint(checkpoint, ['2024-01-01T00:00:00.000Z']);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('out of bounds');
  });

  it('restores portfolio state from checkpoint data', () => {
    const engine = createEngine();
    const checkpoint = createCheckpoint(engine);

    const restored = (engine as any).restorePortfolio(checkpoint.portfolio, 1000);

    expect(restored.cashBalance).toBe(1000);
    expect(restored.positions.size).toBe(1);
    expect(restored.positions.get('BTC')).toEqual(
      expect.objectContaining({
        coinId: 'BTC',
        quantity: 2,
        averagePrice: 100,
        totalValue: 200
      })
    );
    expect(restored.totalValue).toBe(1200);
  });
});
