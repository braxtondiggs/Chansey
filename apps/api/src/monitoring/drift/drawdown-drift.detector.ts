import { Injectable } from '@nestjs/common';

import { Deployment } from '../../strategy/entities/deployment.entity';
import { PerformanceMetric } from '../../strategy/entities/performance-metric.entity';
import { DriftAlert } from '../entities/drift-alert.entity';

/**
 * DrawdownDriftDetector
 *
 * Detects drift in maximum drawdown - indicator of downside risk.
 *
 * Thresholds:
 * - < 25% worse than backtest: No alert
 * - 25-50% worse: Medium severity
 * - 50-75% worse: High severity
 * - > 75% worse or exceeds limit: Critical severity
 *
 * Rationale: Larger drawdowns than expected indicate the strategy is taking
 * on more risk than anticipated. This can lead to catastrophic losses.
 */
@Injectable()
export class DrawdownDriftDetector {
  private readonly MEDIUM_THRESHOLD = 0.25; // 25% worse
  private readonly HIGH_THRESHOLD = 0.5; // 50% worse
  private readonly CRITICAL_THRESHOLD = 0.75; // 75% worse

  async detect(deployment: Deployment, latestMetric: PerformanceMetric): Promise<DriftAlert | null> {
    const expectedMaxDrawdown = deployment.metadata?.backtestMaxDrawdown || 0.3; // Default 30%
    const maxDrawdownLimit = Number(deployment.maxDrawdownLimit);

    const actualMaxDrawdown = Math.abs(Number(latestMetric.maxDrawdown));

    // Check if we've breached the hard limit (this would trigger risk management)
    if (actualMaxDrawdown >= maxDrawdownLimit) {
      const alert = new DriftAlert();
      alert.deploymentId = deployment.id;
      alert.driftType = 'drawdown';
      alert.severity = 'critical';
      alert.expectedValue = maxDrawdownLimit;
      alert.actualValue = actualMaxDrawdown;
      alert.deviationPercent = (actualMaxDrawdown / maxDrawdownLimit - 1) * 100;
      alert.threshold = 1.0; // 100% of limit
      alert.message = `CRITICAL: Max drawdown ${(actualMaxDrawdown * 100).toFixed(2)}% has reached limit of ${(maxDrawdownLimit * 100).toFixed(2)}%`;
      alert.metadata = {
        currentDrawdown: Number(latestMetric.drawdown),
        recommendation: 'Drawdown limit breached - automatic demotion triggered'
      };
      return alert;
    }

    // Check drift vs backtest expectations
    const exceedance = (actualMaxDrawdown - expectedMaxDrawdown) / expectedMaxDrawdown;

    if (exceedance < this.MEDIUM_THRESHOLD) {
      return null; // Within acceptable range
    }

    // Determine severity
    let severity: 'low' | 'medium' | 'high' | 'critical';
    if (exceedance >= this.CRITICAL_THRESHOLD) {
      severity = 'critical';
    } else if (exceedance >= this.HIGH_THRESHOLD) {
      severity = 'high';
    } else {
      severity = 'medium';
    }

    const deviationPercent = exceedance * 100;

    const alert = new DriftAlert();
    alert.deploymentId = deployment.id;
    alert.driftType = 'drawdown';
    alert.severity = severity;
    alert.expectedValue = expectedMaxDrawdown;
    alert.actualValue = actualMaxDrawdown;
    alert.deviationPercent = deviationPercent;
    alert.threshold = this.MEDIUM_THRESHOLD;
    alert.message = `Max drawdown ${deviationPercent.toFixed(1)}% worse than expected: ${(actualMaxDrawdown * 100).toFixed(2)}% vs ${(expectedMaxDrawdown * 100).toFixed(2)}%`;
    alert.metadata = {
      currentDrawdown: Number(latestMetric.drawdown),
      maxDrawdownLimit: maxDrawdownLimit,
      distanceToLimit: ((maxDrawdownLimit - actualMaxDrawdown) / maxDrawdownLimit) * 100,
      recommendation:
        severity === 'critical'
          ? 'Approaching drawdown limit - consider reducing position size or demoting'
          : 'Monitor drawdown closely - strategy is riskier than expected'
    };

    return alert;
  }
}
