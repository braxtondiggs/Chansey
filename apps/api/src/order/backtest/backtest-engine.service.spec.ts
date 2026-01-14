import { BacktestEngine, MarketData, Portfolio, TradingSignal } from './backtest-engine.service';
import { SlippageModelType } from './slippage-model';

describe('BacktestEngine.executeTrade', () => {
  const createEngine = () => new BacktestEngine({} as any, {} as any, {} as any, {} as any, {} as any);

  const createPortfolio = (cashBalance: number): Portfolio => ({
    cashBalance,
    positions: new Map(),
    totalValue: cashBalance
  });

  const createMarketData = (coinId: string, price: number): MarketData => ({
    timestamp: new Date(),
    prices: new Map([[coinId, price]])
  });

  const noSlippage = { type: SlippageModelType.NONE };

  it('tracks cost basis across multiple buys', async () => {
    const engine = createEngine();
    const portfolio = createPortfolio(1000);
    const random = () => 0.5;

    const buySignal: TradingSignal = {
      action: 'BUY',
      coinId: 'BTC',
      quantity: 10,
      reason: 'test',
      confidence: 1
    };

    await (engine as any).executeTrade(buySignal, portfolio, createMarketData('BTC', 10), 0, random, noSlippage);
    await (engine as any).executeTrade(buySignal, portfolio, createMarketData('BTC', 20), 0, random, noSlippage);

    const position = portfolio.positions.get('BTC');
    expect(position).toBeDefined();
    expect(position?.quantity).toBeCloseTo(20);
    expect(position?.averagePrice).toBeCloseTo(15);
  });

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
