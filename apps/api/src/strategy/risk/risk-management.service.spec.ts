import { Repository } from 'typeorm';

import { DeploymentStatus } from '@chansey/api-interfaces';

import { ConsecutiveLossesCheck } from './consecutive-losses.check';
import { DailyLossLimitCheck } from './daily-loss-limit.check';
import { DrawdownBreachCheck } from './drawdown-breach.check';
import { RiskManagementService } from './risk-management.service';
import { SharpeDegradationCheck } from './sharpe-degradation.check';
import { VolatilitySpikeCheck } from './volatility-spike.check';

import { AuditService } from '../../audit/audit.service';
import { DeploymentService } from '../deployment.service';
import { Deployment } from '../entities/deployment.entity';
import { PerformanceMetric } from '../entities/performance-metric.entity';

// Mock factories
const createDeployment = (overrides: Partial<Deployment> = {}): Deployment =>
  ({
    id: 'deployment-1',
    strategyConfigId: 'strategy-1',
    status: DeploymentStatus.ACTIVE,
    isActive: true,
    daysLive: 30,
    maxDrawdownLimit: 0.4, // 40% max drawdown limit (breach threshold = 60%)
    dailyLossLimit: 0.05, // 5% daily loss limit
    metadata: {
      backtestVolatility: 0.2, // 20% expected volatility
      backtestSharpe: 1.5
    },
    ...overrides
  }) as Deployment;

const createMetric = (overrides: Partial<PerformanceMetric> = {}): PerformanceMetric =>
  ({
    id: 'metric-1',
    deploymentId: 'deployment-1',
    dailyPnl: 100,
    dailyReturn: 0.01,
    drawdown: 0.05, // 5% drawdown (well under 60% breach threshold)
    volatility: 0.25,
    sharpeRatio: 1.5,
    ...overrides
  }) as PerformanceMetric;

// Creates historical metrics with specified winning/losing days
const createHistoricalMetrics = (losingDays: number, winningDays = 10): PerformanceMetric[] => {
  const metrics: PerformanceMetric[] = [];
  for (let i = 0; i < winningDays; i++) {
    metrics.push(createMetric({ dailyPnl: 100, dailyReturn: 0.01 }));
  }
  for (let i = 0; i < losingDays; i++) {
    metrics.push(createMetric({ dailyPnl: -50, dailyReturn: -0.005 }));
  }
  return metrics;
};

