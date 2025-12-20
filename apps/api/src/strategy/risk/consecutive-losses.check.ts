import { Injectable } from '@nestjs/common';

import { IRiskCheck, RiskCheckResult } from './risk-check.interface';

import { Deployment } from '../entities/deployment.entity';
import { PerformanceMetric } from '../entities/performance-metric.entity';

/**
 * ConsecutiveLossesCheck
 *
 * Risk Check 3: Consecutive Loss Days
 * - Warning: 10+ consecutive losing days
 * - Critical + Auto-Demote: 15+ consecutive losing days
 *
 * Rationale: 10 days is concerning but recoverable. 15+ consecutive losses
 * suggests the strategy is fundamentally broken in current market conditions.
 */
@Injectable()
export class ConsecutiveLossesCheck implements IRiskCheck {
  readonly name = 'consecutive-losses';
  readonly description = 'Detect extended losing streaks (warns at 10+ days, auto-demotes at 15+)';
  readonly priority = 3;
  readonly autoDemote = true; // Auto-demotes at critical threshold (15+ days)

  private readonly WARNING_THRESHOLD = 10;
  private readonly CRITICAL_THRESHOLD = 15;

  async evaluate(
    deployment: Deployment,
    latestMetric: PerformanceMetric | null,
    historicalMetrics?: PerformanceMetric[]
  ): Promise<RiskCheckResult> {
    if (!historicalMetrics || historicalMetrics.length < this.WARNING_THRESHOLD) {
      return {
        checkName: this.name,
        passed: true,
        actualValue: 'N/A',
        threshold: `< ${this.WARNING_THRESHOLD} days (critical at ${this.CRITICAL_THRESHOLD}+)`,
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

    const passed = consecutiveLosses < this.WARNING_THRESHOLD;
    const isCritical = consecutiveLosses >= this.CRITICAL_THRESHOLD;

    let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (isCritical) severity = 'critical';
    else if (consecutiveLosses >= this.WARNING_THRESHOLD) severity = 'high';
    else if (consecutiveLosses >= this.WARNING_THRESHOLD - 3) severity = 'medium';

    return {
      checkName: this.name,
      passed,
      actualValue: `${consecutiveLosses} days`,
      threshold: `< ${this.WARNING_THRESHOLD} days (critical at ${this.CRITICAL_THRESHOLD}+)`,
      severity,
      message: isCritical
        ? `CRITICAL: ${consecutiveLosses} consecutive losing days - automatic demotion triggered`
        : passed
          ? `${consecutiveLosses} consecutive losses within acceptable range`
          : `WARNING: ${consecutiveLosses} consecutive losing days detected`,
      recommendedAction: isCritical
        ? 'Strategy auto-demoted due to extended losing streak'
        : passed
          ? undefined
          : 'Review strategy parameters and market conditions',
      metadata: {
        consecutiveLosses,
        warningThreshold: this.WARNING_THRESHOLD,
        criticalThreshold: this.CRITICAL_THRESHOLD,
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
