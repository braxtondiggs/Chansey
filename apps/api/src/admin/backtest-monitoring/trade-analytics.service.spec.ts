import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type ObjectLiteral, type Repository, type SelectQueryBuilder } from 'typeorm';

import { TradeAnalyticsService } from './trade-analytics.service';

import { BacktestSummary } from '../../order/backtest/backtest-summary.entity';
import { Backtest } from '../../order/backtest/backtest.entity';
import {
  buildHistogram,
  HOLD_TIME_BUCKET_EDGES,
  SLIPPAGE_BPS_BUCKET_EDGES
} from '../../order/backtest/summary-histogram.util';

type MockRepo<T extends ObjectLiteral> = Partial<jest.Mocked<Repository<T>>>;

const createBacktestIdsQb = (ids: Array<{ b_id: string }>) => {
  const qb: Partial<SelectQueryBuilder<any>> = {
    select: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(ids)
  };
  return qb as SelectQueryBuilder<any>;
};

function makeSummary(partial: Partial<BacktestSummary> = {}): BacktestSummary {
  const base = new BacktestSummary({
    backtestId: 'bt-1',
    totalSignals: 0,
    entryCount: 0,
    exitCount: 0,
    adjustmentCount: 0,
    riskControlCount: 0,
    avgConfidence: null,
    totalTrades: 0,
    buyCount: 0,
    sellCount: 0,
    totalVolume: 0,
    totalFees: 0,
    winCount: 0,
    lossCount: 0,
    grossProfit: 0,
    grossLoss: 0,
    largestWin: null,
    largestLoss: null,
    avgWin: null,
    avgLoss: null,
    totalRealizedPnL: null,
    holdTimeMinMs: null,
    holdTimeMaxMs: null,
    holdTimeAvgMs: null,
    holdTimeMedianMs: null,
    holdTimeCount: 0,
    slippageAvgBps: null,
    slippageMaxBps: null,
    slippageP95Bps: null,
    slippageTotalImpact: 0,
    slippageFillCount: 0,
    holdTimeHistogram: null,
    slippageHistogram: null,
    signalsByConfidenceBucket: [],
    signalsByType: {},
    signalsByDirection: {},
    signalsByInstrument: [],
    tradesByInstrument: [],
    computedAt: new Date()
  });
  Object.assign(base, partial);
  return base;
}

