import { Injectable } from '@nestjs/common';

import { IRiskCheck, RiskCheckResult } from './risk-check.interface';

import { Deployment } from '../entities/deployment.entity';
import { PerformanceMetric } from '../entities/performance-metric.entity';

/**
 * ConsecutiveLossesCheck
 *
 * Risk Check 3: Consecutive Loss Days
 * Triggers if strategy has 10+ consecutive losing days.
 *
 * Rationale: Extended losing streaks indicate the strategy may no longer
 * be effective in the current market conditions.
 */
@Injectable()
export class ConsecutiveLossesCheck implements IRiskCheck {
  readonly name = 'consecutive-losses';
  readonly description = 'Detect extended losing streaks (10+ days)';
  readonly priority = 3;
  readonly autoDemote = false; // Warning only, manual review

  private readonly CONSECUTIVE_LOSS_THRESHOLD = 10;

  async evaluate(
    deployment: Deployment,
    latestMetric: PerformanceMetric | null,
    historicalMetrics?: PerformanceMetric[]
  ): Promise<RiskCheckResult> {
    if (!historicalMetrics || historicalMetrics.length < this.CONSECUTIVE_LOSS_THRESHOLD) {
      return {
        checkName: this.name,
        passed: true,
        actualValue: 'N/A',
        threshold: `${this.CONSECUTIVE_LOSS_THRESHOLD} days`,
        severity: 'low',
        message: 'Insufficient historical data for consecutive loss detection'
      };
    }

    // Count consecutive losses from most recent to oldest
    let consecutiveLosses = 0;
    for (let i = historicalMetrics.length - 1; i >= 0; i--) {
      const metric = historicalMetrics[i];
      if (Number(metric.dailyPnl) < 0) {
        consecutiveLosses++;
      } else {
        break; // Streak ended
      }
    }

    const passed = consecutiveLosses < this.CONSECUTIVE_LOSS_THRESHOLD;

    let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (consecutiveLosses >= this.CONSECUTIVE_LOSS_THRESHOLD + 5) severity = 'critical';
    else if (consecutiveLosses >= this.CONSECUTIVE_LOSS_THRESHOLD) severity = 'high';
    else if (consecutiveLosses >= this.CONSECUTIVE_LOSS_THRESHOLD - 3) severity = 'medium';

    return {
      checkName: this.name,
      passed,
      actualValue: `${consecutiveLosses} days`,
      threshold: `< ${this.CONSECUTIVE_LOSS_THRESHOLD} days`,
      severity,
      message: passed
        ? `${consecutiveLosses} consecutive losses within acceptable range`
        : `WARNING: ${consecutiveLosses} consecutive losing days detected`,
      recommendedAction: passed ? undefined : 'Review strategy parameters and market conditions',
      metadata: {
        consecutiveLosses,
        totalDaysReviewed: historicalMetrics.length,
        averageLossPerDay: this.calculateAverageLoss(historicalMetrics.slice(-consecutiveLosses))
      }
    };
  }

  private calculateAverageLoss(metrics: PerformanceMetric[]): string {
    if (metrics.length === 0) return '0%';
    const totalLoss = metrics.reduce((sum, m) => sum + Number(m.dailyReturn), 0);
    return `${((totalLoss / metrics.length) * 100).toFixed(2)}%`;
  }
}
