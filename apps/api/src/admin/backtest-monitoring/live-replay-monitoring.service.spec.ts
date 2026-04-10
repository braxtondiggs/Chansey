import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type ObjectLiteral, type Repository, type SelectQueryBuilder } from 'typeorm';

import { LiveReplayMonitoringService } from './live-replay-monitoring.service';

import { OptimizationRun } from '../../optimization/entities/optimization-run.entity';
import { Backtest } from '../../order/backtest/backtest.entity';
import { PaperTradingSession } from '../../order/paper-trading/entities/paper-trading-session.entity';

type MockRepo<T extends ObjectLiteral> = Partial<jest.Mocked<Repository<T>>>;

const createMockQueryBuilder = () => {
  const qb: Partial<SelectQueryBuilder<any>> = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0])
  };
  return qb as SelectQueryBuilder<any>;
};

describe('LiveReplayMonitoringService', () => {
  let service: LiveReplayMonitoringService;
  let backtestRepo: MockRepo<Backtest>;
  let optimizationRunRepo: MockRepo<OptimizationRun>;
  let paperSessionRepo: MockRepo<PaperTradingSession>;
  let mockQueryBuilder: SelectQueryBuilder<any>;

  beforeEach(async () => {
    mockQueryBuilder = createMockQueryBuilder();

    backtestRepo = { createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder) };
    optimizationRunRepo = { createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder) };
    paperSessionRepo = { createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiveReplayMonitoringService,
        { provide: getRepositoryToken(Backtest), useValue: backtestRepo },
        { provide: getRepositoryToken(OptimizationRun), useValue: optimizationRunRepo },
        { provide: getRepositoryToken(PaperTradingSession), useValue: paperSessionRepo }
      ]
    }).compile();

    service = module.get(LiveReplayMonitoringService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getPipelineStageCounts', () => {
    it('returns status breakdowns for all pipeline stages', async () => {
      // Mock optimization runs
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([
        { status: 'COMPLETED', count: '5' },
        { status: 'RUNNING', count: '2' }
      ]);
      // Mock historical backtests
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([
        { status: 'COMPLETED', count: '10' },
        { status: 'FAILED', count: '1' }
      ]);
      // Mock live replay backtests
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([{ status: 'RUNNING', count: '3' }]);
      // Mock paper trading sessions
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([
        { status: 'ACTIVE', count: '4' },
        { status: 'COMPLETED', count: '6' }
      ]);

      const result = await service.getPipelineStageCounts();

      expect(result.optimizationRuns).toEqual({
        total: 7,
        statusBreakdown: { COMPLETED: 5, RUNNING: 2 }
      });
      expect(result.historicalBacktests).toEqual({
        total: 11,
        statusBreakdown: { COMPLETED: 10, FAILED: 1 }
      });
      expect(result.liveReplayBacktests).toEqual({
        total: 3,
        statusBreakdown: { RUNNING: 3 }
      });
      expect(result.paperTradingSessions).toEqual({
        total: 10,
        statusBreakdown: { ACTIVE: 4, COMPLETED: 6 }
      });
    });

    it('returns zero totals and empty breakdowns for empty pipeline stages', async () => {
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getPipelineStageCounts();

      const empty = { total: 0, statusBreakdown: {} };
      expect(result.optimizationRuns).toEqual(empty);
      expect(result.historicalBacktests).toEqual(empty);
      expect(result.liveReplayBacktests).toEqual(empty);
      expect(result.paperTradingSessions).toEqual(empty);
    });
  });

  describe('listLiveReplayRuns', () => {
    it('returns an empty page when no runs exist', async () => {
      (mockQueryBuilder.getManyAndCount as jest.Mock).mockResolvedValueOnce([[], 0]);

      const result = await service.listLiveReplayRuns({}, 1, 10);

      expect(result).toEqual({
        data: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false
      });
    });

    it('hardcodes LIVE_REPLAY type and applies pagination with correct skip/take', async () => {
      (mockQueryBuilder.getManyAndCount as jest.Mock).mockResolvedValueOnce([[], 25]);

      const result = await service.listLiveReplayRuns({}, 2, 10);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith('b.type = :type', { type: 'LIVE_REPLAY' });
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('b.createdAt', 'DESC');
      expect(result.total).toBe(25);
      expect(result.totalPages).toBe(3);
      expect(result.hasNextPage).toBe(true);
      expect(result.hasPreviousPage).toBe(true);
    });

    it('maps backtests to DTOs with null-safe fallbacks', async () => {
      const createdAt = new Date('2026-01-15T12:00:00.000Z');
      const fullRow = {
        id: 'bt-1',
        name: 'Replay A',
        algorithm: { name: 'RSI Momentum' },
        status: 'RUNNING',
        processedTimestampCount: 50,
        totalTimestampCount: 100,
        totalReturn: 12.5,
        sharpeRatio: 1.8,
        maxDrawdown: 5.2,
        liveReplayState: { replaySpeed: 2, isPaused: false },
        createdAt
      };
      const sparseRow = {
        id: 'bt-2',
        name: 'Replay B',
        algorithm: null,
        status: 'RUNNING',
        processedTimestampCount: 0,
        totalTimestampCount: 0,
        totalReturn: null,
        sharpeRatio: null,
        maxDrawdown: null,
        liveReplayState: null,
        createdAt
      };
      (mockQueryBuilder.getManyAndCount as jest.Mock).mockResolvedValueOnce([[fullRow, sparseRow], 2]);

      const result = await service.listLiveReplayRuns({}, 1, 10);

      expect(result.data[0]).toEqual({
        id: 'bt-1',
        name: 'Replay A',
        algorithmName: 'RSI Momentum',
        status: 'RUNNING',
        progressPercent: 50,
        processedTimestamps: 50,
        totalTimestamps: 100,
        totalReturn: 12.5,
        sharpeRatio: 1.8,
        maxDrawdown: 5.2,
        replaySpeed: 2,
        isPaused: false,
        createdAt: createdAt.toISOString()
      });
      expect(result.data[1]).toMatchObject({
        algorithmName: 'Unknown',
        progressPercent: 0,
        totalReturn: null,
        sharpeRatio: null,
        maxDrawdown: null,
        replaySpeed: null,
        isPaused: null
      });
    });
  });
});
