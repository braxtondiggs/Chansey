import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';

import { TradeAnalyticsService } from './trade-analytics.service';

import { BacktestTrade } from '../../order/backtest/backtest-trade.entity';
import { Backtest } from '../../order/backtest/backtest.entity';
import { SimulatedOrderFill } from '../../order/backtest/simulated-order-fill.entity';

type MockRepo<T extends ObjectLiteral> = Partial<jest.Mocked<Repository<T>>>;

const createMockQueryBuilder = () => {
  const qb: Partial<SelectQueryBuilder<any>> = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({}),
    getRawMany: jest.fn().mockResolvedValue([])
  };
  return qb as SelectQueryBuilder<any>;
};

describe('TradeAnalyticsService', () => {
  let service: TradeAnalyticsService;
  let backtestRepo: MockRepo<Backtest>;
  let tradeRepo: MockRepo<BacktestTrade>;
  let fillRepo: MockRepo<SimulatedOrderFill>;
  let mockQueryBuilder: SelectQueryBuilder<any>;

  beforeEach(async () => {
    mockQueryBuilder = createMockQueryBuilder();

    backtestRepo = { createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder) };
    tradeRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder)
    };
    fillRepo = { createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeAnalyticsService,
        { provide: getRepositoryToken(Backtest), useValue: backtestRepo },
        { provide: getRepositoryToken(BacktestTrade), useValue: tradeRepo },
        { provide: getRepositoryToken(SimulatedOrderFill), useValue: fillRepo }
      ]
    }).compile();

    service = module.get(TradeAnalyticsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getTradeAnalytics', () => {
    it('returns empty analytics when no backtests match filters', async () => {
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.getTradeAnalytics({});

      expect(result).toMatchObject({
        summary: {
          totalTrades: 0,
          totalVolume: 0,
          totalFees: 0
        },
        profitability: {
          winCount: 0,
          lossCount: 0,
          winRate: 0
        }
      });
    });

    it('returns trade analytics when backtests exist', async () => {
      // Mock backtest IDs
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([{ b_id: 'bt-1' }]);

      // Mock trade summary
      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValueOnce({
        totalTrades: '50',
        totalVolume: '100000',
        totalFees: '100',
        buyCount: '25',
        sellCount: '25'
      });

      // Mock profitability
      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValueOnce({
        winCount: '15',
        lossCount: '10',
        grossProfit: '5000',
        grossLoss: '2000',
        largestWin: '1000',
        largestLoss: '-500',
        avgWin: '333',
        avgLoss: '-200',
        totalRealizedPnL: '3000'
      });

      // Mock duration stats (no hold-time rows)
      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValueOnce({ cnt: '0' });

      // Mock slippage
      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValueOnce({
        avgBps: '5.5',
        totalImpact: '50',
        maxBps: '15',
        fillCount: '40'
      });

      // Mock p95 slippage
      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValueOnce({ p95Bps: '10' });

      // Mock by instrument
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([
        {
          instrument: 'BTC/USDT',
          tradeCount: '30',
          totalReturn: '10.5',
          winRate: '0.65',
          totalVolume: '50000',
          totalPnL: '2000'
        }
      ]);

      const result = await service.getTradeAnalytics({});

      expect(result.summary).toEqual({
        totalTrades: 50,
        totalVolume: 100000,
        totalFees: 100,
        buyCount: 25,
        sellCount: 25
      });

      // winRate = 15/25 = 0.6; profitFactor = 5000/2000 = 2.5
      // expectancy = 333*0.6 - 200*0.4 = 199.8 - 80 = 119.8
      expect(result.profitability).toEqual({
        winCount: 15,
        lossCount: 10,
        winRate: 0.6,
        profitFactor: 2.5,
        largestWin: 1000,
        largestLoss: -500,
        expectancy: expect.closeTo(119.8, 5),
        avgWin: 333,
        avgLoss: 200, // source negates parseFloat(avgLoss) = -(-200) = 200
        totalRealizedPnL: 3000
      });

      expect(result.duration).toEqual({
        avgHoldTimeMs: 0,
        avgHoldTime: 'N/A',
        medianHoldTimeMs: 0,
        medianHoldTime: 'N/A',
        maxHoldTimeMs: 0,
        maxHoldTime: 'N/A',
        minHoldTimeMs: 0,
        minHoldTime: 'N/A'
      });

      expect(result.slippage).toEqual({
        avgBps: 5.5,
        totalImpact: 50,
        p95Bps: 10,
        maxBps: 15,
        fillCount: 40
      });

      expect(result.byInstrument).toEqual([
        {
          instrument: 'BTC/USDT',
          tradeCount: 30,
          totalReturn: 10.5,
          winRate: 0.65,
          totalVolume: 50000,
          totalPnL: 2000
        }
      ]);
    });

    it('returns profitFactor of 0 when there are wins but no losses (avoids Infinity)', async () => {
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([{ b_id: 'bt-1' }]);
      (mockQueryBuilder.getRawOne as jest.Mock)
        .mockResolvedValueOnce({ totalTrades: '5', totalVolume: '1000', totalFees: '1', buyCount: '3', sellCount: '2' })
        .mockResolvedValueOnce({
          winCount: '2',
          lossCount: '0',
          grossProfit: '500',
          grossLoss: '0',
          largestWin: '300',
          largestLoss: '0',
          avgWin: '250',
          avgLoss: null,
          totalRealizedPnL: '500'
        })
        .mockResolvedValueOnce({ cnt: '0' })
        .mockResolvedValueOnce({ avgBps: '0', totalImpact: '0', maxBps: '0', fillCount: '0' })
        .mockResolvedValueOnce({ p95Bps: '0' });
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.getTradeAnalytics({});

      expect(result.profitability.profitFactor).toBe(0);
      expect(result.profitability.winRate).toBe(1);
      expect(result.profitability.lossCount).toBe(0);
    });

    it('computes duration stats from SQL aggregation over holdTimeMs', async () => {
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([{ b_id: 'bt-1' }]);
      (mockQueryBuilder.getRawOne as jest.Mock)
        .mockResolvedValueOnce({}) // summary
        .mockResolvedValueOnce({}) // profitability
        .mockResolvedValueOnce({ cnt: '4', avgMs: '4500', medianMs: '4000', minMs: '1000', maxMs: '9000' })
        .mockResolvedValueOnce({}) // slippage
        .mockResolvedValueOnce({}); // p95
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.getTradeAnalytics({});

      expect(result.duration.avgHoldTimeMs).toBe(4500);
      expect(result.duration.medianHoldTimeMs).toBe(4000);
      expect(result.duration.minHoldTimeMs).toBe(1000);
      expect(result.duration.maxHoldTimeMs).toBe(9000);
      expect(result.duration.avgHoldTime).not.toBe('N/A');
    });

    it('falls back to "Unknown" for instruments with null symbols', async () => {
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([{ b_id: 'bt-1' }]);
      (mockQueryBuilder.getRawOne as jest.Mock)
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ cnt: '0' })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([
        { instrument: null, tradeCount: '5', totalReturn: '1', winRate: '0.5', totalVolume: '100', totalPnL: '10' }
      ]);

      const result = await service.getTradeAnalytics({});

      expect(result.byInstrument[0].instrument).toBe('Unknown');
    });
  });
});
