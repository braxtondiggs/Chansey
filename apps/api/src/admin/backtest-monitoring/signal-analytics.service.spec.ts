import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type ObjectLiteral, type Repository, type SelectQueryBuilder } from 'typeorm';

import { SignalAnalyticsService } from './signal-analytics.service';

import { SignalDirection, SignalType } from '../../order/backtest/backtest-signal.entity';
import { BacktestSummary } from '../../order/backtest/backtest-summary.entity';
import { Backtest } from '../../order/backtest/backtest.entity';

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
  const base: BacktestSummary = new BacktestSummary({
    backtestId: 'bt-1',
    totalSignals: 0,
    entryCount: 0,
    exitCount: 0,
    adjustmentCount: 0,
    riskControlCount: 0,
    avgConfidence: null,
    confidenceSum: 0,
    confidenceCount: 0,
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

describe('SignalAnalyticsService', () => {
  let service: SignalAnalyticsService;
  let backtestRepo: MockRepo<Backtest>;
  let summaryRepo: MockRepo<BacktestSummary>;

  beforeEach(async () => {
    backtestRepo = { createQueryBuilder: jest.fn() };
    summaryRepo = { find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalAnalyticsService,
        { provide: getRepositoryToken(Backtest), useValue: backtestRepo },
        { provide: getRepositoryToken(BacktestSummary), useValue: summaryRepo }
      ]
    }).compile();

    service = module.get(SignalAnalyticsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns empty analytics when no backtests match filters', async () => {
    (backtestRepo.createQueryBuilder as jest.Mock).mockReturnValue(createBacktestIdsQb([]));

    const result = await service.getSignalAnalytics({});

    expect(result.overall.totalSignals).toBe(0);
    expect(result.byConfidenceBucket).toEqual([]);
  });

  it('returns empty analytics when no summaries yet exist', async () => {
    (backtestRepo.createQueryBuilder as jest.Mock).mockReturnValue(createBacktestIdsQb([{ b_id: 'bt-1' }]));
    (summaryRepo.find as jest.Mock).mockResolvedValue([]);

    const result = await service.getSignalAnalytics({});

    expect(result.overall.totalSignals).toBe(0);
  });

  it('aggregates signal counters + exact confidence across summaries', async () => {
    (backtestRepo.createQueryBuilder as jest.Mock).mockReturnValue(
      createBacktestIdsQb([{ b_id: 'bt-1' }, { b_id: 'bt-2' }])
    );
    (summaryRepo.find as jest.Mock).mockResolvedValue([
      makeSummary({
        backtestId: 'bt-1',
        totalSignals: 10,
        entryCount: 5,
        exitCount: 3,
        adjustmentCount: 1,
        riskControlCount: 1,
        avgConfidence: 0.8,
        confidenceSum: 8,
        confidenceCount: 10
      }),
      makeSummary({
        backtestId: 'bt-2',
        totalSignals: 30,
        entryCount: 20,
        exitCount: 5,
        adjustmentCount: 3,
        riskControlCount: 2,
        avgConfidence: 0.6,
        confidenceSum: 18,
        confidenceCount: 30
      })
    ]);

    const result = await service.getSignalAnalytics({});

    expect(result.overall.totalSignals).toBe(40);
    expect(result.overall.entryCount).toBe(25);
    // Exact: (8 + 18) / (10 + 30) = 0.65
    expect(result.overall.avgConfidence).toBeCloseTo(0.65, 10);
  });

  it('ignores null-confidence signals when averaging (previously skewed by totalSignals weighting)', async () => {
    // Summary has 10 signals, but only 5 carry confidence (e.g., 5 RISK_CONTROL signals have null).
    // Old weighted-by-totalSignals math would have scaled avgConfidence by 10 and diluted it when
    // merged with a second summary; exact summation using confidenceCount avoids that bias.
    (backtestRepo.createQueryBuilder as jest.Mock).mockReturnValue(
      createBacktestIdsQb([{ b_id: 'bt-1' }, { b_id: 'bt-2' }])
    );
    (summaryRepo.find as jest.Mock).mockResolvedValue([
      makeSummary({
        backtestId: 'bt-1',
        totalSignals: 10,
        avgConfidence: 0.9,
        confidenceSum: 4.5,
        confidenceCount: 5
      }),
      makeSummary({
        backtestId: 'bt-2',
        totalSignals: 10,
        avgConfidence: 0.5,
        confidenceSum: 5,
        confidenceCount: 10
      })
    ]);

    const result = await service.getSignalAnalytics({});

    // Exact: (4.5 + 5) / (5 + 10) = 9.5 / 15 ≈ 0.6333
    expect(result.overall.avgConfidence).toBeCloseTo(9.5 / 15, 10);
  });

  it('fills missing confidence buckets with zero entries in fixed order', async () => {
    (backtestRepo.createQueryBuilder as jest.Mock).mockReturnValue(createBacktestIdsQb([{ b_id: 'bt-1' }]));
    (summaryRepo.find as jest.Mock).mockResolvedValue([
      makeSummary({
        totalSignals: 10,
        entryCount: 10,
        avgConfidence: 0.9,
        signalsByConfidenceBucket: [
          { bucket: '80-100%', signalCount: 10, wins: 8, losses: 2, returnSum: 50, returnCount: 10 }
        ]
      })
    ]);

    const result = await service.getSignalAnalytics({});

    expect(result.byConfidenceBucket.map((b) => b.bucket)).toEqual(['0-20%', '20-40%', '40-60%', '60-80%', '80-100%']);
    expect(result.byConfidenceBucket[4].signalCount).toBe(10);
    expect(result.byConfidenceBucket[4].successRate).toBeCloseTo(0.8, 10);
    expect(result.byConfidenceBucket[4].avgReturn).toBeCloseTo(5.0, 10);
  });

  it('aggregates bySignalType with success rate from merged wins/losses', async () => {
    (backtestRepo.createQueryBuilder as jest.Mock).mockReturnValue(createBacktestIdsQb([{ b_id: 'bt-1' }]));
    (summaryRepo.find as jest.Mock).mockResolvedValue([
      makeSummary({
        signalsByType: {
          [SignalType.ENTRY]: { count: 10, wins: 6, losses: 4, returnSum: 20, returnCount: 10 }
        }
      }),
      makeSummary({
        signalsByType: {
          [SignalType.ENTRY]: { count: 5, wins: 2, losses: 3, returnSum: 5, returnCount: 5 }
        }
      })
    ]);

    const result = await service.getSignalAnalytics({});

    const entry = result.bySignalType.find((t) => t.type === SignalType.ENTRY);
    expect(entry).toBeDefined();
    expect(entry?.count).toBe(15);
    // 8 wins / 15 resolved = 0.5333
    expect(entry?.successRate).toBeCloseTo(8 / 15, 10);
    expect(entry?.avgReturn).toBeCloseTo(25 / 15, 10);
  });

  it('aggregates byDirection merging outcome buckets', async () => {
    (backtestRepo.createQueryBuilder as jest.Mock).mockReturnValue(createBacktestIdsQb([{ b_id: 'bt-1' }]));
    (summaryRepo.find as jest.Mock).mockResolvedValue([
      makeSummary({
        signalsByDirection: {
          [SignalDirection.LONG]: { count: 8, wins: 5, losses: 3, returnSum: 15, returnCount: 8 }
        }
      })
    ]);

    const result = await service.getSignalAnalytics({});

    const long = result.byDirection.find((d) => d.direction === SignalDirection.LONG);
    expect(long?.count).toBe(8);
    expect(long?.successRate).toBeCloseTo(5 / 8, 10);
  });

  it('aggregates byInstrument top 10 sorted by count', async () => {
    (backtestRepo.createQueryBuilder as jest.Mock).mockReturnValue(createBacktestIdsQb([{ b_id: 'bt-1' }]));
    (summaryRepo.find as jest.Mock).mockResolvedValue([
      makeSummary({
        signalsByInstrument: [
          { instrument: 'BTC', count: 20, wins: 15, losses: 5, returnSum: 50, returnCount: 20 },
          { instrument: 'ETH', count: 8, wins: 5, losses: 3, returnSum: 10, returnCount: 8 }
        ]
      }),
      makeSummary({
        signalsByInstrument: [{ instrument: 'BTC', count: 5, wins: 3, losses: 2, returnSum: 15, returnCount: 5 }]
      })
    ]);

    const result = await service.getSignalAnalytics({});

    expect(result.byInstrument[0]).toEqual({
      instrument: 'BTC',
      count: 25,
      successRate: 18 / 25,
      avgReturn: 65 / 25
    });
    expect(result.byInstrument[1].instrument).toBe('ETH');
  });
});
