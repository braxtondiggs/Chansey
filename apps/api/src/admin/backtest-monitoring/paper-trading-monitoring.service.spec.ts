import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';

import { PaperTradingMonitoringService } from './paper-trading-monitoring.service';

import {
  PaperTradingOrder,
  PaperTradingOrderSide
} from '../../order/paper-trading/entities/paper-trading-order.entity';
import {
  PaperTradingSession,
  PaperTradingStatus
} from '../../order/paper-trading/entities/paper-trading-session.entity';
import {
  PaperTradingSignal,
  PaperTradingSignalDirection,
  PaperTradingSignalType
} from '../../order/paper-trading/entities/paper-trading-signal.entity';

type MockRepo<T extends ObjectLiteral> = Partial<jest.Mocked<Repository<T>>>;

const createMockQueryBuilder = () => {
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
    getQuery: jest.fn().mockReturnValue('SELECT s.id FROM paper_trading_sessions s'),
    getParameters: jest.fn().mockReturnValue({}),
    getCount: jest.fn().mockResolvedValue(0),
    getRawOne: jest.fn().mockResolvedValue({}),
    getRawMany: jest.fn().mockResolvedValue([]),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0])
  };
  return qb as SelectQueryBuilder<any>;
};

describe('PaperTradingMonitoringService', () => {
  let service: PaperTradingMonitoringService;
  let paperSessionRepo: MockRepo<PaperTradingSession>;
  let paperOrderRepo: MockRepo<PaperTradingOrder>;
  let paperSignalRepo: MockRepo<PaperTradingSignal>;
  let sessionQb: SelectQueryBuilder<any>;
  let orderQb: SelectQueryBuilder<any>;
  let signalQb: SelectQueryBuilder<any>;

  beforeEach(async () => {
    sessionQb = createMockQueryBuilder();
    orderQb = createMockQueryBuilder();
    signalQb = createMockQueryBuilder();

    paperSessionRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(sessionQb),
      count: jest.fn().mockResolvedValue(0)
    };
    paperOrderRepo = { createQueryBuilder: jest.fn().mockReturnValue(orderQb) };
    paperSignalRepo = { createQueryBuilder: jest.fn().mockReturnValue(signalQb) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaperTradingMonitoringService,
        { provide: getRepositoryToken(PaperTradingSession), useValue: paperSessionRepo },
        { provide: getRepositoryToken(PaperTradingOrder), useValue: paperOrderRepo },
        { provide: getRepositoryToken(PaperTradingSignal), useValue: paperSignalRepo }
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
      // All statuses seeded to 0
      for (const st of Object.values(PaperTradingStatus)) {
        expect(result.statusCounts[st]).toBe(0);
      }
      // Signal analytics seeds all enum keys to 0
      for (const t of Object.values(PaperTradingSignalType)) {
        expect(result.signalAnalytics.byType[t]).toBe(0);
      }
      for (const d of Object.values(PaperTradingSignalDirection)) {
        expect(result.signalAnalytics.byDirection[d]).toBe(0);
      }
      expect(result.orderAnalytics.totalOrders).toBe(0);
      expect(result.orderAnalytics.bySymbol).toEqual([]);
    });

    it('maps status counts, avg metrics, order and signal analytics from raw rows', async () => {
      // Status counts (getRawMany) — first sessionQb call used by getPtStatusCounts
      // Avg metrics (getRawOne) — second sessionQb call path
      // Top algorithms (getRawMany) — third
      (sessionQb.getRawMany as jest.Mock)
        .mockResolvedValueOnce([
          { status: PaperTradingStatus.COMPLETED, count: '3' },
          { status: PaperTradingStatus.ACTIVE, count: '2' }
        ])
        .mockResolvedValueOnce([
          { algorithmId: 'algo-1', algorithmName: 'Alpha', sessionCount: '5', avgReturn: '12.5', avgSharpe: '1.8' }
        ]);
      (sessionQb.getCount as jest.Mock).mockResolvedValueOnce(5);
      (sessionQb.getRawOne as jest.Mock).mockResolvedValueOnce({
        avgSharpe: '1.25',
        avgReturn: '8.4',
        avgDrawdown: null,
        avgWinRate: '0.65'
      });

      (orderQb.getRawOne as jest.Mock).mockResolvedValueOnce({
        totalOrders: '10',
        buyCount: '6',
        sellCount: '4',
        totalVolume: '1000.5',
        totalFees: '2.5',
        avgSlippageBps: null,
        totalPnL: '50.25'
      });
      (orderQb.getRawMany as jest.Mock).mockResolvedValueOnce([
        { symbol: 'BTC', orderCount: '4', totalVolume: '500', totalPnL: '20' }
      ]);

      (signalQb.getRawOne as jest.Mock).mockResolvedValueOnce({
        totalSignals: '8',
        processedRate: '0.75',
        avgConfidence: '0.82'
      });
      (signalQb.getRawMany as jest.Mock)
        .mockResolvedValueOnce([{ signalType: PaperTradingSignalType.ENTRY, count: '5' }])
        .mockResolvedValueOnce([{ direction: PaperTradingSignalDirection.LONG, count: '6' }]);

      const result = await service.getPaperTradingMonitoring({ algorithmId: 'algo-1' });

      expect(result.statusCounts[PaperTradingStatus.COMPLETED]).toBe(3);
      expect(result.statusCounts[PaperTradingStatus.ACTIVE]).toBe(2);
      expect(result.totalSessions).toBe(5);
      expect(result.avgMetrics).toEqual({
        sharpeRatio: 1.25,
        totalReturn: 8.4,
        maxDrawdown: 0, // null coerced via parseFloat → NaN → 0
        winRate: 0.65
      });
      expect(result.topAlgorithms).toEqual([
        { algorithmId: 'algo-1', algorithmName: 'Alpha', sessionCount: 5, avgReturn: 12.5, avgSharpe: 1.8 }
      ]);
      expect(result.orderAnalytics).toMatchObject({
        totalOrders: 10,
        buyCount: 6,
        sellCount: 4,
        totalVolume: 1000.5,
        totalFees: 2.5,
        avgSlippageBps: 0,
        totalPnL: 50.25
      });
      expect(result.orderAnalytics.bySymbol).toEqual([
        { symbol: 'BTC', orderCount: 4, totalVolume: 500, totalPnL: 20 }
      ]);
      expect(result.signalAnalytics.totalSignals).toBe(8);
      expect(result.signalAnalytics.processedRate).toBe(0.75);
      expect(result.signalAnalytics.avgConfidence).toBe(0.82);
      expect(result.signalAnalytics.byType[PaperTradingSignalType.ENTRY]).toBe(5);
      expect(result.signalAnalytics.byDirection[PaperTradingSignalDirection.LONG]).toBe(6);

      // buy/sell side parameters wired through to order query
      expect(orderQb.setParameter).toHaveBeenCalledWith('buySide', PaperTradingOrderSide.BUY);
      expect(orderQb.setParameter).toHaveBeenCalledWith('sellSide', PaperTradingOrderSide.SELL);
    });

    it('applies date range and algorithm filters when provided', async () => {
      await service.getPaperTradingMonitoring({
        startDate: '2026-01-01',
        endDate: '2026-02-01',
        algorithmId: 'algo-42'
      });

      const whereCalls = (sessionQb.where as jest.Mock).mock.calls.map((c) => c[0]);
      const andWhereCalls = (sessionQb.andWhere as jest.Mock).mock.calls.map((c) => c[0]);
      expect([...whereCalls, ...andWhereCalls]).toEqual(
        expect.arrayContaining(['s.createdAt BETWEEN :start AND :end', 's.algorithm = :algorithmId'])
      );
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
          progressPercent: 100, // COMPLETED short-circuits to 100
          totalReturn: 12.5,
          sharpeRatio: 1.2,
          duration: 'N/A',
          startedAt: null,
          createdAt: createdAt.toISOString()
        }
      ]);
      expect(result).toMatchObject({
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false
      });
    });

    it('defaults algorithmName to "Unknown" when algorithm relation is missing', async () => {
      (sessionQb.getManyAndCount as jest.Mock).mockResolvedValueOnce([
        [
          {
            id: 'sess-2',
            name: 'Orphan',
            algorithm: null,
            status: PaperTradingStatus.FAILED,
            totalReturn: null,
            sharpeRatio: null,
            duration: '1h',
            startedAt: null,
            createdAt: new Date()
          }
        ],
        1
      ]);

      const result = await service.listPaperTradingSessions({}, 1, 10);

      expect(result.data[0].algorithmName).toBe('Unknown');
      expect(result.data[0].totalReturn).toBeNull();
      expect(result.data[0].sharpeRatio).toBeNull();
      expect(result.data[0].duration).toBe('1h');
    });

    it('computes pagination flags when more pages remain', async () => {
      (sessionQb.getManyAndCount as jest.Mock).mockResolvedValueOnce([[], 25]);

      const result = await service.listPaperTradingSessions({}, 2, 10);

      expect(result).toMatchObject({
        total: 25,
        page: 2,
        limit: 10,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true
      });
      expect(sessionQb.skip).toHaveBeenCalledWith(10);
      expect(sessionQb.take).toHaveBeenCalledWith(10);
    });
  });
});
