import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DeploymentStatus, StrategyStatus } from '@chansey/api-interfaces';

import { DeploymentMetricsService } from './deployment-metrics.service';
import { DeploymentService } from './deployment.service';
import { Deployment } from './entities/deployment.entity';
import { type PerformanceMetric } from './entities/performance-metric.entity';
import { StrategyConfig } from './entities/strategy-config.entity';
import { StrategyScore } from './entities/strategy-score.entity';

import { AuditService } from '../audit/audit.service';

const mockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  count: jest.fn(),
  create: jest.fn((dto) => dto),
  save: jest.fn((entity) => Promise.resolve({ id: 'dep-1', ...entity })),
  update: jest.fn(),
  createQueryBuilder: jest.fn()
});

describe('DeploymentService', () => {
  let service: DeploymentService;
  let deploymentRepo: ReturnType<typeof mockRepo>;
  let strategyConfigRepo: ReturnType<typeof mockRepo>;
  let strategyScoreRepo: ReturnType<typeof mockRepo>;
  let metricsService: {
    recordPerformanceMetric: jest.Mock;
    getPerformanceMetrics: jest.Mock;
    getLatestPerformanceMetric: jest.Mock;
    getDeploymentsAtRisk: jest.Mock;
  };
  let auditService: { createAuditLog: jest.Mock };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        DeploymentService,
        { provide: getRepositoryToken(Deployment), useFactory: mockRepo },
        { provide: getRepositoryToken(StrategyConfig), useFactory: mockRepo },
        { provide: getRepositoryToken(StrategyScore), useFactory: mockRepo },
        { provide: AuditService, useValue: { createAuditLog: jest.fn() } },
        {
          provide: DeploymentMetricsService,
          useValue: {
            recordPerformanceMetric: jest.fn(),
            getPerformanceMetrics: jest.fn(),
            getLatestPerformanceMetric: jest.fn(),
            getDeploymentsAtRisk: jest.fn()
          }
        }
      ]
    }).compile();

    service = module.get(DeploymentService);
    deploymentRepo = module.get(getRepositoryToken(Deployment));
    strategyConfigRepo = module.get(getRepositoryToken(StrategyConfig));
    strategyScoreRepo = module.get(getRepositoryToken(StrategyScore));
    metricsService = module.get(DeploymentMetricsService);
    auditService = module.get(AuditService);
  });

  describe('createDeployment', () => {
    const validStrategy = { id: 'sc-1', name: 'Test Strategy', algorithm: { name: 'RSI' }, parameters: {} };
    const validScore = {
      strategyConfigId: 'sc-1',
      promotionEligible: true,
      overallScore: 85,
      grade: 'A',
      componentScores: { sharpeRatio: { value: 0.25 } }
    };

    it('should create a deployment with correct risk limits', async () => {
      strategyConfigRepo.findOne.mockResolvedValue(validStrategy);
      strategyScoreRepo.findOne.mockResolvedValue(validScore);
      deploymentRepo.findOne.mockResolvedValue(null); // no existing deployment
      deploymentRepo.count.mockResolvedValue(0);
      deploymentRepo.create.mockImplementation((dto) => dto);
      deploymentRepo.save.mockImplementation((d) => Promise.resolve({ id: 'dep-1', ...d }));
      auditService.createAuditLog.mockResolvedValue({});

      const result = await service.createDeployment('sc-1', 10, 'High score', 'user-1');

      expect(result.status).toBe(DeploymentStatus.PENDING_APPROVAL);
      expect(result.allocationPercent).toBe(10);
      // maxDrawdownLimit = min(0.25 * 1.5, 0.4) = 0.375
      expect(result.maxDrawdownLimit).toBeCloseTo(0.375);
      expect(result.dailyLossLimit).toBe(0.05);
      expect(result.positionSizeLimit).toBe(0.1);
      expect(result.approvedBy).toBe('user-1');
    });

    it('should cap maxDrawdownLimit at 0.4', async () => {
      const highSharpe = { ...validScore, componentScores: { sharpeRatio: { value: 0.5 } } };
      strategyConfigRepo.findOne.mockResolvedValue(validStrategy);
      strategyScoreRepo.findOne.mockResolvedValue(highSharpe);
      deploymentRepo.findOne.mockResolvedValue(null);
      deploymentRepo.count.mockResolvedValue(0);
      deploymentRepo.create.mockImplementation((dto) => dto);
      deploymentRepo.save.mockImplementation((d) => Promise.resolve({ id: 'dep-1', ...d }));
      auditService.createAuditLog.mockResolvedValue({});

      const result = await service.createDeployment('sc-1', 10, 'High score');

      // min(0.5 * 1.5, 0.4) = 0.4
      expect(result.maxDrawdownLimit).toBe(0.4);
    });

    it('should throw NotFoundException when strategy not found', async () => {
      strategyConfigRepo.findOne.mockResolvedValue(null);

      await expect(service.createDeployment('sc-1', 10, 'reason')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when strategy is not promotion eligible', async () => {
      strategyConfigRepo.findOne.mockResolvedValue(validStrategy);
      strategyScoreRepo.findOne.mockResolvedValue({ ...validScore, promotionEligible: false });

      await expect(service.createDeployment('sc-1', 10, 'reason')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when no score exists', async () => {
      strategyConfigRepo.findOne.mockResolvedValue(validStrategy);
      strategyScoreRepo.findOne.mockResolvedValue(null);

      await expect(service.createDeployment('sc-1', 10, 'reason')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when component scores are incomplete', async () => {
      strategyConfigRepo.findOne.mockResolvedValue(validStrategy);
      strategyScoreRepo.findOne.mockResolvedValue({
        ...validScore,
        componentScores: {} // missing sharpeRatio
      });

      await expect(service.createDeployment('sc-1', 10, 'reason')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when strategy already has active deployment', async () => {
      strategyConfigRepo.findOne.mockResolvedValue(validStrategy);
      strategyScoreRepo.findOne.mockResolvedValue(validScore);
      deploymentRepo.findOne.mockResolvedValue({ id: 'existing-dep', status: DeploymentStatus.ACTIVE });

      await expect(service.createDeployment('sc-1', 10, 'reason')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when max deployments (35) reached', async () => {
      strategyConfigRepo.findOne.mockResolvedValue(validStrategy);
      strategyScoreRepo.findOne.mockResolvedValue(validScore);
      deploymentRepo.findOne.mockResolvedValue(null);
      deploymentRepo.count.mockResolvedValue(35);

      await expect(service.createDeployment('sc-1', 10, 'reason')).rejects.toThrow(BadRequestException);
    });
  });

  describe('activateDeployment', () => {
    const pendingDeployment = {
      id: 'dep-1',
      strategyConfigId: 'sc-1',
      status: DeploymentStatus.PENDING_APPROVAL,
      isActive: false,
      isPaused: false
    };

    it('should activate a pending deployment and update strategy to LIVE', async () => {
      deploymentRepo.findOne.mockResolvedValue({ ...pendingDeployment });
      deploymentRepo.save.mockImplementation((d) => Promise.resolve({ ...d, deployedAt: new Date() }));
      strategyConfigRepo.update.mockResolvedValue({});
      auditService.createAuditLog.mockResolvedValue({});

      const result = await service.activateDeployment('dep-1', 'user-1');

      expect(result.status).toBe(DeploymentStatus.ACTIVE);
      expect(result.deployedAt).toBeInstanceOf(Date);
      expect(strategyConfigRepo.update).toHaveBeenCalledWith('sc-1', { status: StrategyStatus.LIVE });
    });

    it('should succeed even when audit logging fails', async () => {
      deploymentRepo.findOne.mockResolvedValue({ ...pendingDeployment });
      deploymentRepo.save.mockImplementation((d) => Promise.resolve({ ...d }));
      strategyConfigRepo.update.mockResolvedValue({});
      auditService.createAuditLog.mockRejectedValue(new Error('Audit DB down'));

      const result = await service.activateDeployment('dep-1');

      expect(result.status).toBe(DeploymentStatus.ACTIVE);
    });

    it('should throw BadRequestException for non-pending deployment', async () => {
      deploymentRepo.findOne.mockResolvedValue({
        ...pendingDeployment,
        status: DeploymentStatus.ACTIVE
      });

      await expect(service.activateDeployment('dep-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when deployment does not exist', async () => {
      deploymentRepo.findOne.mockResolvedValue(null);

      await expect(service.activateDeployment('dep-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('pauseDeployment', () => {
    const activeDeployment = {
      id: 'dep-1',
      strategyConfigId: 'sc-1',
      status: DeploymentStatus.ACTIVE,
      isActive: true,
      isPaused: false,
      metadata: {}
    };

    it('should pause an active deployment with reason in metadata', async () => {
      deploymentRepo.findOne.mockResolvedValue({ ...activeDeployment });
      deploymentRepo.save.mockImplementation((d) => Promise.resolve({ ...d }));
      auditService.createAuditLog.mockResolvedValue({});

      const result = await service.pauseDeployment('dep-1', 'Market volatility', 'user-1');

      expect(result.status).toBe(DeploymentStatus.PAUSED);
      expect((result.metadata as Record<string, unknown>).pauseReason).toBe('Market volatility');
      expect((result.metadata as Record<string, unknown>).pausedAt).toBeInstanceOf(Date);
    });

    it('should throw BadRequestException when deployment is not active', async () => {
      deploymentRepo.findOne.mockResolvedValue({ ...activeDeployment, isActive: false });

      await expect(service.pauseDeployment('dep-1', 'reason')).rejects.toThrow(BadRequestException);
    });
  });

  describe('resumeDeployment', () => {
    const pausedDeployment = {
      id: 'dep-1',
      strategyConfigId: 'sc-1',
      status: DeploymentStatus.PAUSED,
      isActive: false,
      isPaused: true,
      metadata: { pauseReason: 'test' }
    };

    it('should resume a paused deployment', async () => {
      deploymentRepo.findOne.mockResolvedValue({ ...pausedDeployment });
      deploymentRepo.save.mockImplementation((d) => Promise.resolve({ ...d }));
      auditService.createAuditLog.mockResolvedValue({});

      const result = await service.resumeDeployment('dep-1', 'user-1');

      expect(result.status).toBe(DeploymentStatus.ACTIVE);
      expect((result.metadata as Record<string, unknown>).resumedAt).toBeInstanceOf(Date);
    });

    it('should throw BadRequestException when deployment is not paused', async () => {
      deploymentRepo.findOne.mockResolvedValue({ ...pausedDeployment, isPaused: false });

      await expect(service.resumeDeployment('dep-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('demoteDeployment', () => {
    const activeDeployment = {
      id: 'dep-1',
      strategyConfigId: 'sc-1',
      status: DeploymentStatus.ACTIVE,
      metadata: {}
    };

    it('should demote a deployment and update strategy to DEPRECATED', async () => {
      deploymentRepo.findOne.mockResolvedValue({ ...activeDeployment });
      deploymentRepo.save.mockImplementation((d) => Promise.resolve({ ...d }));
      strategyConfigRepo.update.mockResolvedValue({});
      auditService.createAuditLog.mockResolvedValue({});

      const result = await service.demoteDeployment('dep-1', 'Poor performance', { sharpe: -0.5 });

      expect(result.status).toBe(DeploymentStatus.DEMOTED);
      expect(result.terminatedAt).toBeInstanceOf(Date);
      expect(result.terminationReason).toBe('Poor performance');
      expect(strategyConfigRepo.update).toHaveBeenCalledWith('sc-1', { status: StrategyStatus.DEPRECATED });
    });
  });

  describe('terminateDeployment', () => {
    const activeDeployment = {
      id: 'dep-1',
      strategyConfigId: 'sc-1',
      status: DeploymentStatus.ACTIVE,
      metadata: {}
    };

    it('should terminate a deployment and update strategy to DEPRECATED', async () => {
      deploymentRepo.findOne.mockResolvedValue({ ...activeDeployment });
      deploymentRepo.save.mockImplementation((d) => Promise.resolve({ ...d }));
      strategyConfigRepo.update.mockResolvedValue({});
      auditService.createAuditLog.mockResolvedValue({});

      const result = await service.terminateDeployment('dep-1', 'End of life', 'user-1');

      expect(result.status).toBe(DeploymentStatus.TERMINATED);
      expect(result.terminatedAt).toBeInstanceOf(Date);
      expect(result.terminationReason).toBe('End of life');
      expect(strategyConfigRepo.update).toHaveBeenCalledWith('sc-1', { status: StrategyStatus.DEPRECATED });
    });
  });

  describe('updateAllocation', () => {
    const activeDeployment = {
      id: 'dep-1',
      strategyConfigId: 'sc-1',
      status: DeploymentStatus.ACTIVE,
      isActive: true,
      allocationPercent: 10,
      metadata: {}
    };

    it('should update allocation and track change in metadata', async () => {
      deploymentRepo.findOne.mockResolvedValue({ ...activeDeployment });
      deploymentRepo.save.mockImplementation((d) => Promise.resolve({ ...d }));
      auditService.createAuditLog.mockResolvedValue({});

      const result = await service.updateAllocation('dep-1', 15, 'Scaling up', 'user-1');

      expect(result.allocationPercent).toBe(15);
      expect((result.metadata as Record<string, unknown>).lastAllocationChange).toMatchObject({
        from: 10,
        to: 15,
        reason: 'Scaling up'
      });
    });

    it('should throw BadRequestException when deployment is not active', async () => {
      deploymentRepo.findOne.mockResolvedValue({ ...activeDeployment, isActive: false });

      await expect(service.updateAllocation('dep-1', 15, 'reason')).rejects.toThrow(BadRequestException);
    });
  });

  describe('recordPerformanceMetric', () => {
    const activeDeployment = {
      id: 'dep-1',
      strategyConfigId: 'sc-1',
      status: DeploymentStatus.ACTIVE,
      maxDrawdownObserved: 0.1,
      driftAlertCount: 0
    };

    it('should delegate to metrics service', async () => {
      const metricData = { date: '2026-04-01', cumulativePnl: 500 } as Partial<PerformanceMetric>;
      const expectedResult = { id: 'pm-1', deploymentId: 'dep-1', ...metricData };
      deploymentRepo.findOne.mockResolvedValue({ ...activeDeployment });
      metricsService.recordPerformanceMetric.mockResolvedValue(expectedResult);

      const result = await service.recordPerformanceMetric('dep-1', metricData);

      expect(metricsService.recordPerformanceMetric).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'dep-1' }),
        metricData
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('getDeploymentsAtRisk', () => {
    it('should delegate to metrics service with active deployments', async () => {
      const activeDeployments = [
        { id: 'dep-1', maxDrawdownLimit: 0.4, currentDrawdown: 0.35 },
        { id: 'dep-2', maxDrawdownLimit: 0.4, currentDrawdown: 0.1 }
      ];
      deploymentRepo.find.mockResolvedValue(activeDeployments);
      metricsService.getDeploymentsAtRisk.mockResolvedValue([activeDeployments[0]]);

      const result = await service.getDeploymentsAtRisk();

      expect(metricsService.getDeploymentsAtRisk).toHaveBeenCalledWith(activeDeployments);
      expect(result).toHaveLength(1);
    });
  });

  describe('hasPortfolioCapacity', () => {
    it.each([
      [0, true],
      [34, true],
      [35, false],
      [40, false]
    ])('with %i active deployments returns %s', async (count, expected) => {
      deploymentRepo.count.mockResolvedValue(count);

      expect(await service.hasPortfolioCapacity()).toBe(expected);
    });
  });

  describe('getTotalAllocation', () => {
    it('should return sum of active allocations', async () => {
      const qb = { select: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), getRawOne: jest.fn() };
      qb.getRawOne.mockResolvedValue({ total: '45.5' });
      deploymentRepo.createQueryBuilder.mockReturnValue(qb);

      expect(await service.getTotalAllocation()).toBe(45.5);
    });

    it('should return 0 when no active deployments', async () => {
      const qb = { select: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), getRawOne: jest.fn() };
      qb.getRawOne.mockResolvedValue(null);
      deploymentRepo.createQueryBuilder.mockReturnValue(qb);

      expect(await service.getTotalAllocation()).toBe(0);
    });
  });

  describe('handleError', () => {
    it('should re-throw NotFoundException as-is', async () => {
      deploymentRepo.findOne.mockRejectedValue(new NotFoundException('not found'));

      await expect(service.activateDeployment('dep-1')).rejects.toThrow(NotFoundException);
    });

    it('should wrap unknown errors in InternalServerErrorException', async () => {
      deploymentRepo.findOne.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.activateDeployment('dep-1')).rejects.toThrow(InternalServerErrorException);
    });
  });
});
