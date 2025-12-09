import { Injectable } from '@nestjs/common';

import { Deployment } from '../../strategy/entities/deployment.entity';
import { PerformanceMetric } from '../../strategy/entities/performance-metric.entity';
import { DriftAlert } from '../entities/drift-alert.entity';

/**
 * VolatilityDriftDetector
 *
 * Detects drift in strategy volatility - measure of return variability.
 *
 * Thresholds:
 * - < 50% increase: No alert
 * - 50-100% increase: Medium severity
 * - 100-150% increase: High severity
 * - > 150% increase: Critical severity
 *
 * Rationale: Higher volatility means more unpredictable returns and increased
 * risk. A volatility spike often precedes large losses.
 */
@Injectable()
export class VolatilityDriftDetector {
  private readonly MEDIUM_THRESHOLD = 0.5; // 50% increase
  private readonly HIGH_THRESHOLD = 1.0; // 100% increase (2x)
  private readonly CRITICAL_THRESHOLD = 1.5; // 150% increase (2.5x)

  async detect(deployment: Deployment, latestMetric: PerformanceMetric): Promise<DriftAlert | null> {
    const expectedVolatility = deployment.metadata?.backtestVolatility || 0.5; // Default 50% annualized

    if (!latestMetric.volatility) {
      return null; // No data yet
    }

    const actualVolatility = Number(latestMetric.volatility);

    // Calculate increase in volatility
    const increase = (actualVolatility - expectedVolatility) / expectedVolatility;

    // No alert if volatility is similar or lower
    if (increase < this.MEDIUM_THRESHOLD) {
      return null;
    }

    // Determine severity
    let severity: 'low' | 'medium' | 'high' | 'critical';
    if (increase >= this.CRITICAL_THRESHOLD) {
      severity = 'critical';
    } else if (increase >= this.HIGH_THRESHOLD) {
      severity = 'high';
    } else {
      severity = 'medium';
    }

    const deviationPercent = increase * 100;

    const alert = new DriftAlert();
    alert.deploymentId = deployment.id;
    alert.driftType = 'volatility';
    alert.severity = severity;
    alert.expectedValue = expectedVolatility;
    alert.actualValue = actualVolatility;
    alert.deviationPercent = deviationPercent;
    alert.threshold = this.MEDIUM_THRESHOLD;
    alert.message = `Volatility spiked ${deviationPercent.toFixed(1)}% from expected ${(expectedVolatility * 100).toFixed(1)}% to ${(actualVolatility * 100).toFixed(1)}%`;
    alert.metadata = {
      sharpeRatio: latestMetric.sharpeRatio,
      currentDrawdown: Number(latestMetric.drawdown),
      marketRegime: latestMetric.marketRegime,
      recommendation:
        severity === 'critical'
          ? 'Extreme volatility - consider reducing position size or pausing'
          : severity === 'high'
            ? 'High volatility detected - review risk exposure'
            : 'Monitor volatility - returns becoming more unpredictable'
    };

    return alert;
  }
}
