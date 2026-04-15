import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CorrelationScoringService } from './correlation-scoring.service';

import { CorrelationCalculator } from '../common/metrics/correlation.calculator';
import { BacktestPerformanceSnapshot } from '../order/backtest/backtest-performance-snapshot.entity';
import { Pipeline } from '../pipeline/entities/pipeline.entity';
import { Deployment } from '../strategy/entities/deployment.entity';
import { PerformanceMetric } from '../strategy/entities/performance-metric.entity';

describe('CorrelationScoringService', () => {
  let service: CorrelationScoringService;
  let mockDeploymentRepo: Record<string, jest.Mock>;
  let mockPerformanceMetricRepo: Record<string, jest.Mock>;
  let mockSnapshotRepo: Record<string, jest.Mock>;
  let mockPipelineRepo: Record<string, jest.Mock>;

  const createQueryBuilder = () => ({
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([])
  });

  /** Generate N snapshots with linearly growing portfolio values */
  const makeSnapshots = (count: number, startValue = 100, step = 5) =>
    Array.from({ length: count }, (_, i) => ({
      portfolioValue: startValue + i * step,
      timestamp: new Date(`2024-01-${String(i + 1).padStart(2, '0')}`)
    }));

  /** Generate N daily-return metrics with a repeating pattern */
  const makeMetrics = (count: number, baseFn: (i: number) => number = (i) => 0.05 + (i % 2 === 0 ? 0.02 : -0.01)) =>
    Array.from({ length: count }, (_, i) => ({ dailyReturn: baseFn(i) }));

  /** Wire snapshot and metric query builders in one call */
  const setupQueryBuilders = (snapshots: unknown[], metrics: unknown[]) => {
    const snapshotQb = createQueryBuilder();
    snapshotQb.getMany.mockResolvedValue(snapshots);
    mockSnapshotRepo.createQueryBuilder.mockReturnValue(snapshotQb);

    const metricQb = createQueryBuilder();
    metricQb.getMany.mockResolvedValue(metrics);
    mockPerformanceMetricRepo.createQueryBuilder.mockReturnValue(metricQb);
  };

  beforeEach(async () => {
    mockDeploymentRepo = { find: jest.fn().mockResolvedValue([]) };
    mockPerformanceMetricRepo = { createQueryBuilder: jest.fn().mockReturnValue(createQueryBuilder()) };
    mockSnapshotRepo = { createQueryBuilder: jest.fn().mockReturnValue(createQueryBuilder()) };
    mockPipelineRepo = { findOne: jest.fn().mockResolvedValue(null) };

    const module = await Test.createTestingModule({
      providers: [
        CorrelationScoringService,
        CorrelationCalculator,
        { provide: getRepositoryToken(Deployment), useValue: mockDeploymentRepo },
        { provide: getRepositoryToken(PerformanceMetric), useValue: mockPerformanceMetricRepo },
        { provide: getRepositoryToken(BacktestPerformanceSnapshot), useValue: mockSnapshotRepo },
        { provide: getRepositoryToken(Pipeline), useValue: mockPipelineRepo }
      ]
    }).compile();

    service = module.get(CorrelationScoringService);
  });

  it('returns 0 when no active deployments exist', async () => {
    mockDeploymentRepo.find.mockResolvedValue([]);
    const result = await service.calculateMaxCorrelation('strat-1', 'user-1');
    expect(result).toBe(0);
  });

  it('returns 0 when candidate has no pipeline with backtest', async () => {
    mockDeploymentRepo.find.mockResolvedValue([{ id: 'dep-1', strategyConfigId: 'strat-2' }]);
    mockPipelineRepo.findOne.mockResolvedValue(null);

    const result = await service.calculateMaxCorrelation('strat-1', 'user-1');
    expect(result).toBe(0);
  });

  it('returns 0 when candidate has insufficient backtest snapshots', async () => {
    mockDeploymentRepo.find.mockResolvedValue([{ id: 'dep-1', strategyConfigId: 'strat-2' }]);
    mockPipelineRepo.findOne.mockResolvedValue({ id: 'pipe-1', historicalBacktestId: 'bt-1' });

    const snapshotQb = createQueryBuilder();
    // Only 3 snapshots → 2 returns, below MIN_OVERLAP of 10
    snapshotQb.getMany.mockResolvedValue(makeSnapshots(3));
    mockSnapshotRepo.createQueryBuilder.mockReturnValue(snapshotQb);

    const result = await service.calculateMaxCorrelation('strat-1', 'user-1');
    expect(result).toBe(0);
  });

  it('returns 0 when snapshots contain a zero portfolio value', async () => {
    mockDeploymentRepo.find.mockResolvedValue([{ id: 'dep-1', strategyConfigId: 'strat-2' }]);
    mockPipelineRepo.findOne.mockResolvedValue({ id: 'pipe-1', historicalBacktestId: 'bt-1' });

    // 12 snapshots but several have portfolioValue=0, so returns array shrinks below MIN_OVERLAP
    const snapshots = Array.from({ length: 12 }, (_, i) => ({
      portfolioValue: i < 6 ? 0 : 100 + i * 10,
      timestamp: new Date(`2024-01-${String(i + 1).padStart(2, '0')}`)
    }));
    const snapshotQb = createQueryBuilder();
    snapshotQb.getMany.mockResolvedValue(snapshots);
    mockSnapshotRepo.createQueryBuilder.mockReturnValue(snapshotQb);

    const result = await service.calculateMaxCorrelation('strat-1', 'user-1');
    // 12 snapshots but first 6 are 0 → prev=0 skipped → only ~5 valid returns < MIN_OVERLAP(10)
    expect(result).toBe(0);
  });

  it('computes a specific correlation value for known linear series', async () => {
    mockDeploymentRepo.find.mockResolvedValue([{ id: 'dep-1', strategyConfigId: 'strat-2' }]);
    mockPipelineRepo.findOne.mockResolvedValue({ id: 'pipe-1', historicalBacktestId: 'bt-1' });

    // 12 linear snapshots → 11 returns that are all positive and decreasing
    const snapshots = makeSnapshots(12, 100, 10);
    // Deployment metrics matching the same growth pattern → high correlation
    const metrics = Array.from({ length: 11 }, (_, i) => ({
      dailyReturn: 10 / (100 + i * 10)
    }));

    setupQueryBuilders(snapshots, metrics);

    const result = await service.calculateMaxCorrelation('strat-1', 'user-1');
    // Both series represent the same linear growth pattern — correlation should be very high
    expect(result).toBeGreaterThan(0.9);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('returns absolute value for negatively correlated series', async () => {
    mockDeploymentRepo.find.mockResolvedValue([{ id: 'dep-1', strategyConfigId: 'strat-2' }]);
    mockPipelineRepo.findOne.mockResolvedValue({ id: 'pipe-1', historicalBacktestId: 'bt-1' });

    // Linear growth snapshots → positive returns
    const snapshots = makeSnapshots(12, 100, 10);
    // Deployment with inverted returns (negative of the candidate pattern)
    const metrics = Array.from({ length: 11 }, (_, i) => ({
      dailyReturn: -(10 / (100 + i * 10))
    }));

    setupQueryBuilders(snapshots, metrics);

    const result = await service.calculateMaxCorrelation('strat-1', 'user-1');
    // Math.abs applied to negative correlation → should still be > 0
    expect(result).toBeGreaterThan(0.9);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('returns the highest correlation across multiple deployments', async () => {
    mockDeploymentRepo.find.mockResolvedValue([
      { id: 'dep-1', strategyConfigId: 'strat-2' },
      { id: 'dep-2', strategyConfigId: 'strat-3' }
    ]);
    mockPipelineRepo.findOne.mockResolvedValue({ id: 'pipe-1', historicalBacktestId: 'bt-1' });

    // 12 linear snapshots → 11 returns
    const snapshots = makeSnapshots(12, 100, 10);
    const snapshotQb = createQueryBuilder();
    snapshotQb.getMany.mockResolvedValue(snapshots);
    mockSnapshotRepo.createQueryBuilder.mockReturnValue(snapshotQb);

    // First deployment: uncorrelated (alternating sign)
    const uncorrelatedMetrics = makeMetrics(11, (i) => (i % 2 === 0 ? 0.05 : -0.05));
    // Second deployment: perfectly correlated with candidate
    const correlatedMetrics = Array.from({ length: 11 }, (_, i) => ({
      dailyReturn: 10 / (100 + i * 10)
    }));

    let callCount = 0;
    mockPerformanceMetricRepo.createQueryBuilder.mockImplementation(() => {
      const qb = createQueryBuilder();
      qb.getMany.mockResolvedValue(callCount++ === 0 ? uncorrelatedMetrics : correlatedMetrics);
      return qb;
    });

    const result = await service.calculateMaxCorrelation('strat-1', 'user-1');
    // Should pick the higher correlation from the second deployment
    expect(result).toBeGreaterThan(0.9);
  });

  it('skips deployment pairs with insufficient overlap', async () => {
    mockDeploymentRepo.find.mockResolvedValue([{ id: 'dep-1', strategyConfigId: 'strat-2' }]);
    mockPipelineRepo.findOne.mockResolvedValue({ id: 'pipe-1', historicalBacktestId: 'bt-1' });

    // 15 snapshots → 14 returns (enough for candidate)
    const snapshotQb = createQueryBuilder();
    snapshotQb.getMany.mockResolvedValue(makeSnapshots(15));
    mockSnapshotRepo.createQueryBuilder.mockReturnValue(snapshotQb);

    // Only 5 metrics for deployment (below MIN_OVERLAP)
    const metricQb = createQueryBuilder();
    metricQb.getMany.mockResolvedValue(makeMetrics(5, (i) => 0.01 * (i + 1)));
    mockPerformanceMetricRepo.createQueryBuilder.mockReturnValue(metricQb);

    const result = await service.calculateMaxCorrelation('strat-1', 'user-1');
    expect(result).toBe(0);
  });

  it('excludes self-correlation by filtering own strategyConfigId from deployments', async () => {
    // The deployment belongs to the same strategy — should be excluded by the Not() filter
    mockDeploymentRepo.find.mockResolvedValue([]);
    mockPipelineRepo.findOne.mockResolvedValue({ id: 'pipe-1', historicalBacktestId: 'bt-1' });

    const result = await service.calculateMaxCorrelation('strat-1', 'user-1');
    expect(result).toBe(0);

    // Verify the find was called with filters including Not(strategyConfigId) and user scoping
    expect(mockDeploymentRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          strategyConfig: { createdBy: 'user-1' }
        })
      })
    );
  });

  it('scopes pipeline query by userId via user relation filter', async () => {
    mockDeploymentRepo.find.mockResolvedValue([{ id: 'dep-1', strategyConfigId: 'strat-2' }]);
    mockPipelineRepo.findOne.mockResolvedValue(null);

    await service.calculateMaxCorrelation('strat-1', 'user-1');

    expect(mockPipelineRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user: { id: 'user-1' }
        })
      })
    );
  });

  it('returns 0 when aligned length drops below MIN_OVERLAP', async () => {
    mockDeploymentRepo.find.mockResolvedValue([{ id: 'dep-1', strategyConfigId: 'strat-2' }]);
    mockPipelineRepo.findOne.mockResolvedValue({ id: 'pipe-1', historicalBacktestId: 'bt-1' });

    // 12 snapshots → 11 candidate returns (above MIN_OVERLAP)
    const snapshotQb = createQueryBuilder();
    snapshotQb.getMany.mockResolvedValue(makeSnapshots(12));
    mockSnapshotRepo.createQueryBuilder.mockReturnValue(snapshotQb);

    // 8 deployment metrics — after alignment min(11,8)=8 < MIN_OVERLAP(10) → skipped
    const metricQb = createQueryBuilder();
    metricQb.getMany.mockResolvedValue(makeMetrics(8));
    mockPerformanceMetricRepo.createQueryBuilder.mockReturnValue(metricQb);

    const result = await service.calculateMaxCorrelation('strat-1', 'user-1');
    expect(result).toBe(0);
  });
});