describe('RiskManagementService', () => {
  let service: RiskManagementService;
  let deploymentRepo: jest.Mocked<Repository<Deployment>>;
  let performanceMetricRepo: jest.Mocked<Repository<PerformanceMetric>>;
  let deploymentService: jest.Mocked<DeploymentService>;
  let auditService: jest.Mocked<AuditService>;

  // Risk checks
  let drawdownBreachCheck: DrawdownBreachCheck;
  let dailyLossLimitCheck: DailyLossLimitCheck;
  let consecutiveLossesCheck: ConsecutiveLossesCheck;
  let volatilitySpikeCheck: VolatilitySpikeCheck;
  let sharpeDegradationCheck: SharpeDegradationCheck;
  let mockHistoricalMetrics: (metrics: PerformanceMetric[]) => void;

  beforeEach(() => {
    deploymentRepo = {
      findOne: jest.fn()
    } as unknown as jest.Mocked<Repository<Deployment>>;

    const makeQueryBuilder = () => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([])
    });
    performanceMetricRepo = {
      createQueryBuilder: jest.fn().mockImplementation(() => makeQueryBuilder())
    } as unknown as jest.Mocked<Repository<PerformanceMetric>>;

    mockHistoricalMetrics = (metrics: PerformanceMetric[]) => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(metrics)
      };
      (performanceMetricRepo.createQueryBuilder as jest.Mock).mockReturnValueOnce(qb as any);
    };

    deploymentService = {
      findOne: jest.fn(),
      getLatestPerformanceMetric: jest.fn(),
      getActiveDeployments: jest.fn(),
      demoteDeployment: jest.fn()
    } as unknown as jest.Mocked<DeploymentService>;

    auditService = {
      createAuditLog: jest.fn()
    } as unknown as jest.Mocked<AuditService>;

    // Create real check instances
    drawdownBreachCheck = new DrawdownBreachCheck();
    dailyLossLimitCheck = new DailyLossLimitCheck();
    consecutiveLossesCheck = new ConsecutiveLossesCheck();
    volatilitySpikeCheck = new VolatilitySpikeCheck();
    sharpeDegradationCheck = new SharpeDegradationCheck();

    service = new RiskManagementService(
      deploymentRepo,
      performanceMetricRepo,
      deploymentService,
      auditService,
      drawdownBreachCheck,
      dailyLossLimitCheck,
      consecutiveLossesCheck,
      volatilitySpikeCheck,
      sharpeDegradationCheck
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('auto-demotion flow', () => {
    describe('ConsecutiveLossesCheck auto-demotion', () => {
      it('triggers auto-demotion when 15+ consecutive losses (critical severity)', async () => {
        const deployment = createDeployment();
        const latestMetric = createMetric();
        const historicalMetrics = createHistoricalMetrics(15, 10); // 15 consecutive losses

        deploymentService.findOne.mockResolvedValue(deployment);
        deploymentService.getLatestPerformanceMetric.mockResolvedValue(latestMetric);
        mockHistoricalMetrics(historicalMetrics);

        const evaluation = await service.evaluateRisks(deployment.id);

        expect(evaluation.shouldDemote).toBe(true);
        expect(evaluation.hasCriticalRisk).toBe(true);
        expect(evaluation.failedChecks).toContain('consecutive-losses');
        expect(deploymentService.demoteDeployment).toHaveBeenCalledWith(
          deployment.id,
          expect.stringContaining('consecutive-losses'),
          expect.objectContaining({ autoDemotion: true })
        );
      });

      it('does NOT trigger auto-demotion for 10-14 consecutive losses (high severity warning)', async () => {
        const deployment = createDeployment();
        const latestMetric = createMetric();
        const historicalMetrics = createHistoricalMetrics(12, 10); // 12 consecutive losses (warning)

        deploymentService.findOne.mockResolvedValue(deployment);
        deploymentService.getLatestPerformanceMetric.mockResolvedValue(latestMetric);
        mockHistoricalMetrics(historicalMetrics);

        const evaluation = await service.evaluateRisks(deployment.id);

        // Check failed but not critical
        const consecutiveLossResult = evaluation.checkResults.find((r) => r.checkName === 'consecutive-losses');
        expect(consecutiveLossResult?.passed).toBe(false);
        expect(consecutiveLossResult?.severity).toBe('high');

        // Should NOT trigger auto-demotion for warning-level failures
        expect(evaluation.shouldDemote).toBe(false);
        expect(deploymentService.demoteDeployment).not.toHaveBeenCalled();
      });
    });

    describe('VolatilitySpikeCheck auto-demotion', () => {
      it('triggers auto-demotion when volatility >= 3x expected (critical severity)', async () => {
        const deployment = createDeployment({ metadata: { backtestVolatility: 0.2 } });
        // 65% volatility = 3.25x of 20% expected = critical
        const latestMetric = createMetric({ volatility: 0.65, drawdown: 0.05 });
        const historicalMetrics = createHistoricalMetrics(0, 15);

        deploymentService.findOne.mockResolvedValue(deployment);
        deploymentService.getLatestPerformanceMetric.mockResolvedValue(latestMetric);
        mockHistoricalMetrics(historicalMetrics);

        const evaluation = await service.evaluateRisks(deployment.id);

        expect(evaluation.shouldDemote).toBe(true);
        expect(evaluation.hasCriticalRisk).toBe(true);
        expect(evaluation.failedChecks).toContain('volatility-spike');
        expect(deploymentService.demoteDeployment).toHaveBeenCalledWith(
          deployment.id,
          expect.stringContaining('volatility-spike'),
          expect.objectContaining({ autoDemotion: true })
        );
      });

      it('does NOT trigger auto-demotion for 2x-3x volatility (high severity warning)', async () => {
        const deployment = createDeployment({ metadata: { backtestVolatility: 0.2 } });
        // 50% volatility = 2.5x of 20% expected = high (warning)
        const latestMetric = createMetric({ volatility: 0.5, drawdown: 0.05 });
        const historicalMetrics = createHistoricalMetrics(0, 15);

        deploymentService.findOne.mockResolvedValue(deployment);
        deploymentService.getLatestPerformanceMetric.mockResolvedValue(latestMetric);
        mockHistoricalMetrics(historicalMetrics);

        const evaluation = await service.evaluateRisks(deployment.id);

        const volatilityResult = evaluation.checkResults.find((r) => r.checkName === 'volatility-spike');
        expect(volatilityResult?.passed).toBe(false);
        expect(volatilityResult?.severity).toBe('high');

        // Should NOT trigger auto-demotion for warning-level failures
        expect(evaluation.shouldDemote).toBe(false);
        expect(deploymentService.demoteDeployment).not.toHaveBeenCalled();
      });
    });

    describe('SharpeDegradationCheck (autoDemote=false)', () => {
      it('does NOT trigger auto-demotion even with critical-level Sharpe degradation', async () => {
        const deployment = createDeployment({ metadata: { backtestVolatility: 0.2, backtestSharpe: 2.0 } });
        // Sharpe dropped from 2.0 to -0.5 = severe degradation
        const latestMetric = createMetric({ sharpeRatio: -0.5, volatility: 0.25, drawdown: 0.05 });
        const historicalMetrics = createHistoricalMetrics(0, 15);

        deploymentService.findOne.mockResolvedValue(deployment);
        deploymentService.getLatestPerformanceMetric.mockResolvedValue(latestMetric);
        mockHistoricalMetrics(historicalMetrics);

        const evaluation = await service.evaluateRisks(deployment.id);

        // Sharpe check should fail
        const sharpeResult = evaluation.checkResults.find((r) => r.checkName === 'sharpe-degradation');
        expect(sharpeResult?.passed).toBe(false);

        // But since autoDemote=false, should NOT auto-demote
        // (unless other checks trigger it)
        const autoDemoteFromSharpe = evaluation.checkResults.some(
          (r) => r.checkName === 'sharpe-degradation' && r.severity === 'critical'
        );
        const sharpeDegradationCheck = service.getCheck('sharpe-degradation');
        expect(sharpeDegradationCheck?.autoDemote).toBe(false);

        // If only Sharpe failed critically, should not demote
        if (autoDemoteFromSharpe && evaluation.failedChecks.length === 1) {
          expect(evaluation.shouldDemote).toBe(false);
        }
      });
    });

    describe('multiple critical failures', () => {
      it('triggers auto-demotion when multiple checks fail critically', async () => {
        const deployment = createDeployment({ metadata: { backtestVolatility: 0.2 } });
        // 65% volatility (3.25x) AND 15 consecutive losses
        const latestMetric = createMetric({ volatility: 0.65, drawdown: 0.05 });
        const historicalMetrics = createHistoricalMetrics(15, 5);

        deploymentService.findOne.mockResolvedValue(deployment);
        deploymentService.getLatestPerformanceMetric.mockResolvedValue(latestMetric);
        mockHistoricalMetrics(historicalMetrics);

        const evaluation = await service.evaluateRisks(deployment.id);

        expect(evaluation.shouldDemote).toBe(true);
        expect(evaluation.hasCriticalRisk).toBe(true);
        expect(evaluation.failedChecks).toContain('consecutive-losses');
        expect(evaluation.failedChecks).toContain('volatility-spike');

        // demoteDeployment should mention both checks
        expect(deploymentService.demoteDeployment).toHaveBeenCalledWith(
          deployment.id,
          expect.stringMatching(/consecutive-losses.*volatility-spike|volatility-spike.*consecutive-losses/),
          expect.objectContaining({ autoDemotion: true })
        );
      });
    });
  });

  describe('getChecks', () => {
    it('returns all registered risk checks', () => {
      const checks = service.getChecks();
      expect(checks.length).toBe(5);
      expect(checks.map((c) => c.name)).toEqual(
        expect.arrayContaining([
          'drawdown-breach',
          'daily-loss-limit',
          'consecutive-losses',
          'volatility-spike',
          'sharpe-degradation'
        ])
      );
    });

    it('returns checks sorted by priority', () => {
      const checks = service.getChecks();
      for (let i = 0; i < checks.length - 1; i++) {
        expect(checks[i].priority).toBeLessThanOrEqual(checks[i + 1].priority);
      }
    });
  });

  describe('getCriticalChecks', () => {
    it('returns only checks with autoDemote=true', () => {
      const criticalChecks = service.getCriticalChecks();

      // Verify all returned checks have autoDemote=true
      criticalChecks.forEach((check) => {
        expect(check.autoDemote).toBe(true);
      });

      // Verify expected checks are included
      const names = criticalChecks.map((c) => c.name);
      expect(names).toContain('drawdown-breach');
      expect(names).toContain('consecutive-losses');
      expect(names).toContain('volatility-spike');

      // SharpeDegradationCheck should NOT be in critical checks
      expect(names).not.toContain('sharpe-degradation');
    });
  });

  describe('inactive deployment handling', () => {
    it('returns empty evaluation for inactive deployments', async () => {
      const deployment = createDeployment({ isActive: false });

      deploymentService.findOne.mockResolvedValue(deployment);

      const evaluation = await service.evaluateRisks(deployment.id);

      expect(evaluation.hasCriticalRisk).toBe(false);
      expect(evaluation.shouldDemote).toBe(false);
      expect(evaluation.checkResults).toHaveLength(0);
      expect(evaluation.summary).toContain('not active');
      expect(deploymentService.demoteDeployment).not.toHaveBeenCalled();
    });
  });

  describe('audit logging', () => {
    it('logs risk evaluation to audit trail', async () => {
      const deployment = createDeployment();
      const latestMetric = createMetric();
      const historicalMetrics = createHistoricalMetrics(0, 15);

      deploymentService.findOne.mockResolvedValue(deployment);
      deploymentService.getLatestPerformanceMetric.mockResolvedValue(latestMetric);
      mockHistoricalMetrics(historicalMetrics);

      await service.evaluateRisks(deployment.id, 'user-123');

      expect(auditService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'RISK_EVALUATION',
          entityType: 'Deployment',
          entityId: deployment.id,
          userId: 'user-123',
          afterState: expect.objectContaining({
            hasCriticalRisk: expect.any(Boolean),
            shouldDemote: expect.any(Boolean)
          })
        })
      );
    });
  });
});
