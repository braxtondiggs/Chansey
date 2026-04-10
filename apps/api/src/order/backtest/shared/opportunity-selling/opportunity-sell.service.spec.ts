import { Test, type TestingModule } from '@nestjs/testing';

import { OpportunitySellService } from './opportunity-sell.service';

import { type Coin } from '../../../../coin/coin.entity';
import { type OpportunitySellingUserConfig } from '../../../interfaces/opportunity-selling.interface';
import { PositionAnalysisService } from '../../../services/position-analysis.service';
import { type BacktestTrade } from '../../backtest-trade.entity';
import { type Backtest } from '../../backtest.entity';
import { type SimulatedOrderFill, SimulatedOrderStatus } from '../../simulated-order-fill.entity';
import { FeeCalculatorService } from '../fees';
import { type Portfolio } from '../portfolio';
import { type SlippageConfig, SlippageModelType } from '../slippage';
import { type MarketData, type TradingSignal } from '../types';

describe('OpportunitySellService', () => {
  let service: OpportunitySellService;

  const defaultConfig: OpportunitySellingUserConfig = {
    minOpportunityConfidence: 0.7,
    minHoldingPeriodHours: 48,
    protectGainsAbovePercent: 15,
    protectedCoins: [],
    minOpportunityAdvantagePercent: 10,
    maxLiquidationPercent: 30,
    useAlgorithmRanking: true
  };

  const defaultSlippageConfig: SlippageConfig = {
    type: SlippageModelType.FIXED,
    fixedBps: 5
  };

  const mockBacktest = { id: 'bt-1' } as Backtest;
  const mockQuoteCoin = { id: 'usd', slug: 'usd', symbol: 'USD' } as Coin;

  function makePortfolio(cashBalance: number, positions: Map<string, any>): Portfolio {
    let totalPositionValue = 0;
    for (const pos of positions.values()) {
      totalPositionValue += pos.quantity * (pos.averagePrice ?? 0);
    }
    return {
      cashBalance,
      positions,
      totalValue: cashBalance + totalPositionValue
    } as unknown as Portfolio;
  }

  function makeMarketData(prices: Record<string, number>): MarketData {
    return {
      timestamp: new Date('2024-01-15'),
      prices: new Map(Object.entries(prices))
    };
  }

  const noopExecuteTrade = jest.fn().mockResolvedValue(null);
  const noopBuildSpreadContext = jest.fn().mockReturnValue(undefined);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OpportunitySellService, FeeCalculatorService, PositionAnalysisService]
    }).compile();

    service = module.get<OpportunitySellService>(OpportunitySellService);
    noopExecuteTrade.mockClear();
  });

  describe('attemptOpportunitySelling', () => {
    it('should return false when confidence is below threshold', async () => {
      const buySignal: TradingSignal = {
        action: 'BUY',
        coinId: 'ethereum',
        confidence: 0.3, // Below 0.7 threshold
        reason: 'test buy'
      };

      const portfolio = makePortfolio(0, new Map());
      const marketData = makeMarketData({ ethereum: 2000 });

      const result = await service.attemptOpportunitySelling(
        buySignal,
        portfolio,
        marketData,
        0.001,
        defaultSlippageConfig,
        defaultConfig,
        new Map(),
        mockQuoteCoin,
        mockBacktest,
        new Date('2024-01-15'),
        [],
        [],
        noopExecuteTrade,
        noopBuildSpreadContext
      );

      expect(result).toBe(false);
      expect(noopExecuteTrade).not.toHaveBeenCalled();
    });

    it('should return false when cash is sufficient (no shortfall)', async () => {
      const buySignal: TradingSignal = {
        action: 'BUY',
        coinId: 'ethereum',
        confidence: 0.9,
        quantity: 1,
        reason: 'test buy'
      };

      const portfolio = makePortfolio(100000, new Map());
      const marketData = makeMarketData({ ethereum: 2000 });

      const result = await service.attemptOpportunitySelling(
        buySignal,
        portfolio,
        marketData,
        0.001,
        defaultSlippageConfig,
        defaultConfig,
        new Map(),
        mockQuoteCoin,
        mockBacktest,
        new Date('2024-01-15'),
        [],
        [],
        noopExecuteTrade,
        noopBuildSpreadContext
      );

      expect(result).toBe(false);
    });
  });

  describe('scoreEligiblePositions', () => {
    it('should exclude the buy coin from eligible positions', () => {
      const positions = new Map<string, any>([
        [
          'bitcoin',
          {
            coinId: 'bitcoin',
            averagePrice: 40000,
            quantity: 1,
            entryDate: new Date('2024-01-01')
          }
        ],
        [
          'ethereum',
          {
            coinId: 'ethereum',
            averagePrice: 1800,
            quantity: 5,
            entryDate: new Date('2024-01-01')
          }
        ]
      ]);

      const portfolio = makePortfolio(100, positions);
      const marketData = makeMarketData({ bitcoin: 42000, ethereum: 2000 });

      const eligible = service.scoreEligiblePositions(
        portfolio,
        'bitcoin', // buying bitcoin, so it should be excluded
        0.85,
        defaultConfig,
        marketData,
        new Date('2024-01-15')
      );

      // Bitcoin should not be in the eligible list since it is the buy coin
      const coinIds = eligible.map((e) => e.coinId);
      expect(coinIds).not.toContain('bitcoin');
    });

    it('should exclude protected coins', () => {
      const positions = new Map<string, any>([
        [
          'bitcoin',
          {
            coinId: 'bitcoin',
            averagePrice: 40000,
            quantity: 1,
            entryDate: new Date('2024-01-01')
          }
        ]
      ]);

      const portfolio = makePortfolio(100, positions);
      const marketData = makeMarketData({ bitcoin: 42000 });

      const config = { ...defaultConfig, protectedCoins: ['bitcoin'] };

      const eligible = service.scoreEligiblePositions(
        portfolio,
        'ethereum',
        0.85,
        config,
        marketData,
        new Date('2024-01-15')
      );

      expect(eligible).toHaveLength(0);
    });

    it('should skip positions with missing or zero price', () => {
      const positions = new Map<string, any>([
        ['coin-a', { coinId: 'coin-a', averagePrice: 100, quantity: 5, entryDate: new Date('2024-01-01') }],
        ['coin-b', { coinId: 'coin-b', averagePrice: 200, quantity: 3, entryDate: new Date('2024-01-01') }]
      ]);

      const portfolio = makePortfolio(100, positions);
      // coin-a has no price entry, coin-b has price 0
      const marketData = makeMarketData({ 'coin-b': 0 });

      const eligible = service.scoreEligiblePositions(
        portfolio,
        'ethereum',
        0.85,
        defaultConfig,
        marketData,
        new Date('2024-01-15')
      );

      expect(eligible).toHaveLength(0);
    });

    it('should sort candidates by score ascending (lowest = sell first)', () => {
      const positions = new Map<string, any>([
        ['coin-a', { coinId: 'coin-a', averagePrice: 100, quantity: 5, entryDate: new Date('2024-01-01') }],
        ['coin-b', { coinId: 'coin-b', averagePrice: 200, quantity: 3, entryDate: new Date('2024-01-01') }],
        ['coin-c', { coinId: 'coin-c', averagePrice: 50, quantity: 10, entryDate: new Date('2024-01-01') }]
      ]);

      const portfolio = makePortfolio(100, positions);
      const marketData = makeMarketData({ 'coin-a': 110, 'coin-b': 210, 'coin-c': 55 });

      // Mock positionAnalysis to return deterministic scores
      const positionAnalysis = service['positionAnalysis'];
      jest.spyOn(positionAnalysis, 'calculatePositionSellScore').mockImplementation((position) => {
        const scores: Record<string, number> = { 'coin-a': 50, 'coin-b': 20, 'coin-c': 80 };
        return { eligible: true, totalScore: scores[position.coinId] ?? 0 } as any;
      });

      const eligible = service.scoreEligiblePositions(
        portfolio,
        'ethereum',
        0.85,
        defaultConfig,
        marketData,
        new Date('2024-01-15')
      );

      expect(eligible.map((e) => e.coinId)).toEqual(['coin-b', 'coin-a', 'coin-c']);
    });
  });

  describe('executeSellPlan', () => {
    it('should stop selling when shortfall is covered', async () => {
      const candidates = [
        { coinId: 'coin-a', score: 10, quantity: 2, price: 500 },
        { coinId: 'coin-b', score: 20, quantity: 3, price: 400 },
        { coinId: 'coin-c', score: 30, quantity: 1, price: 1000 }
      ];

      const buySignal: TradingSignal = {
        action: 'BUY',
        coinId: 'ethereum',
        confidence: 0.9,
        reason: 'test buy'
      };

      const positions = new Map<string, any>([
        ['coin-a', { coinId: 'coin-a', averagePrice: 500, quantity: 2, entryDate: new Date('2024-01-01') }],
        ['coin-b', { coinId: 'coin-b', averagePrice: 400, quantity: 3, entryDate: new Date('2024-01-01') }],
        ['coin-c', { coinId: 'coin-c', averagePrice: 1000, quantity: 1, entryDate: new Date('2024-01-01') }]
      ]);

      const portfolio = makePortfolio(100, positions);
      const marketData = makeMarketData({ 'coin-a': 500, 'coin-b': 400, 'coin-c': 1000 });

      // Shortfall of 600 — first candidate sell (2 * 500 = 1000) should cover it
      const shortfall = 600;
      const maxSellValue = 50000;
      const trades: Partial<BacktestTrade>[] = [];
      const fills: Partial<SimulatedOrderFill>[] = [];

      const mockExecuteTrade = jest.fn().mockResolvedValue({
        trade: { quantity: 1.2, price: 500, fee: 0.5, metadata: {} },
        slippageBps: 5,
        fillStatus: SimulatedOrderStatus.FILLED
      });

      const result = await service.executeSellPlan(
        candidates,
        shortfall,
        maxSellValue,
        buySignal,
        0.9,
        700,
        portfolio,
        marketData,
        0.001,
        defaultSlippageConfig,
        new Map([['coin-a', { id: 'coin-a' } as Coin]]),
        mockQuoteCoin,
        mockBacktest,
        new Date('2024-01-15'),
        trades,
        fills,
        mockExecuteTrade,
        noopBuildSpreadContext
      );

      expect(result).toBe(true);
      expect(trades.length).toBeGreaterThan(0);
      expect(fills.length).toBeGreaterThan(0);
      // The first candidate should cover the 600 shortfall (1.2 * 500 = 600)
      // so coin-b and coin-c should not be called
      expect(mockExecuteTrade).toHaveBeenCalledTimes(1);
    });

    it('should handle cancelled fills without counting them as sells', async () => {
      const candidates = [{ coinId: 'coin-a', score: 10, quantity: 2, price: 500 }];

      const buySignal: TradingSignal = {
        action: 'BUY',
        coinId: 'ethereum',
        confidence: 0.9,
        reason: 'test buy'
      };

      const portfolio = makePortfolio(100, new Map());
      const marketData = makeMarketData({ 'coin-a': 500 });

      const trades: Partial<BacktestTrade>[] = [];
      const fills: Partial<SimulatedOrderFill>[] = [];

      const mockExecuteTrade = jest.fn().mockResolvedValue({
        trade: { price: 500, metadata: {} },
        slippageBps: 10,
        fillStatus: SimulatedOrderStatus.CANCELLED,
        requestedQuantity: 2
      });

      const result = await service.executeSellPlan(
        candidates,
        1000,
        50000,
        buySignal,
        0.9,
        1100,
        portfolio,
        marketData,
        0.001,
        defaultSlippageConfig,
        new Map(),
        mockQuoteCoin,
        mockBacktest,
        new Date('2024-01-15'),
        trades,
        fills,
        mockExecuteTrade,
        noopBuildSpreadContext
      );

      expect(result).toBe(false);
      expect(trades).toHaveLength(0);
      expect(fills).toHaveLength(1);
      expect(fills[0].status).toBe(SimulatedOrderStatus.CANCELLED);
      expect(fills[0].metadata).toEqual(
        expect.objectContaining({
          opportunitySell: true,
          requestedQuantity: 2
        })
      );
    });

    it('should respect maxSellValue liquidation cap', async () => {
      const candidates = [
        { coinId: 'coin-a', score: 10, quantity: 10, price: 500 },
        { coinId: 'coin-b', score: 20, quantity: 10, price: 500 }
      ];

      const buySignal: TradingSignal = { action: 'BUY', coinId: 'ethereum', confidence: 0.9, reason: 'test' };
      const portfolio = makePortfolio(100, new Map());
      const marketData = makeMarketData({ 'coin-a': 500, 'coin-b': 500 });
      const trades: Partial<BacktestTrade>[] = [];
      const fills: Partial<SimulatedOrderFill>[] = [];

      // Return a trade that fills 1 unit = $500
      const mockExecuteTrade = jest.fn().mockResolvedValue({
        trade: { quantity: 1, price: 500, fee: 0, metadata: {} },
        slippageBps: 5,
        fillStatus: SimulatedOrderStatus.FILLED
      });

      // maxSellValue = 400 — less than one full candidate position
      await service.executeSellPlan(
        candidates,
        5000, // large shortfall
        400, // cap at $400
        buySignal,
        0.9,
        5100,
        portfolio,
        marketData,
        0.001,
        defaultSlippageConfig,
        new Map(),
        mockQuoteCoin,
        mockBacktest,
        new Date('2024-01-15'),
        trades,
        fills,
        mockExecuteTrade,
        noopBuildSpreadContext
      );

      // With maxSellValue=400, quantity is capped at 400/500 = 0.8 units for first candidate
      // After first sell of 1*500=500, totalSellValue >= maxSellValue so loop stops
      expect(mockExecuteTrade).toHaveBeenCalledTimes(1);
    });

    it('should handle null result from executeTradeFn gracefully', async () => {
      const candidates = [{ coinId: 'coin-a', score: 10, quantity: 2, price: 500 }];
      const buySignal: TradingSignal = { action: 'BUY', coinId: 'ethereum', confidence: 0.9, reason: 'test' };
      const portfolio = makePortfolio(100, new Map());
      const marketData = makeMarketData({ 'coin-a': 500 });
      const trades: Partial<BacktestTrade>[] = [];
      const fills: Partial<SimulatedOrderFill>[] = [];

      const mockExecuteTrade = jest.fn().mockResolvedValue(null);

      const result = await service.executeSellPlan(
        candidates,
        1000,
        50000,
        buySignal,
        0.9,
        1100,
        portfolio,
        marketData,
        0.001,
        defaultSlippageConfig,
        new Map(),
        mockQuoteCoin,
        mockBacktest,
        new Date('2024-01-15'),
        trades,
        fills,
        mockExecuteTrade,
        noopBuildSpreadContext
      );

      expect(result).toBe(false);
      expect(trades).toHaveLength(0);
      expect(fills).toHaveLength(0);
    });

    it('should sell multiple candidates to cover a large shortfall', async () => {
      const candidates = [
        { coinId: 'coin-a', score: 10, quantity: 1, price: 300 },
        { coinId: 'coin-b', score: 20, quantity: 1, price: 400 },
        { coinId: 'coin-c', score: 30, quantity: 1, price: 500 }
      ];

      const buySignal: TradingSignal = { action: 'BUY', coinId: 'ethereum', confidence: 0.9, reason: 'test' };
      const portfolio = makePortfolio(100, new Map());
      const marketData = makeMarketData({ 'coin-a': 300, 'coin-b': 400, 'coin-c': 500 });
      const trades: Partial<BacktestTrade>[] = [];
      const fills: Partial<SimulatedOrderFill>[] = [];

      const mockExecuteTrade = jest.fn().mockImplementation((params: { signal: TradingSignal }) => {
        const { signal } = params;
        const price = signal.coinId === 'coin-a' ? 300 : signal.coinId === 'coin-b' ? 400 : 500;
        return Promise.resolve({
          trade: { quantity: signal.quantity, price, fee: 0, metadata: {} },
          slippageBps: 5,
          fillStatus: SimulatedOrderStatus.FILLED
        });
      });

      // Shortfall of 600 — coin-a (300) + coin-b (400) should cover it
      const result = await service.executeSellPlan(
        candidates,
        600,
        50000,
        buySignal,
        0.9,
        700,
        portfolio,
        marketData,
        0.001,
        defaultSlippageConfig,
        new Map(),
        mockQuoteCoin,
        mockBacktest,
        new Date('2024-01-15'),
        trades,
        fills,
        mockExecuteTrade,
        noopBuildSpreadContext
      );

      expect(result).toBe(true);
      expect(mockExecuteTrade).toHaveBeenCalledTimes(2);
      expect(trades).toHaveLength(2);
    });
  });

  describe('attemptOpportunitySelling — additional paths', () => {
    it('should return false when buy coin has no price in market data', async () => {
      const buySignal: TradingSignal = { action: 'BUY', coinId: 'unknown-coin', confidence: 0.9, reason: 'test' };
      const portfolio = makePortfolio(0, new Map());
      const marketData = makeMarketData({}); // no prices at all

      const result = await service.attemptOpportunitySelling(
        buySignal,
        portfolio,
        marketData,
        0.001,
        defaultSlippageConfig,
        defaultConfig,
        new Map(),
        mockQuoteCoin,
        mockBacktest,
        new Date('2024-01-15'),
        [],
        [],
        noopExecuteTrade,
        noopBuildSpreadContext
      );

      expect(result).toBe(false);
    });

    it('should calculate requiredAmount from percentage when set', async () => {
      const buySignal: TradingSignal = {
        action: 'BUY',
        coinId: 'ethereum',
        confidence: 0.9,
        percentage: 0.5, // 50% of portfolio
        reason: 'test'
      };

      // Portfolio has $1000 total, so 50% = $500 required, but cash = $0
      const positions = new Map<string, any>([
        ['bitcoin', { coinId: 'bitcoin', averagePrice: 1000, quantity: 1, entryDate: new Date('2024-01-01') }]
      ]);
      const portfolio = makePortfolio(0, positions);
      const marketData = makeMarketData({ ethereum: 2000, bitcoin: 1000 });

      // Mock positionAnalysis to make bitcoin eligible
      jest.spyOn(service['positionAnalysis'], 'calculatePositionSellScore').mockReturnValue({
        eligible: true,
        totalScore: 10
      } as any);

      const mockExecuteTrade = jest.fn().mockResolvedValue({
        trade: { quantity: 0.5, price: 1000, fee: 0.5, metadata: {} },
        slippageBps: 5,
        fillStatus: SimulatedOrderStatus.FILLED
      });

      const result = await service.attemptOpportunitySelling(
        buySignal,
        portfolio,
        marketData,
        0.001,
        defaultSlippageConfig,
        defaultConfig,
        new Map([['bitcoin', { id: 'bitcoin' } as Coin]]),
        mockQuoteCoin,
        mockBacktest,
        new Date('2024-01-15'),
        [],
        [],
        mockExecuteTrade,
        noopBuildSpreadContext
      );

      expect(result).toBe(true);
      expect(mockExecuteTrade).toHaveBeenCalled();
    });

    it('should return false when no eligible positions exist', async () => {
      const buySignal: TradingSignal = {
        action: 'BUY',
        coinId: 'ethereum',
        confidence: 0.9,
        quantity: 1,
        reason: 'test'
      };

      // Cash is $0 so there's a shortfall, but only position is the buy coin itself
      const positions = new Map<string, any>([
        ['ethereum', { coinId: 'ethereum', averagePrice: 1800, quantity: 5, entryDate: new Date('2024-01-01') }]
      ]);
      const portfolio = makePortfolio(0, positions);
      const marketData = makeMarketData({ ethereum: 2000 });

      const result = await service.attemptOpportunitySelling(
        buySignal,
        portfolio,
        marketData,
        0.001,
        defaultSlippageConfig,
        defaultConfig,
        new Map(),
        mockQuoteCoin,
        mockBacktest,
        new Date('2024-01-15'),
        [],
        [],
        noopExecuteTrade,
        noopBuildSpreadContext
      );

      expect(result).toBe(false);
    });
  });
});
