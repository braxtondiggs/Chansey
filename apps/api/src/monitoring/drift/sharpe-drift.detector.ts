import { Injectable } from '@nestjs/common';

import { Deployment } from '../../strategy/entities/deployment.entity';
import { PerformanceMetric } from '../../strategy/entities/performance-metric.entity';
import { DriftAlert } from '../entities/drift-alert.entity';

/**
 * SharpeDriftDetector
 *
 * Detects drift in Sharpe ratio - the primary risk-adjusted return metric.
 *
 * Thresholds:
 * - < 30% degradation: No alert
 * - 30-50% degradation: Medium severity
 * - 50-70% degradation: High severity
 * - > 70% degradation: Critical severity
 *
 * Rationale: Sharpe ratio combines returns and volatility, making it a strong
 * indicator of overall strategy health. Significant degradation suggests the
 * strategy is no longer generating consistent risk-adjusted returns.
 */
@Injectable()
export class SharpeDriftDetector {
  private readonly MEDIUM_THRESHOLD = 0.3; // 30% degradation
  private readonly HIGH_THRESHOLD = 0.5; // 50% degradation
  private readonly CRITICAL_THRESHOLD = 0.7; // 70% degradation

  async detect(deployment: Deployment, latestMetric: PerformanceMetric): Promise<DriftAlert | null> {
    const expectedSharpe = deployment.metadata?.backtestSharpe || deployment.liveSharpeRatio;

    if (!expectedSharpe || !latestMetric.sharpeRatio) {
      return null; // No baseline for comparison
    }

    const actualSharpe = Number(latestMetric.sharpeRatio);
    const degradation = (expectedSharpe - actualSharpe) / Math.abs(expectedSharpe);

    // No alert if performance is similar or better
    if (degradation < this.MEDIUM_THRESHOLD) {
      return null;
    }

    // Determine severity
    let severity: 'low' | 'medium' | 'high' | 'critical';
    if (degradation >= this.CRITICAL_THRESHOLD) {
      severity = 'critical';
    } else if (degradation >= this.HIGH_THRESHOLD) {
      severity = 'high';
    } else {
      severity = 'medium';
    }

    const deviationPercent = degradation * 100;

    const alert = new DriftAlert();
    alert.deploymentId = deployment.id;
    alert.driftType = 'sharpe_ratio';
    alert.severity = severity;
    alert.expectedValue = expectedSharpe;
    alert.actualValue = actualSharpe;
    alert.deviationPercent = deviationPercent;
    alert.threshold = this.MEDIUM_THRESHOLD;
    alert.message = `Sharpe ratio degraded ${deviationPercent.toFixed(1)}% from expected ${expectedSharpe.toFixed(2)} to ${actualSharpe.toFixed(2)}`;
    alert.metadata = {
      daysLive: deployment.daysLive,
      strategyName: deployment.strategyConfig?.name,
      recommendation:
        severity === 'critical'
          ? 'Consider immediate demotion'
          : severity === 'high'
            ? 'Review strategy parameters and market conditions'
            : 'Monitor closely for continued degradation'
    };

    return alert;
  }
}
