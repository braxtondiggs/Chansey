import { DeploymentStatus } from '@chansey/api-interfaces';

import { VolatilitySpikeCheck } from './volatility-spike.check';

import { Deployment } from '../entities/deployment.entity';
import { PerformanceMetric } from '../entities/performance-metric.entity';

const createDeployment = (overrides: Partial<Deployment> = {}): Deployment =>
  ({
    id: 'deployment-1',
    status: DeploymentStatus.ACTIVE,
    metadata: {
      backtestVolatility: 0.2 // 20% expected volatility
    },
    ...overrides
  }) as Deployment;

const createMetric = (overrides: Partial<PerformanceMetric> = {}): PerformanceMetric =>
  ({
    id: 'metric-1',
    deploymentId: 'deployment-1',
    volatility: 0.25,
    sharpeRatio: 1.5,
    ...overrides
  }) as PerformanceMetric;

describe('VolatilitySpikeCheck', () => {
  let check: VolatilitySpikeCheck;

  beforeEach(() => {
    check = new VolatilitySpikeCheck();
  });

  describe('static properties', () => {
    it('has correct name', () => {
      expect(check.name).toBe('volatility-spike');
    });

    it('has correct priority', () => {
      expect(check.priority).toBe(4);
    });

    it('has autoDemote enabled', () => {
      expect(check.autoDemote).toBe(true);
    });

    it('has description mentioning both thresholds', () => {
      expect(check.description).toContain('2x');
      expect(check.description).toContain('3x');
    });
  });

  describe('evaluate', () => {
    describe('no data available', () => {
      it('returns passed with low severity when latestMetric is null', async () => {
        const deployment = createDeployment();
        const result = await check.evaluate(deployment, null);

        expect(result.passed).toBe(true);
        expect(result.severity).toBe('low');
        expect(result.message).toContain('not available');
      });

      it('returns passed with low severity when volatility is null', async () => {
        const deployment = createDeployment();
        const metric = createMetric({ volatility: null });
        const result = await check.evaluate(deployment, metric);

        expect(result.passed).toBe(true);
        expect(result.severity).toBe('low');
        expect(result.message).toContain('not available');
      });
    });

    describe('with 20% expected volatility (backtestVolatility: 0.20)', () => {
      // Warning threshold: 2x = 40%
      // Critical threshold: 3x = 60%
      const deployment = createDeployment({ metadata: { backtestVolatility: 0.2 } });

      it.each([
        [0.2, 'low', true, '20.00%'],
        [0.3, 'low', true, '30.00%'],
        [0.35, 'medium', true, '35.00%'],
        [0.39, 'medium', true, '39.00%'],
        [0.4, 'high', false, '40.00%'],
        [0.5, 'high', false, '50.00%'],
        [0.59, 'high', false, '59.00%'],
        [0.61, 'critical', false, '61.00%'],
        [0.8, 'critical', false, '80.00%'],
        [1.0, 'critical', false, '100.00%']
      ])('returns %s severity at %p volatility', async (volatility, severity, passed, expectedValue) => {
        const metric = createMetric({ volatility });
        const result = await check.evaluate(deployment, metric);

        expect(result.severity).toBe(severity);
        expect(result.passed).toBe(passed);
        expect(result.actualValue).toBe(expectedValue);
        if (!passed) {
          expect(result.recommendedAction).toBeDefined();
        }
      });
    });

    describe('default expected volatility (50% when not set)', () => {
      // Warning threshold: 2x = 100%
      // Critical threshold: 3x = 150%
      const deployment = createDeployment({ metadata: {} });

      it('uses 50% default when backtestVolatility is not set', async () => {
        const metric = createMetric({ volatility: 0.8 });
        const result = await check.evaluate(deployment, metric);

        expect(result.passed).toBe(true);
        expect(result.metadata?.expectedVolatility).toBe('50.00%');
      });

      it('returns passed=false, severity=high at 100% volatility (2x default)', async () => {
        const metric = createMetric({ volatility: 1.0 });
        const result = await check.evaluate(deployment, metric);

        expect(result.passed).toBe(false);
        expect(result.severity).toBe('high');
      });

      it('returns passed=false, severity=critical at 150% volatility (3x default)', async () => {
        const metric = createMetric({ volatility: 1.5 });
        const result = await check.evaluate(deployment, metric);

        expect(result.passed).toBe(false);
        expect(result.severity).toBe('critical');
      });
    });

    describe('metadata', () => {
      it('includes warningMultiplier and criticalMultiplier in metadata', async () => {
        const deployment = createDeployment({ metadata: { backtestVolatility: 0.2 } });
        const metric = createMetric({ volatility: 0.4 });
        const result = await check.evaluate(deployment, metric);

        expect(result.metadata).toBeDefined();
        expect(result.metadata?.warningMultiplier).toBe(2.0);
        expect(result.metadata?.criticalMultiplier).toBe(3.0);
        expect(result.metadata?.expectedVolatility).toBe('20.00%');
        expect(result.metadata?.sharpeRatio).toBe(1.5);
      });
    });

    describe('threshold message', () => {
      it('includes both warning and critical thresholds in threshold field', async () => {
        const deployment = createDeployment({ metadata: { backtestVolatility: 0.2 } });
        const metric = createMetric({ volatility: 0.4 });
        const result = await check.evaluate(deployment, metric);

        expect(result.threshold).toContain('40.00%'); // Warning threshold
        expect(result.threshold).toContain('60.00%'); // Critical threshold
        expect(result.threshold).toContain('critical');
      });
    });

    describe('edge cases', () => {
      it('handles very low expected volatility (5%)', async () => {
        const deployment = createDeployment({ metadata: { backtestVolatility: 0.05 } });
        // Warning: 10%, Critical: 15%
        const metric = createMetric({ volatility: 0.16 });
        const result = await check.evaluate(deployment, metric);

        expect(result.passed).toBe(false);
        expect(result.severity).toBe('critical');
      });

      it('handles very high expected volatility (80%)', async () => {
        const deployment = createDeployment({ metadata: { backtestVolatility: 0.8 } });
        // Warning: 160%, Critical: 240%
        const metric = createMetric({ volatility: 1.6 });
        const result = await check.evaluate(deployment, metric);

        expect(result.passed).toBe(false);
        expect(result.severity).toBe('high');
        expect(result.message).toContain('WARNING');
      });

      it('handles zero volatility gracefully', async () => {
        const deployment = createDeployment({ metadata: { backtestVolatility: 0.2 } });
        const metric = createMetric({ volatility: 0 });
        const result = await check.evaluate(deployment, metric);

        expect(result.passed).toBe(true);
        expect(result.severity).toBe('low');
        expect(result.actualValue).toBe('0.00%');
      });
    });
  });
});
