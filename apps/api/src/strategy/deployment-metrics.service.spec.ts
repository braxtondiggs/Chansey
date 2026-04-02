import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Between, LessThan, MoreThan } from 'typeorm';

import { DeploymentMetricsService } from './deployment-metrics.service';
import { Deployment } from './entities/deployment.entity';
import { PerformanceMetric } from './entities/performance-metric.entity';

const mockQueryBuilder = {
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  execute: jest.fn().mockResolvedValue({})
};

const mockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((dto) => dto),
  save: jest.fn((entity) => Promise.resolve({ id: 'pm-1', ...entity })),
  update: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder)
});

describe('DeploymentMetricsService', () => {
  let service: DeploymentMetricsService;
  let deploymentRepo: ReturnType<typeof mockRepo>;
  let performanceMetricRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        DeploymentMetricsService,
        { provide: getRepositoryToken(Deployment), useFactory: mockRepo },
        { provide: getRepositoryToken(PerformanceMetric), useFactory: mockRepo }
      ]
    }).compile();

    service = module.get(DeploymentMetricsService);
    deploymentRepo = module.get(getRepositoryToken(Deployment));
    performanceMetricRepo = module.get(getRepositoryToken(PerformanceMetric));
  });

  describe('recordPerformanceMetric', () => {
    const deployment = {
      id: 'dep-1',
      strategyConfigId: 'sc-1',
      maxDrawdownObserved: 0.1,
      driftAlertCount: 0
    } as Deployment;

    it('should create a new metric and call updateDeploymentStats', async () => {
      performanceMetricRepo.findOne.mockResolvedValue(null);
      performanceMetricRepo.create.mockImplementation((dto) => dto);
      performanceMetricRepo.save.mockImplementation((d) => Promise.resolve({ id: 'pm-1', ...d }));
      deploymentRepo.update.mockResolvedValue({});

      const result = await service.recordPerformanceMetric(deployment, {
        date: '2026-04-01',
        cumulativePnl: 500
      } as Partial<PerformanceMetric>);

      expect(result.deploymentId).toBe('dep-1');
      expect(result.date).toBe('2026-04-01');
      expect(result.snapshotAt).toBeInstanceOf(Date);
      expect(performanceMetricRepo.create).toHaveBeenCalled();
      expect(deploymentRepo.update).toHaveBeenCalledWith('dep-1', expect.objectContaining({ realizedPnl: 500 }));
    });

    it('should use today as default date when none provided', async () => {
      performanceMetricRepo.findOne.mockResolvedValue(null);
      performanceMetricRepo.create.mockImplementation((dto) => dto);
      performanceMetricRepo.save.mockImplementation((d) => Promise.resolve({ id: 'pm-1', ...d }));
      deploymentRepo.update.mockResolvedValue({});

      const today = new Date().toISOString().split('T')[0];
      const result = await service.recordPerformanceMetric(deployment, {
        cumulativePnl: 100
      } as Partial<PerformanceMetric>);

      expect(result.date).toBe(today);
    });

    it('should merge into existing metric and reset snapshotAt', async () => {
      const existingMetric = { id: 'pm-1', deploymentId: 'dep-1', date: '2026-04-01', cumulativePnl: 400 };
      performanceMetricRepo.findOne.mockResolvedValue({ ...existingMetric });
      performanceMetricRepo.save.mockImplementation((d) => Promise.resolve({ ...d }));
      deploymentRepo.update.mockResolvedValue({});

      const result = await service.recordPerformanceMetric(deployment, {
        date: '2026-04-01',
        cumulativePnl: 500
      } as Partial<PerformanceMetric>);

      expect(result.cumulativePnl).toBe(500);
      expect(result.id).toBe('pm-1');
      expect(result.snapshotAt).toBeInstanceOf(Date);
      expect(performanceMetricRepo.create).not.toHaveBeenCalled();
      expect(deploymentRepo.update).toHaveBeenCalledWith('dep-1', expect.objectContaining({ realizedPnl: 500 }));
    });

    it('should return saved metric even when stats update fails', async () => {
      performanceMetricRepo.findOne.mockResolvedValue(null);
      performanceMetricRepo.create.mockImplementation((dto) => dto);
      performanceMetricRepo.save.mockImplementation((d) => Promise.resolve({ id: 'pm-1', ...d }));
      deploymentRepo.update.mockRejectedValue(new Error('DB error'));

      const result = await service.recordPerformanceMetric(deployment, {
        date: '2026-04-01',
        cumulativePnl: 500
      } as Partial<PerformanceMetric>);

      expect(result.id).toBe('pm-1');
      expect(result.cumulativePnl).toBe(500);
    });
  });

  describe('updateDeploymentStats', () => {
    const deployment = { id: 'dep-1', maxDrawdownObserved: 0.1, driftAlertCount: 0 } as Deployment;

    beforeEach(() => {
      deploymentRepo.update.mockResolvedValue({});
    });

    it('should update realizedPnl, currentDrawdown, and maxDrawdownObserved when new max exceeds existing', async () => {
      await service.updateDeploymentStats(deployment, {
        cumulativePnl: 1000,
        drawdown: 0.05,
        maxDrawdown: 0.15
      } as Partial<PerformanceMetric>);

      expect(deploymentRepo.update).toHaveBeenCalledWith(
        'dep-1',
        expect.objectContaining({
          realizedPnl: 1000,
          currentDrawdown: 0.05,
          maxDrawdownObserved: 0.15
        })
      );
    });

    it('should not update maxDrawdownObserved when new max is lower than existing', async () => {
      await service.updateDeploymentStats(deployment, {
        maxDrawdown: 0.05
      } as Partial<PerformanceMetric>);

      const updateArg = deploymentRepo.update.mock.calls[0]?.[1] ?? {};
      expect(updateArg.maxDrawdownObserved).toBeUndefined();
    });

    it('should update totalTrades from cumulativeTradesCount', async () => {
      await service.updateDeploymentStats(deployment, {
        cumulativeTradesCount: 42
      } as Partial<PerformanceMetric>);

      expect(deploymentRepo.update).toHaveBeenCalledWith('dep-1', expect.objectContaining({ totalTrades: 42 }));
    });

    it('should update liveSharpeRatio from sharpeRatio', async () => {
      await service.updateDeploymentStats(deployment, {
        sharpeRatio: 1.85
      } as Partial<PerformanceMetric>);

      expect(deploymentRepo.update).toHaveBeenCalledWith('dep-1', expect.objectContaining({ liveSharpeRatio: 1.85 }));
    });

    it('should not call update when no relevant fields present', async () => {
      await service.updateDeploymentStats(deployment, {} as Partial<PerformanceMetric>);

      expect(deploymentRepo.update).not.toHaveBeenCalled();
    });

    it('should increment drift alert count and store drift metrics', async () => {
      const driftDeployment = { ...deployment, driftAlertCount: 2 } as Deployment;

      await service.updateDeploymentStats(driftDeployment, {
        driftDetected: true,
        driftDetails: { score: 0.8 }
      } as Partial<PerformanceMetric>);

      // Drift metrics stored via regular update (without driftAlertCount)
      expect(deploymentRepo.update).toHaveBeenCalledWith(
        'dep-1',
        expect.objectContaining({
          driftMetrics: { score: 0.8 },
          lastDriftDetectedAt: expect.any(Date)
        })
      );

      // driftAlertCount incremented atomically via QueryBuilder
      expect(deploymentRepo.createQueryBuilder).toHaveBeenCalled();
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(Deployment);
      expect(mockQueryBuilder.set).toHaveBeenCalledWith({
        driftAlertCount: expect.any(Function)
      });
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('id = :id', { id: 'dep-1' });
      expect(mockQueryBuilder.execute).toHaveBeenCalled();
    });
  });

  describe('getPerformanceMetrics', () => {
    beforeEach(() => {
      performanceMetricRepo.find.mockResolvedValue([]);
    });

    it('should query by deploymentId only when no dates provided', async () => {
      const metrics = [{ id: 'pm-1', date: '2026-04-01' }];
      performanceMetricRepo.find.mockResolvedValue(metrics);

      const result = await service.getPerformanceMetrics('dep-1');

      expect(result).toEqual(metrics);
      expect(performanceMetricRepo.find).toHaveBeenCalledWith({
        where: { deploymentId: 'dep-1' },
        order: { date: 'ASC' }
      });
    });

    it('should use Between when both startDate and endDate provided', async () => {
      await service.getPerformanceMetrics('dep-1', '2026-03-01', '2026-04-01');

      expect(performanceMetricRepo.find).toHaveBeenCalledWith({
        where: { deploymentId: 'dep-1', date: Between('2026-03-01', '2026-04-01') },
        order: { date: 'ASC' }
      });
    });

    it('should use MoreThan when only startDate provided', async () => {
      await service.getPerformanceMetrics('dep-1', '2026-03-01');

      expect(performanceMetricRepo.find).toHaveBeenCalledWith({
        where: { deploymentId: 'dep-1', date: MoreThan('2026-03-01') },
        order: { date: 'ASC' }
      });
    });

    it('should use LessThan when only endDate provided', async () => {
      await service.getPerformanceMetrics('dep-1', undefined, '2026-04-01');

      expect(performanceMetricRepo.find).toHaveBeenCalledWith({
        where: { deploymentId: 'dep-1', date: LessThan('2026-04-01') },
        order: { date: 'ASC' }
      });
    });
  });

  describe('getDeploymentsAtRisk', () => {
    it('should return deployments where drawdown >= 80% of limit', async () => {
      const deployments = [
        { id: 'dep-1', maxDrawdownLimit: 0.4, currentDrawdown: 0.35 },
        { id: 'dep-2', maxDrawdownLimit: 0.4, currentDrawdown: 0.1 },
        { id: 'dep-3', maxDrawdownLimit: 0.2, currentDrawdown: 0.18 }
      ] as Deployment[];

      const result = await service.getDeploymentsAtRisk(deployments);

      expect(result).toHaveLength(2);
      expect(result.map((d: Deployment) => d.id)).toEqual(['dep-1', 'dep-3']);
    });

    it('should return empty array when no deployments at risk', async () => {
      const deployments = [{ id: 'dep-1', maxDrawdownLimit: 0.4, currentDrawdown: 0.05 }] as Deployment[];

      const result = await service.getDeploymentsAtRisk(deployments);

      expect(result).toHaveLength(0);
    });

    it('should handle empty input', async () => {
      const result = await service.getDeploymentsAtRisk([]);

      expect(result).toEqual([]);
    });
  });
});
