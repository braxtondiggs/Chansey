import { ForcedExitService } from './forced-exit.service';

import { Coin } from '../../../../coin/coin.entity';
import { BacktestTrade, TradeType } from '../../backtest-trade.entity';
import { BacktestExitTracker } from '../exits';
import { Portfolio, PortfolioStateService } from '../portfolio';
import { PositionManagerService } from '../positions';
import { MarketData } from '../types';

describe('ForcedExitService', () => {
  let service: ForcedExitService;
  let positionManager: PositionManagerService;
  let portfolioState: PortfolioStateService;

  const quoteCoin = { id: 'usd', slug: 'usd', name: 'USD' } as Coin;

  beforeEach(() => {
    positionManager = new PositionManagerService();
    portfolioState = new PortfolioStateService();
    service = new ForcedExitService(positionManager, portfolioState);
  });

  const makePortfolio = (overrides: Partial<Portfolio> = {}): Portfolio => ({
    cashBalance: 10000,
    totalValue: 15000,
    positions: new Map(),
    totalMarginUsed: 0,
    availableMargin: 10000,
    ...overrides
  });

  const makeMarketData = (prices: Record<string, number>): MarketData => ({
    timestamp: new Date('2024-01-01'),
    prices: new Map(Object.entries(prices))
  });

  const makeCoin = (id: string): Coin => ({ id, slug: id, name: id }) as Coin;

  describe('checkAndApplyLiquidations', () => {
    it('should skip positions that are non-leveraged or missing price data', () => {
      const portfolio = makePortfolio({
        positions: new Map([
          [
            'no-leverage',
            {
              coinId: 'no-leverage',
              quantity: 10,
              averagePrice: 100,
              totalValue: 1000,
              side: 'long' as const,
              leverage: 1
            }
          ],
          [
            'undefined-leverage',
            {
              coinId: 'undefined-leverage',
              quantity: 10,
              averagePrice: 100,
              totalValue: 1000,
              side: 'long' as const
            }
          ],
          [
            'no-price',
            {
              coinId: 'no-price',
              quantity: 10,
              averagePrice: 100,
              totalValue: 1000,
              side: 'long' as const,
              leverage: 5,
              marginAmount: 200,
              liquidationPrice: 85
            }
          ]
        ])
      });
      // Only provide price for 'no-leverage' and 'undefined-leverage', not 'no-price'
      const marketData = makeMarketData({ 'no-leverage': 50, 'undefined-leverage': 50 });

      const result = service.checkAndApplyLiquidations(portfolio, marketData, 0.001, new Map(), quoteCoin);

      expect(result).toHaveLength(0);
      expect(portfolio.positions.size).toBe(3); // All positions remain
    });

    it('should liquidate a long position when price breaches liquidation level', () => {
      const coinMap = new Map([['btc', makeCoin('btc')]]);
      const portfolio = makePortfolio({
        positions: new Map([
          [
            'btc',
            {
              coinId: 'btc',
              quantity: 1,
              averagePrice: 50000,
              totalValue: 50000,
              side: 'long' as const,
              leverage: 10,
              marginAmount: 5000,
              liquidationPrice: 45250 // from PositionManagerService calculation
            }
          ]
        ]),
        totalMarginUsed: 5000,
        availableMargin: 5000
      });
      const marketData = makeMarketData({ btc: 44000 }); // below liquidation price

      const result = service.checkAndApplyLiquidations(portfolio, marketData, 0.001, coinMap, quoteCoin);

      expect(result).toHaveLength(1);
      const trade = result[0] as Partial<BacktestTrade>;
      expect(trade.type).toBe(TradeType.SELL);
      expect(trade.quantity).toBe(1);
      expect(trade.price).toBe(44000);
      expect(trade.totalValue).toBe(0);
      expect(trade.fee).toBe(0);
      expect(trade.realizedPnL).toBe(-5000);
      expect(trade.realizedPnLPercent).toBe(-1);
      expect(trade.leverage).toBe(10);
      expect(trade.metadata).toEqual({ liquidated: true });
      expect(trade.baseCoin).toBe(coinMap.get('btc'));
      expect(trade.quoteCoin).toBe(quoteCoin);

      // Position removed
      expect(portfolio.positions.size).toBe(0);
      // Margin tracking updated
      expect(portfolio.totalMarginUsed).toBe(0);
      expect(portfolio.availableMargin).toBe(portfolio.cashBalance);
    });

    it('should liquidate a short position with TradeType.BUY', () => {
      const portfolio = makePortfolio({
        positions: new Map([
          [
            'eth',
            {
              coinId: 'eth',
              quantity: 10,
              averagePrice: 3000,
              totalValue: 30000,
              side: 'short' as const,
              leverage: 5,
              marginAmount: 6000,
              liquidationPrice: 3500
            }
          ]
        ]),
        totalMarginUsed: 6000
      });
      const marketData = makeMarketData({ eth: 3600 }); // above short liquidation price

      const result = service.checkAndApplyLiquidations(portfolio, marketData, 0.001, new Map(), quoteCoin);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe(TradeType.BUY); // Short liquidation = BUY
      expect(result[0].positionSide).toBe('short');
      expect(result[0].realizedPnL).toBe(-6000);
      expect(portfolio.positions.size).toBe(0);
      expect(portfolio.totalMarginUsed).toBe(0);
    });

    it('should liquidate only breached positions in a mixed portfolio', () => {
      const portfolio = makePortfolio({
        positions: new Map([
          [
            'btc',
            {
              coinId: 'btc',
              quantity: 1,
              averagePrice: 50000,
              totalValue: 50000,
              side: 'long' as const,
              leverage: 10,
              marginAmount: 5000,
              liquidationPrice: 45250
            }
          ],
          [
            'eth',
            {
              coinId: 'eth',
              quantity: 10,
              averagePrice: 3000,
              totalValue: 30000,
              side: 'long' as const,
              leverage: 5,
              marginAmount: 6000,
              liquidationPrice: 2500
            }
          ]
        ]),
        totalMarginUsed: 11000
      });
      // BTC breached, ETH safe
      const marketData = makeMarketData({ btc: 44000, eth: 3200 });

      const result = service.checkAndApplyLiquidations(portfolio, marketData, 0.001, new Map(), quoteCoin);

      expect(result).toHaveLength(1);
      expect(result[0].price).toBe(44000); // BTC liquidated
      expect(portfolio.positions.size).toBe(1); // ETH remains
      expect(portfolio.positions.has('eth')).toBe(true);
      expect(portfolio.totalMarginUsed).toBe(6000); // Only BTC margin removed
    });
  });

  describe('checkAndApplyDelistingExits', () => {
    it('should create trades with penalty price and update portfolio', () => {
      const portfolio = makePortfolio({
        positions: new Map([
          [
            'coin-1',
            {
              coinId: 'coin-1',
              quantity: 10,
              averagePrice: 100,
              totalValue: 1000,
              side: 'long' as const
            }
          ]
        ])
      });
      const delistingDates = new Map([['coin-1', new Date('2024-01-01')]]);
      const lastKnownPrices = new Map([['coin-1', 100]]);
      const timestamp = new Date('2024-01-02');
      const coinMap = new Map([['coin-1', makeCoin('coin-1')]]);

      const result = service.checkAndApplyDelistingExits(
        portfolio,
        delistingDates,
        lastKnownPrices,
        timestamp,
        0.9,
        null,
        coinMap,
        quoteCoin
      );

      expect(result).toHaveLength(1);
      const trade = result[0] as Partial<BacktestTrade>;
      expect(trade.type).toBe(TradeType.SELL);
      expect(trade.price).toBeCloseTo(10, 10); // 100 * (1 - 0.9)
      expect(trade.quantity).toBe(10);
      expect(trade.fee).toBe(0);
      expect(trade.metadata).toEqual(
        expect.objectContaining({
          delistingExit: true,
          penaltyRate: 0.9
        })
      );
      expect(portfolio.positions.size).toBe(0);
      expect(portfolio.cashBalance).toBe(10100); // 10000 + (10 * 10)
    });

    it('should not exit positions before delisting date', () => {
      const portfolio = makePortfolio({
        positions: new Map([
          [
            'coin-1',
            {
              coinId: 'coin-1',
              quantity: 10,
              averagePrice: 100,
              totalValue: 1000,
              side: 'long' as const
            }
          ]
        ])
      });
      const delistingDates = new Map([['coin-1', new Date('2024-06-01')]]);
      const lastKnownPrices = new Map([['coin-1', 100]]);
      const timestamp = new Date('2024-01-01');

      const result = service.checkAndApplyDelistingExits(
        portfolio,
        delistingDates,
        lastKnownPrices,
        timestamp,
        0.9,
        null,
        new Map(),
        quoteCoin
      );

      expect(result).toHaveLength(0);
      expect(portfolio.positions.size).toBe(1);
    });

    it('should remove position from exit tracker when delisted', () => {
      const portfolio = makePortfolio({
        positions: new Map([
          [
            'coin-1',
            {
              coinId: 'coin-1',
              quantity: 10,
              averagePrice: 100,
              totalValue: 1000,
              side: 'long' as const
            }
          ]
        ])
      });
      const delistingDates = new Map([['coin-1', new Date('2024-01-01')]]);
      const lastKnownPrices = new Map([['coin-1', 100]]);
      const exitTracker = new BacktestExitTracker({
        enableStopLoss: true,
        enableTakeProfit: false,
        enableTrailingStop: false,
        stopLossValue: 5
      } as any);
      exitTracker.onBuy('coin-1', 100, 10);
      const removePositionSpy = jest.spyOn(exitTracker, 'removePosition');

      service.checkAndApplyDelistingExits(
        portfolio,
        delistingDates,
        lastKnownPrices,
        new Date('2024-01-02'),
        0.9,
        exitTracker,
        new Map(),
        quoteCoin
      );

      expect(removePositionSpy).toHaveBeenCalledWith('coin-1');
    });

    it('should use averagePrice as fallback when lastKnownPrice is missing', () => {
      const portfolio = makePortfolio({
        positions: new Map([
          [
            'coin-1',
            {
              coinId: 'coin-1',
              quantity: 10,
              averagePrice: 200,
              totalValue: 2000,
              side: 'long' as const
            }
          ]
        ])
      });
      const delistingDates = new Map([['coin-1', new Date('2024-01-01')]]);
      const lastKnownPrices = new Map<string, number>(); // empty — no known price

      const result = service.checkAndApplyDelistingExits(
        portfolio,
        delistingDates,
        lastKnownPrices,
        new Date('2024-01-02'),
        0.9,
        null,
        new Map(),
        quoteCoin
      );

      expect(result).toHaveLength(1);
      // Falls back to averagePrice (200), penalty price = 200 * (1 - 0.9) = 20
      expect(result[0].price).toBeCloseTo(20, 10);
      expect(result[0].metadata).toEqual(expect.objectContaining({ lastKnownPrice: 200 }));
    });

    it('should calculate short position P&L correctly (profit when price drops)', () => {
      const portfolio = makePortfolio({
        positions: new Map([
          [
            'coin-1',
            {
              coinId: 'coin-1',
              quantity: 10,
              averagePrice: 100,
              totalValue: 1000,
              side: 'short' as const
            }
          ]
        ])
      });
      const delistingDates = new Map([['coin-1', new Date('2024-01-01')]]);
      const lastKnownPrices = new Map([['coin-1', 100]]);

      const result = service.checkAndApplyDelistingExits(
        portfolio,
        delistingDates,
        lastKnownPrices,
        new Date('2024-01-02'),
        0.9,
        null,
        new Map(),
        quoteCoin
      );

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe(TradeType.BUY); // Short exit = BUY
      expect(result[0].positionSide).toBe('short');
      // Short P&L: costBasis(1000) - totalValue(100) = 900 profit
      expect(result[0].realizedPnL).toBe(900);
    });

    it.each([
      { penalty: 1.5, expectedPrice: 0, desc: 'penalty > 1 clamped to 1' },
      { penalty: -0.5, expectedPrice: 100, desc: 'negative penalty clamped to 0' },
      { penalty: NaN, expectedPrice: 10, desc: 'NaN penalty defaults to 0.9' },
      { penalty: Infinity, expectedPrice: 10, desc: 'Infinity penalty defaults to 0.9' }
    ])('should handle invalid penalty: $desc', ({ penalty, expectedPrice }) => {
      const portfolio = makePortfolio({
        positions: new Map([
          [
            'coin-1',
            {
              coinId: 'coin-1',
              quantity: 10,
              averagePrice: 100,
              totalValue: 1000,
              side: 'long' as const
            }
          ]
        ])
      });
      const delistingDates = new Map([['coin-1', new Date('2024-01-01')]]);
      const lastKnownPrices = new Map([['coin-1', 100]]);

      const result = service.checkAndApplyDelistingExits(
        portfolio,
        delistingDates,
        lastKnownPrices,
        new Date('2024-01-02'),
        penalty,
        null,
        new Map(),
        quoteCoin
      );

      expect(result).toHaveLength(1);
      expect(result[0].price).toBeCloseTo(expectedPrice, 8);
    });
  });
});
