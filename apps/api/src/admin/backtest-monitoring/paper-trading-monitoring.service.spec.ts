import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type ObjectLiteral, type Repository, type SelectQueryBuilder } from 'typeorm';

import { PaperTradingMonitoringService } from './paper-trading-monitoring.service';

import { PaperTradingSessionSummary } from '../../order/paper-trading/entities/paper-trading-session-summary.entity';
import {
  PaperTradingSession,
  PaperTradingStatus
} from '../../order/paper-trading/entities/paper-trading-session.entity';
import {
  PaperTradingSignalDirection,
  PaperTradingSignalType
} from '../../order/paper-trading/entities/paper-trading-signal.entity';

type MockRepo<T extends ObjectLiteral> = Partial<jest.Mocked<Repository<T>>>;

const createMockQueryBuilder = (overrides: Record<string, any> = {}) => {
  const qb: Partial<SelectQueryBuilder<any>> = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    setParameters: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    clone: jest.fn().mockReturnThis(),
    getQuery: jest.fn().mockReturnValue('SELECT s.id FROM paper_trading_sessions s'),
    getParameters: jest.fn().mockReturnValue({}),
    getCount: jest.fn().mockResolvedValue(0),
    getRawOne: jest.fn().mockResolvedValue({}),
    getRawMany: jest.fn().mockResolvedValue([]),
    getMany: jest.fn().mockResolvedValue([]),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0])
  };
  return Object.assign(qb, overrides) as SelectQueryBuilder<any>;
};

function makeSummary(partial: Partial<PaperTradingSessionSummary> = {}): PaperTradingSessionSummary {
  const base = new PaperTradingSessionSummary({
    sessionId: 'sess-1',
    totalOrders: 0,
    buyCount: 0,
    sellCount: 0,
    totalVolume: 0,
    totalFees: 0,
    totalPnL: 0,
    avgSlippageBps: null,
    slippageSumBps: 0,
    slippageCount: 0,
    totalSignals: 0,
    processedCount: 0,
    confidenceSum: 0,
    confidenceCount: 0,
    ordersBySymbol: [],
    signalsByType: {},
    signalsByDirection: {},
    computedAt: new Date()
  });
  Object.assign(base, partial);
  return base;
}

