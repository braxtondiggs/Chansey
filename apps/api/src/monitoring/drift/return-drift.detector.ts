import { Injectable } from '@nestjs/common';

import { Deployment } from '../../strategy/entities/deployment.entity';
import { PerformanceMetric } from '../../strategy/entities/performance-metric.entity';
import { DriftAlert } from '../entities/drift-alert.entity';

/**
 * ReturnDriftDetector
 *
 * Detects drift in cumulative returns compared to backtest expectations.
 *
 * Thresholds:
 * - < 40% underperformance: No alert
 * - 40-60% underperformance: Medium severity
 * - 60-80% underperformance: High severity
 * - > 80% underperformance: Critical severity
 * - Negative returns: Always at least high severity
 *
 * Rationale: Returns are the ultimate measure of profitability. Significant
 * underperformance vs backtest indicates the strategy is not profitable enough.
 */
@Injectable()
export class ReturnDriftDetector {
  private readonly MEDIUM_THRESHOLD = 0.4; // 40% underperformance
  private readonly HIGH_THRESHOLD = 0.6; // 60% underperformance
  private readonly CRITICAL_THRESHOLD = 0.8; // 80% underperformance

  async detect(deployment: Deployment, latestMetric: PerformanceMetric): Promise<DriftAlert | null> {
    const expectedReturn = deployment.metadata?.backtestReturn || 0.2; // Default 20% if not set

    const actualReturn = Number(latestMetric.cumulativeReturn);
    const underperformance = (expectedReturn - actualReturn) / Math.abs(expectedReturn);

    // If strategy is still profitable and close to expectations, no alert
    if (actualReturn > 0 && underperformance < this.MEDIUM_THRESHOLD) {
      return null;
    }

    // Determine severity
    let severity: 'low' | 'medium' | 'high' | 'critical';
    if (actualReturn < 0) {
      // Negative returns are always serious
      severity = 'critical';
    } else if (underperformance >= this.CRITICAL_THRESHOLD) {
      severity = 'critical';
    } else if (underperformance >= this.HIGH_THRESHOLD) {
      severity = 'high';
    } else {
      severity = 'medium';
    }

    const deviationPercent = underperformance * 100;

    const alert = new DriftAlert();
    alert.deploymentId = deployment.id;
    alert.driftType = 'return';
    alert.severity = severity;
    alert.expectedValue = expectedReturn;
    alert.actualValue = actualReturn;
    alert.deviationPercent = deviationPercent;
    alert.threshold = this.MEDIUM_THRESHOLD;
    alert.message =
      actualReturn < 0
        ? `Strategy is losing money: ${(actualReturn * 100).toFixed(2)}% total return`
        : `Returns underperforming by ${deviationPercent.toFixed(1)}%: expected ${(expectedReturn * 100).toFixed(2)}%, actual ${(actualReturn * 100).toFixed(2)}%`;
    alert.metadata = {
      daysLive: deployment.daysLive,
      cumulativePnl: Number(latestMetric.cumulativePnl),
      recommendation:
        actualReturn < 0
          ? 'Strategy is unprofitable - consider immediate demotion'
          : severity === 'critical'
            ? 'Severe underperformance - review or demote'
            : 'Monitor for improvement or consider parameter adjustment'
    };

    return alert;
  }
}
