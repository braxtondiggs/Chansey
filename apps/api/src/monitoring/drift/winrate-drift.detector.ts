import { Injectable } from '@nestjs/common';

import { Deployment } from '../../strategy/entities/deployment.entity';
import { PerformanceMetric } from '../../strategy/entities/performance-metric.entity';
import { DriftAlert } from '../entities/drift-alert.entity';

/**
 * WinRateDriftDetector
 *
 * Detects drift in win rate - percentage of profitable trades.
 *
 * Thresholds:
 * - < 15% degradation: No alert
 * - 15-25% degradation: Medium severity
 * - 25-40% degradation: High severity
 * - > 40% degradation or < 40% win rate: Critical severity
 *
 * Rationale: Win rate measures consistency. A significant drop suggests the
 * strategy's entry/exit logic is no longer working as well.
 */
@Injectable()
export class WinRateDriftDetector {
  private readonly MEDIUM_THRESHOLD = 0.15; // 15 percentage points
  private readonly HIGH_THRESHOLD = 0.25; // 25 percentage points
  private readonly CRITICAL_THRESHOLD = 0.4; // 40 percentage points
  private readonly MINIMUM_WIN_RATE = 0.4; // 40% absolute minimum

  async detect(deployment: Deployment, latestMetric: PerformanceMetric): Promise<DriftAlert | null> {
    const expectedWinRate = deployment.metadata?.backtestWinRate || 0.55; // Default 55%

    if (!latestMetric.winRate) {
      return null; // No data yet
    }

    const actualWinRate = Number(latestMetric.winRate);

    // Calculate absolute degradation (in percentage points, not percent)
    const degradation = expectedWinRate - actualWinRate;

    // Check critical condition: win rate below minimum threshold
    if (actualWinRate < this.MINIMUM_WIN_RATE) {
      const alert = new DriftAlert();
      alert.deploymentId = deployment.id;
      alert.driftType = 'win_rate';
      alert.severity = 'critical';
      alert.expectedValue = this.MINIMUM_WIN_RATE;
      alert.actualValue = actualWinRate;
      alert.deviationPercent = ((this.MINIMUM_WIN_RATE - actualWinRate) / this.MINIMUM_WIN_RATE) * 100;
      alert.threshold = this.MINIMUM_WIN_RATE;
      alert.message = `CRITICAL: Win rate ${(actualWinRate * 100).toFixed(1)}% below minimum threshold of ${(this.MINIMUM_WIN_RATE * 100).toFixed(0)}%`;
      alert.metadata = {
        totalTrades: latestMetric.cumulativeTradesCount,
        winningTrades: latestMetric.winningTrades,
        losingTrades: latestMetric.losingTrades,
        recommendation: 'Win rate critically low - strategy effectiveness questionable'
      };
      return alert;
    }

    // Check drift vs backtest
    if (degradation < this.MEDIUM_THRESHOLD) {
      return null; // Within acceptable range
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

    const deviationPercent = (degradation / expectedWinRate) * 100;

    const alert = new DriftAlert();
    alert.deploymentId = deployment.id;
    alert.driftType = 'win_rate';
    alert.severity = severity;
    alert.expectedValue = expectedWinRate;
    alert.actualValue = actualWinRate;
    alert.deviationPercent = deviationPercent;
    alert.threshold = this.MEDIUM_THRESHOLD;
    alert.message = `Win rate degraded from ${(expectedWinRate * 100).toFixed(1)}% to ${(actualWinRate * 100).toFixed(1)}% (${(degradation * 100).toFixed(1)} percentage points)`;
    alert.metadata = {
      totalTrades: latestMetric.cumulativeTradesCount,
      winningTrades: latestMetric.winningTrades,
      losingTrades: latestMetric.losingTrades,
      profitFactor: latestMetric.profitFactor,
      recommendation:
        severity === 'critical'
          ? 'Strategy entry/exit logic may need review - significant win rate drop'
          : 'Monitor trade quality - win rate declining'
    };

    return alert;
  }
}
