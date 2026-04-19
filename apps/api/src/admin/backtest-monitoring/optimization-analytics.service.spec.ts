import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type ObjectLiteral, type Repository, type SelectQueryBuilder } from 'typeorm';

import { OptimizationAnalyticsService } from './optimization-analytics.service';

import { OptimizationResult } from '../../optimization/entities/optimization-result.entity';
import { OptimizationRun, OptimizationStatus } from '../../optimization/entities/optimization-run.entity';

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
    having: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    setParameters: jest.fn().mockReturnThis(),
    getQuery: jest.fn().mockReturnValue(''),
    getParameters: jest.fn().mockReturnValue({}),
    getCount: jest.fn().mockResolvedValue(0),
    getRawOne: jest.fn().mockResolvedValue({}),
    getRawMany: jest.fn().mockResolvedValue([]),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0])
  };
  return qb as SelectQueryBuilder<any>;
};

describe('OptimizationAnalyticsService', () => {
  let service: OptimizationAnalyticsService;
  let optimizationRunRepo: MockRepo<OptimizationRun>;
  let optimizationResultRepo: MockRepo<OptimizationResult>;
  let mockQueryBuilder: SelectQueryBuilder<any>;

  beforeEach(async () => {
    mockQueryBuilder = createMockQueryBuilder();

    optimizationRunRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      count: jest.fn().mockResolvedValue(0)
    };
    optimizationResultRepo = { createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OptimizationAnalyticsService,
        { provide: getRepositoryToken(OptimizationRun), useValue: optimizationRunRepo },
        { provide: getRepositoryToken(OptimizationResult), useValue: optimizationResultRepo }
      ]
    }).compile();

    service = module.get(OptimizationAnalyticsService);
  });

  afterEach(() => jest.clearAllMocks());

  const buildRun = (overrides: Partial<any> = {}) => ({
    id: 'run-x',
    status: OptimizationStatus.COMPLETED,
    combinationsTested: 0,
    totalCombinations: 100,
    improvement: null,
    bestScore: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    strategyConfig: { name: 'S1', algorithm: { name: 'Algo' } },
    ...overrides
  });

  describe('getOptimizationAnalytics', () => {
    it('returns aggregated analytics with zeroed values when no data', async () => {
      const result = await service.getOptimizationAnalytics({});
      expect(result.totalRuns).toBe(0);
      expect(result.avgImprovement).toBe(0);
      expect(result.topStrategies).toEqual([]);
      expect(Object.values(OptimizationStatus).every((s) => result.statusCounts[s] === 0)).toBe(true);
    });

    it('parses consolidated aggregate row into the status-count enum map', async () => {
      (mockQueryBuilder.getRawOne as jest.Mock)
        .mockResolvedValueOnce({
          [`status_${OptimizationStatus.COMPLETED}`]: '5',
          [`status_${OptimizationStatus.RUNNING}`]: '2',
          total_runs: '7',
          avg_improvement: '1.25',
          avg_best_score: '0.82',
          avg_combinations_tested: '100',
          result_summary: JSON.stringify({
            avgTrainScore: 0.6,
            avgTestScore: 0.55,
            avgDegradation: 0.08,
            avgConsistency: 0.7,
            overfittingRate: 0.1
          })
        })
        .mockResolvedValueOnce({ last24h: '1', last7d: '3', last30d: '7' });

      const result = await service.getOptimizationAnalytics({});

      expect(result.statusCounts[OptimizationStatus.COMPLETED]).toBe(5);
      expect(result.statusCounts[OptimizationStatus.RUNNING]).toBe(2);
      expect(result.totalRuns).toBe(7);
      expect(result.recentActivity).toEqual({ last24h: 1, last7d: 3, last30d: 7 });
      expect(result.avgImprovement).toBe(1.25);
      expect(result.avgBestScore).toBe(0.82);
      expect(result.avgCombinationsTested).toBe(100);
      expect(result.resultSummary).toEqual({
        avgTrainScore: 0.6,
        avgTestScore: 0.55,
        avgDegradation: 0.08,
        avgConsistency: 0.7,
        overfittingRate: 0.1
      });
    });

    it('applies date range filter when startDate/endDate are provided', async () => {
      await service.getOptimizationAnalytics({ startDate: '2026-01-01', endDate: '2026-02-01' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'r.createdAt BETWEEN :start AND :end',
        expect.objectContaining({ start: expect.any(Date), end: expect.any(Date) })
      );
    });
  });

  describe('listOptimizationRuns', () => {
    it('returns an empty page when no runs exist', async () => {
      (mockQueryBuilder.getManyAndCount as jest.Mock).mockResolvedValueOnce([[], 0]);

      const result = await service.listOptimizationRuns({}, 1, 10);

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.hasNextPage).toBe(false);
      expect(result.hasPreviousPage).toBe(false);
    });

    it.each([
      ['completed → 100%', OptimizationStatus.COMPLETED, 50, 100, 100],
      ['running partial → 25%', OptimizationStatus.RUNNING, 25, 100, 25],
      ['running with zero totalCombinations → 0%', OptimizationStatus.RUNNING, 5, 0, 0],
      ['pending → 0%', OptimizationStatus.PENDING, 10, 100, 0]
    ])('maps %s', async (_label, status, tested, total, expected) => {
      (mockQueryBuilder.getManyAndCount as jest.Mock).mockResolvedValueOnce([
        [buildRun({ status, combinationsTested: tested, totalCombinations: total })],
        1
      ]);

      const result = await service.listOptimizationRuns({}, 1, 10);

      expect(result.data[0].progressPercent).toBe(expected);
    });

    it('falls back to "Unknown" when strategyConfig is missing', async () => {
      (mockQueryBuilder.getManyAndCount as jest.Mock).mockResolvedValueOnce([[buildRun({ strategyConfig: null })], 1]);

      const result = await service.listOptimizationRuns({}, 1, 10);

      expect(result.data[0].strategyName).toBe('Unknown');
      expect(result.data[0].algorithmName).toBe('Unknown');
    });

    it('computes pagination metadata for page > 1', async () => {
      (mockQueryBuilder.getManyAndCount as jest.Mock).mockResolvedValueOnce([[buildRun()], 25]);

      const result = await service.listOptimizationRuns({}, 2, 10);

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
      expect(result.totalPages).toBe(3);
      expect(result.hasNextPage).toBe(true);
      expect(result.hasPreviousPage).toBe(true);
    });
  });
});
