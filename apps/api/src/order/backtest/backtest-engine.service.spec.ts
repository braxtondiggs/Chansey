import { BacktestEngine, MarketData, Portfolio, TradingSignal } from './backtest-engine.service';
import { SlippageModelType } from './slippage-model';

import { AlgorithmNotRegisteredException } from '../../common/exceptions';
import { OHLCCandle } from '../../ohlc/ohlc-candle.entity';

describe('BacktestEngine.executeTrade', () => {
  const createEngine = () => new BacktestEngine({} as any, {} as any, {} as any, {} as any, {} as any);

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
});

describe('BacktestEngine.executeOptimizationBacktest', () => {
  const createEngine = (algorithmRegistry: any, ohlcService: any) =>
    new BacktestEngine({} as any, algorithmRegistry, {} as any, ohlcService, {} as any);

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
});
