import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';

import { BacktestMonitoringAnalyticsService } from './backtest-monitoring-analytics.service';
import { BacktestMonitoringQueryService } from './backtest-monitoring-query.service';
import { BacktestSortField, SortOrder } from './dto/backtest-listing.dto';
import { BacktestFiltersDto } from './dto/overview.dto';

import { Backtest, BacktestStatus, BacktestType } from '../../order/backtest/backtest.entity';

type MockRepo<T extends ObjectLiteral> = Partial<jest.Mocked<Repository<T>>>;

const createMockQueryBuilder = () => {
  const qb: Partial<SelectQueryBuilder<any>> = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(0),
    getMany: jest.fn().mockResolvedValue([]),
    andWhereExists: jest.fn().mockReturnThis()
  };
  return qb as SelectQueryBuilder<any>;
};

const createBacktest = (overrides: Partial<Backtest> = {}): Backtest => {
  const now = new Date();
  return {
    id: 'backtest-1',
    name: 'Test Backtest',
    description: 'desc',
    type: BacktestType.HISTORICAL,
    status: BacktestStatus.COMPLETED,
    initialCapital: 10000,
    finalValue: 11500,
    totalReturn: 15,
    sharpeRatio: 1.5,
    maxDrawdown: 10,
    totalTrades: 50,
    winRate: 0.6,
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-12-31'),
    createdAt: now,
    completedAt: now,
    errorMessage: null,
    processedTimestampCount: 100,
    totalTimestampCount: 100,
    algorithm: { id: 'algo-1', name: 'Test' } as any,
    user: { id: 'u-1', email: 't@t.com' } as any,
    ...overrides
  } as Backtest;
};

describe('BacktestMonitoringAnalyticsService', () => {
  let service: BacktestMonitoringAnalyticsService;
  let backtestRepo: MockRepo<Backtest>;
  let queryService: jest.Mocked<BacktestMonitoringQueryService>;
  let mockQueryBuilder: SelectQueryBuilder<any>;

  beforeEach(async () => {
    mockQueryBuilder = createMockQueryBuilder();
    backtestRepo = { createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder) };

    const queryMock = {
      getStatusCounts: jest.fn().mockResolvedValue({}),
      getTypeDistribution: jest.fn().mockResolvedValue({}),
      getAverageMetrics: jest
        .fn()
        .mockResolvedValue({ sharpeRatio: 1.5, totalReturn: 12.5, maxDrawdown: 8.2, winRate: 0.62 }),
      getRecentActivity: jest.fn().mockResolvedValue({ last24h: 5, last7d: 25, last30d: 100 }),
      getTopAlgorithms: jest.fn().mockResolvedValue([{ id: 'algo-1', name: 'RSI', avgSharpe: 2.1 }]),
      getTotalBacktests: jest.fn().mockResolvedValue(17)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BacktestMonitoringAnalyticsService,
        { provide: getRepositoryToken(Backtest), useValue: backtestRepo },
        { provide: BacktestMonitoringQueryService, useValue: queryMock }
      ]
    }).compile();

    service = module.get(BacktestMonitoringAnalyticsService);
    queryService = module.get(BacktestMonitoringQueryService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getOverview', () => {
    it('composes results from the query service', async () => {
      const result = await service.getOverview({});

      expect(queryService.getStatusCounts).toHaveBeenCalled();
      expect(queryService.getTypeDistribution).toHaveBeenCalled();
      expect(queryService.getAverageMetrics).toHaveBeenCalled();
      expect(queryService.getRecentActivity).toHaveBeenCalled();
      expect(queryService.getTopAlgorithms).toHaveBeenCalled();
      expect(queryService.getTotalBacktests).toHaveBeenCalled();

      expect(result).toMatchObject({
        averageMetrics: { sharpeRatio: 1.5, totalReturn: 12.5, maxDrawdown: 8.2, winRate: 0.62 },
        recentActivity: { last24h: 5, last7d: 25, last30d: 100 },
        totalBacktests: 17
      });
    });

    it('passes date range to query helpers when filters provided', async () => {
      const filters: BacktestFiltersDto = {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-12-31T23:59:59.999Z'
      };

      await service.getOverview(filters);

      expect(queryService.getStatusCounts).toHaveBeenCalledWith(
        filters,
        expect.objectContaining({ start: expect.any(Date), end: expect.any(Date) })
      );
    });
  });

  describe('getBacktests', () => {
    it('returns paginated backtest list', async () => {
      const backtests = [createBacktest({ id: 'bt-1' }), createBacktest({ id: 'bt-2' })];
      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValueOnce(2);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce(backtests);

      const result = await service.getBacktests({ page: 1, limit: 10 });

      expect(result.total).toBe(2);
      expect(result.data).toHaveLength(2);
      expect(result.hasNextPage).toBe(false);
    });

    it('applies search filter when provided', async () => {
      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValueOnce(0);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce([]);

      await service.getBacktests({ search: 'test', page: 1, limit: 10 });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('b.name ILIKE :search', { search: '%test%' });
    });

    it('calculates correct pagination metadata', async () => {
      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValueOnce(25);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.getBacktests({ page: 2, limit: 10 });

      expect(result).toMatchObject({ total: 25, page: 2, totalPages: 3, hasNextPage: true, hasPreviousPage: true });
    });

    it('maps whitelisted sort field to qualified column', async () => {
      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValueOnce(0);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce([]);

      await service.getBacktests({
        page: 1,
        limit: 10,
        sortBy: BacktestSortField.SHARPE_RATIO,
        sortOrder: SortOrder.ASC
      });

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('b.sharpeRatio', SortOrder.ASC);
    });

    it('falls back to createdAt when sort field is not whitelisted', async () => {
      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValueOnce(0);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce([]);

      await service.getBacktests({ page: 1, limit: 10, sortBy: 'evil; DROP TABLE' as any, sortOrder: SortOrder.DESC });

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('b.createdAt', SortOrder.DESC);
    });

    it('maps missing algorithm/user relations to safe defaults', async () => {
      const bt = createBacktest({
        id: 'bt-x',
        algorithm: undefined as any,
        user: undefined as any,
        completedAt: null as any
      });
      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValueOnce(1);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce([bt]);

      const result = await service.getBacktests({ page: 1, limit: 10 });

      expect(result.data[0]).toMatchObject({
        algorithmId: '',
        algorithmName: 'Unknown',
        userId: '',
        userEmail: undefined,
        completedAt: undefined
      });
    });
  });
});