describe('TradeAnalyticsService', () => {
  let service: TradeAnalyticsService;
  let backtestRepo: MockRepo<Backtest>;
  let summaryRepo: MockRepo<BacktestSummary>;

  beforeEach(async () => {
    backtestRepo = { createQueryBuilder: jest.fn() };
    summaryRepo = { find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeAnalyticsService,
        { provide: getRepositoryToken(Backtest), useValue: backtestRepo },
        { provide: getRepositoryToken(BacktestSummary), useValue: summaryRepo }
      ]
    }).compile();

    service = module.get(TradeAnalyticsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns empty analytics when no backtests match filters', async () => {
    (backtestRepo.createQueryBuilder as jest.Mock).mockReturnValue(createBacktestIdsQb([]));
    const result = await service.getTradeAnalytics({});
    expect(result.summary.totalTrades).toBe(0);
    expect(result.profitability.profitFactor).toBe(0);
    expect(result.duration.avgHoldTime).toBe('N/A');
  });

  it('returns empty analytics when no summaries yet exist', async () => {
    (backtestRepo.createQueryBuilder as jest.Mock).mockReturnValue(createBacktestIdsQb([{ b_id: 'bt-1' }]));
    (summaryRepo.find as jest.Mock).mockResolvedValue([]);
    const result = await service.getTradeAnalytics({});
    expect(result.summary.totalTrades).toBe(0);
  });

  it('aggregates trade summary counters across summaries', async () => {
    (backtestRepo.createQueryBuilder as jest.Mock).mockReturnValue(
      createBacktestIdsQb([{ b_id: 'bt-1' }, { b_id: 'bt-2' }])
    );
    (summaryRepo.find as jest.Mock).mockResolvedValue([
      makeSummary({ totalTrades: 50, buyCount: 25, sellCount: 25, totalVolume: 100000, totalFees: 100 }),
      makeSummary({ totalTrades: 30, buyCount: 15, sellCount: 15, totalVolume: 60000, totalFees: 80 })
    ]);
    const result = await service.getTradeAnalytics({});
    expect(result.summary).toEqual({
      totalTrades: 80,
      totalVolume: 160000,
      totalFees: 180,
      buyCount: 40,
      sellCount: 40
    });
  });

  it('computes profitability with profitFactor of 0 when no losses (avoids Infinity)', async () => {
    (backtestRepo.createQueryBuilder as jest.Mock).mockReturnValue(createBacktestIdsQb([{ b_id: 'bt-1' }]));
    (summaryRepo.find as jest.Mock).mockResolvedValue([
      makeSummary({
        winCount: 2,
        lossCount: 0,
        grossProfit: 500,
        grossLoss: 0,
        largestWin: 300,
        largestLoss: null,
        avgWin: 250,
        avgLoss: null,
        totalRealizedPnL: 500
      })
    ]);
    const result = await service.getTradeAnalytics({});
    expect(result.profitability.profitFactor).toBe(0);
    expect(result.profitability.winRate).toBe(1);
    expect(result.profitability.avgWin).toBe(250);
  });

  it('merges hold-time histograms and interpolates median', async () => {
    const h1 = buildHistogram([1000, 5000, 10000, 20000], HOLD_TIME_BUCKET_EDGES);
    const h2 = buildHistogram([15000, 25000, 40000, 60000], HOLD_TIME_BUCKET_EDGES);
    (backtestRepo.createQueryBuilder as jest.Mock).mockReturnValue(
      createBacktestIdsQb([{ b_id: 'bt-1' }, { b_id: 'bt-2' }])
    );
    (summaryRepo.find as jest.Mock).mockResolvedValue([
      makeSummary({ holdTimeHistogram: h1, holdTimeCount: 4 }),
      makeSummary({ holdTimeHistogram: h2, holdTimeCount: 4 })
    ]);
    const result = await service.getTradeAnalytics({});

    // Combined 8 samples, avg = (sum) / 8. Sum from histograms = 1000+5000+10000+20000+15000+25000+40000+60000 = 176000
    expect(result.duration.avgHoldTimeMs).toBeCloseTo(176000 / 8, 5);
    expect(result.duration.medianHoldTimeMs).toBeGreaterThan(0);
    expect(result.duration.avgHoldTime).not.toBe('N/A');
  });

  it('aggregates slippage using histogram-merged p95 and summary scalars', async () => {
    const h1 = buildHistogram([50, 100, 200], SLIPPAGE_BPS_BUCKET_EDGES);
    const h2 = buildHistogram([150, 1200], SLIPPAGE_BPS_BUCKET_EDGES);
    (backtestRepo.createQueryBuilder as jest.Mock).mockReturnValue(
      createBacktestIdsQb([{ b_id: 'bt-1' }, { b_id: 'bt-2' }])
    );
    (summaryRepo.find as jest.Mock).mockResolvedValue([
      makeSummary({ slippageHistogram: h1, slippageFillCount: 3, slippageMaxBps: 200, slippageTotalImpact: 50 }),
      makeSummary({ slippageHistogram: h2, slippageFillCount: 2, slippageMaxBps: 1200, slippageTotalImpact: 30 })
    ]);
    const result = await service.getTradeAnalytics({});
    expect(result.slippage.fillCount).toBe(5);
    expect(result.slippage.maxBps).toBe(1200);
    expect(result.slippage.totalImpact).toBe(80);
    expect(result.slippage.p95Bps).toBeGreaterThan(0);
  });

  it('aggregates tradesByInstrument top 10 sorted by totalVolume', async () => {
    (backtestRepo.createQueryBuilder as jest.Mock).mockReturnValue(createBacktestIdsQb([{ b_id: 'bt-1' }]));
    (summaryRepo.find as jest.Mock).mockResolvedValue([
      makeSummary({
        tradesByInstrument: [
          {
            instrument: 'BTC/USD',
            tradeCount: 30,
            sellCount: 15,
            wins: 10,
            losses: 5,
            totalVolume: 50000,
            totalPnL: 2000,
            returnSum: 10.5,
            returnCount: 15
          },
          {
            instrument: 'ETH/USD',
            tradeCount: 8,
            sellCount: 4,
            wins: 2,
            losses: 2,
            totalVolume: 10000,
            totalPnL: 100,
            returnSum: 1.0,
            returnCount: 4
          }
        ]
      })
    ]);
    const result = await service.getTradeAnalytics({});
    expect(result.byInstrument[0]).toEqual({
      instrument: 'BTC/USD',
      tradeCount: 30,
      totalReturn: 10.5,
      winRate: 10 / 15,
      totalVolume: 50000,
      totalPnL: 2000
    });
  });
});