describe('PaperTradingMonitoringService', () => {
  let service: PaperTradingMonitoringService;
  let paperSessionRepo: MockRepo<PaperTradingSession>;
  let summaryRepo: MockRepo<PaperTradingSessionSummary>;
  let sessionQb: SelectQueryBuilder<any>;
  let summaryQb: SelectQueryBuilder<any>;

  beforeEach(async () => {
    sessionQb = createMockQueryBuilder();
    summaryQb = createMockQueryBuilder();

    paperSessionRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(sessionQb),
      count: jest.fn().mockResolvedValue(0)
    };
    summaryRepo = { createQueryBuilder: jest.fn().mockReturnValue(summaryQb) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaperTradingMonitoringService,
        { provide: getRepositoryToken(PaperTradingSession), useValue: paperSessionRepo },
        { provide: getRepositoryToken(PaperTradingSessionSummary), useValue: summaryRepo }
      ]
    }).compile();

    service = module.get(PaperTradingMonitoringService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getPaperTradingMonitoring', () => {
    it('returns fully zeroed analytics when no data exists', async () => {
      const result = await service.getPaperTradingMonitoring({});

      expect(result.totalSessions).toBe(0);
      expect(result.avgMetrics).toEqual({ sharpeRatio: 0, totalReturn: 0, maxDrawdown: 0, winRate: 0 });
      expect(result.topAlgorithms).toEqual([]);
      for (const st of Object.values(PaperTradingStatus)) {
        expect(result.statusCounts[st]).toBe(0);
      }
      for (const t of Object.values(PaperTradingSignalType)) {
        expect(result.signalAnalytics.byType[t]).toBe(0);
      }
      for (const d of Object.values(PaperTradingSignalDirection)) {
        expect(result.signalAnalytics.byDirection[d]).toBe(0);
      }
      expect(result.orderAnalytics.totalOrders).toBe(0);
      expect(result.orderAnalytics.bySymbol).toEqual([]);
    });

    it('merges session-level aggregates with per-session summary rows', async () => {
      (sessionQb.getRawOne as jest.Mock)
        .mockResolvedValueOnce({
          [`status_${PaperTradingStatus.COMPLETED}`]: '3',
          [`status_${PaperTradingStatus.ACTIVE}`]: '2',
          total_sessions: '5',
          avg_sharpe: '1.25',
          avg_return: '8.4',
          avg_drawdown: null,
          avg_win_rate: '0.65',
          top_algorithms: JSON.stringify([
            { algorithmId: 'algo-1', algorithmName: 'Alpha', sessionCount: 5, avgReturn: 12.5, avgSharpe: 1.8 }
          ])
        })
        .mockResolvedValueOnce({ last24h: '1', last7d: '4', last30d: '5' });
      // Non-zero session scope → summary query runs against the filtered subquery.
      (sessionQb.getCount as jest.Mock).mockResolvedValueOnce(2);

      (summaryQb.getMany as jest.Mock).mockResolvedValueOnce([
        makeSummary({
          sessionId: 's1',
          totalOrders: 6,
          buyCount: 4,
          sellCount: 2,
          totalVolume: 600,
          totalFees: 1.5,
          totalPnL: 30,
          slippageSumBps: 12,
          slippageCount: 3,
          ordersBySymbol: [{ symbol: 'BTC', orderCount: 4, totalVolume: 500, totalPnL: 20 }],
          totalSignals: 4,
          processedCount: 3,
          confidenceSum: 3.2,
          confidenceCount: 4,
          signalsByType: { [PaperTradingSignalType.ENTRY]: 3, [PaperTradingSignalType.EXIT]: 1 },
          signalsByDirection: { [PaperTradingSignalDirection.LONG]: 4 }
        }),
        makeSummary({
          sessionId: 's2',
          totalOrders: 4,
          buyCount: 2,
          sellCount: 2,
          totalVolume: 400,
          totalFees: 1,
          totalPnL: 20,
          slippageSumBps: 0,
          slippageCount: 0,
          ordersBySymbol: [{ symbol: 'BTC', orderCount: 1, totalVolume: 100, totalPnL: 5 }],
          totalSignals: 4,
          processedCount: 3,
          confidenceSum: 3.4,
          confidenceCount: 4,
          signalsByType: { [PaperTradingSignalType.ENTRY]: 2, [PaperTradingSignalType.ADJUSTMENT]: 2 },
          signalsByDirection: { [PaperTradingSignalDirection.LONG]: 2, [PaperTradingSignalDirection.SHORT]: 2 }
        })
      ]);

      const result = await service.getPaperTradingMonitoring({ algorithmId: 'algo-1' });

      expect(result.statusCounts[PaperTradingStatus.COMPLETED]).toBe(3);
      expect(result.totalSessions).toBe(5);
      expect(result.orderAnalytics.totalOrders).toBe(10);
      expect(result.orderAnalytics.totalVolume).toBe(1000);
      expect(result.orderAnalytics.avgSlippageBps).toBeCloseTo(12 / 3, 10);
      expect(result.orderAnalytics.bySymbol).toEqual([
        { symbol: 'BTC', orderCount: 5, totalVolume: 600, totalPnL: 25 }
      ]);
      expect(result.signalAnalytics.totalSignals).toBe(8);
      expect(result.signalAnalytics.processedRate).toBeCloseTo(6 / 8, 10);
      expect(result.signalAnalytics.byType[PaperTradingSignalType.ENTRY]).toBe(5);
      expect(result.signalAnalytics.byDirection[PaperTradingSignalDirection.LONG]).toBe(6);
    });
  });

  describe('listPaperTradingSessions', () => {
    it('maps sessions with progress, duration fallback, and null startedAt', async () => {
      const createdAt = new Date('2026-03-15T12:00:00Z');
      const session = {
        id: 'sess-1',
        name: 'Session 1',
        algorithm: { name: 'Algo' },
        status: PaperTradingStatus.COMPLETED,
        totalReturn: 12.5,
        sharpeRatio: 1.2,
        duration: null,
        startedAt: null,
        createdAt
      };
      (sessionQb.getManyAndCount as jest.Mock).mockResolvedValueOnce([[session], 1]);

      const result = await service.listPaperTradingSessions({}, 1, 10);

      expect(result.data).toEqual([
        {
          id: 'sess-1',
          name: 'Session 1',
          algorithmName: 'Algo',
          status: PaperTradingStatus.COMPLETED,
          progressPercent: 100,
          totalReturn: 12.5,
          sharpeRatio: 1.2,
          duration: 'N/A',
          startedAt: null,
          stoppedReason: null,
          createdAt: createdAt.toISOString()
        }
      ]);
    });
  });
});
