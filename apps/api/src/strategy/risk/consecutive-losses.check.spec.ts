import { DeploymentStatus } from '@chansey/api-interfaces';

import { ConsecutiveLossesCheck } from './consecutive-losses.check';

import { Deployment } from '../entities/deployment.entity';
import { PerformanceMetric } from '../entities/performance-metric.entity';

const createDeployment = (overrides: Partial<Deployment> = {}): Deployment =>
  ({
    id: 'deployment-1',
    status: DeploymentStatus.ACTIVE,
    metadata: {},
    ...overrides
  }) as Deployment;

const createMetric = (overrides: Partial<PerformanceMetric> = {}): PerformanceMetric =>
  ({
    id: 'metric-1',
    deploymentId: 'deployment-1',
    dailyPnl: 100,
    dailyReturn: 0.01,
    ...overrides
  }) as PerformanceMetric;

const createHistoricalMetrics = (losingDays: number, winningDays = 0): PerformanceMetric[] => {
  const metrics: PerformanceMetric[] = [];

  // Add winning days first (older)
  for (let i = 0; i < winningDays; i++) {
    metrics.push(createMetric({ dailyPnl: 100, dailyReturn: 0.01 }));
  }

  // Add losing days (most recent)
  for (let i = 0; i < losingDays; i++) {
    metrics.push(createMetric({ dailyPnl: -50, dailyReturn: -0.005 }));
  }

  return metrics;
};

describe('ConsecutiveLossesCheck', () => {
  let check: ConsecutiveLossesCheck;

  beforeEach(() => {
    check = new ConsecutiveLossesCheck();
  });

  describe('static properties', () => {
    it('has correct name', () => {
      expect(check.name).toBe('consecutive-losses');
    });

    it('has correct priority', () => {
      expect(check.priority).toBe(3);
    });

    it('has autoDemote enabled', () => {
      expect(check.autoDemote).toBe(true);
    });

    it('has description mentioning both thresholds', () => {
      expect(check.description).toContain('10');
      expect(check.description).toContain('15');
    });
  });

  describe('evaluate', () => {
    const deployment = createDeployment();
    const latestMetric = createMetric();

    describe('insufficient data', () => {
      it('returns passed with low severity when no historical metrics', async () => {
        const result = await check.evaluate(deployment, latestMetric, undefined);

        expect(result.passed).toBe(true);
        expect(result.severity).toBe('low');
        expect(result.message).toContain('Insufficient');
      });

      it('returns passed with low severity when less than 10 days of data', async () => {
        const metrics = createHistoricalMetrics(5);
        const result = await check.evaluate(deployment, latestMetric, metrics);

        expect(result.passed).toBe(true);
        expect(result.severity).toBe('low');
      });
    });

    describe('severity: low (0-6 consecutive losses)', () => {
      it.each([
        [0, 'low', true],
        [5, 'low', true],
        [6, 'low', true]
      ])('returns %s severity for %p consecutive losses', async (losses, severity, passed) => {
        const metrics = createHistoricalMetrics(losses, 10);
        const result = await check.evaluate(deployment, latestMetric, metrics);

        expect(result.passed).toBe(passed);
        expect(result.severity).toBe(severity);
        expect(result.actualValue).toBe(`${losses} days`);
      });
    });

    describe('severity: medium (7-9 consecutive losses)', () => {
      it.each([
        [7, 'medium', true],
        [9, 'medium', true]
      ])('returns %s severity for %p consecutive losses', async (losses, severity, passed) => {
        const metrics = createHistoricalMetrics(losses, 10);
        const result = await check.evaluate(deployment, latestMetric, metrics);

        expect(result.passed).toBe(passed);
        expect(result.severity).toBe(severity);
        expect(result.actualValue).toBe(`${losses} days`);
      });
    });

    describe('severity: high (10-14 consecutive losses) - WARNING threshold', () => {
      it.each([
        [10, 'high'],
        [14, 'high']
      ])('flags %p losses as %s severity', async (losses, severity) => {
        const metrics = createHistoricalMetrics(losses, 10);
        const result = await check.evaluate(deployment, latestMetric, metrics);

        expect(result.passed).toBe(false);
        expect(result.severity).toBe(severity);
        expect(result.actualValue).toBe(`${losses} days`);
        expect(result.recommendedAction).toBeDefined();
      });
    });

    describe('severity: critical (15+ consecutive losses) - AUTO-DEMOTE threshold', () => {
      it.each([
        [15, 'critical'],
        [20, 'critical'],
        [30, 'critical']
      ])('flags %p losses as %s severity', async (losses, severity) => {
        const metrics = createHistoricalMetrics(losses, 10);
        const result = await check.evaluate(deployment, latestMetric, metrics);

        expect(result.passed).toBe(false);
        expect(result.severity).toBe(severity);
        expect(result.actualValue).toBe(`${losses} days`);
        expect(result.recommendedAction).toBeDefined();
      });
    });

    describe('metadata', () => {
      it('includes warningThreshold and criticalThreshold in metadata', async () => {
        const metrics = createHistoricalMetrics(10, 10);
        const result = await check.evaluate(deployment, latestMetric, metrics);

        expect(result.metadata).toBeDefined();
        expect(result.metadata?.warningThreshold).toBe(10);
        expect(result.metadata?.criticalThreshold).toBe(15);
        expect(result.metadata?.consecutiveLosses).toBe(10);
        expect(result.metadata?.totalDaysReviewed).toBe(20);
      });
    });

    describe('threshold message', () => {
      it('includes both warning and critical thresholds in threshold field', async () => {
        const metrics = createHistoricalMetrics(12, 10);
        const result = await check.evaluate(deployment, latestMetric, metrics);

        expect(result.threshold).toContain('10');
        expect(result.threshold).toContain('15');
        expect(result.threshold).toContain('critical');
      });
    });

    describe('streak counting', () => {
      it('correctly counts streak that breaks in the middle', async () => {
        // Need at least 10 metrics for valid evaluation
        const metrics: PerformanceMetric[] = [
          createMetric({ dailyPnl: 100 }), // Older days - winning
          createMetric({ dailyPnl: 100 }),
          createMetric({ dailyPnl: 100 }),
          createMetric({ dailyPnl: 100 }),
          createMetric({ dailyPnl: -50 }), // Old losing streak
          createMetric({ dailyPnl: -50 }),
          createMetric({ dailyPnl: -50 }),
          createMetric({ dailyPnl: 100 }), // Breaks the streak
          createMetric({ dailyPnl: -50 }), // Current losing streak (2 days)
          createMetric({ dailyPnl: -50 })
        ];
        const result = await check.evaluate(deployment, latestMetric, metrics);

        // Should only count the 2 most recent losses
        expect(result.actualValue).toBe('2 days');
        expect(result.passed).toBe(true);
      });

      it('counts zero consecutive losses when all days are profitable', async () => {
        const metrics = createHistoricalMetrics(0, 15);
        const result = await check.evaluate(deployment, latestMetric, metrics);

        expect(result.actualValue).toBe('0 days');
        expect(result.passed).toBe(true);
        expect(result.severity).toBe('low');
      });
    });
  });
});
