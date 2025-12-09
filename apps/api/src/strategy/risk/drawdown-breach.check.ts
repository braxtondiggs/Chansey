import { Injectable } from '@nestjs/common';

import { IRiskCheck, RiskCheckResult } from './risk-check.interface';

import { Deployment } from '../entities/deployment.entity';
import { PerformanceMetric } from '../entities/performance-metric.entity';

/**
 * DrawdownBreachCheck
 *
 * Risk Check 1: Drawdown Breach Detection
 * Triggers if current drawdown exceeds 1.5x the backtest max drawdown limit.
 *
 * Rationale: If live drawdown significantly exceeds backtest expectations,
 * the strategy is experiencing abnormal losses and should be stopped.
 */
@Injectable()
export class DrawdownBreachCheck implements IRiskCheck {
  readonly name = 'drawdown-breach';
  readonly description = 'Detect if drawdown exceeds 1.5x backtest maximum';
  readonly priority = 1; // Highest priority - most critical risk
  readonly autoDemote = true;

  private readonly BREACH_MULTIPLIER = 1.5;

  async evaluate(
    deployment: Deployment,
    latestMetric: PerformanceMetric | null,
    historicalMetrics?: PerformanceMetric[]
  ): Promise<RiskCheckResult> {
    if (!latestMetric) {
      return {
        checkName: this.name,
        passed: true,
        actualValue: 'N/A',
        threshold: 'N/A',
        severity: 'low',
        message: 'No metrics available yet'
      };
    }

    const currentDrawdown = Math.abs(Number(latestMetric.drawdown));
    const maxDrawdownLimit = Number(deployment.maxDrawdownLimit);
    const breachThreshold = maxDrawdownLimit * this.BREACH_MULTIPLIER;

    const passed = currentDrawdown < breachThreshold;

    return {
      checkName: this.name,
      passed,
      actualValue: `${(currentDrawdown * 100).toFixed(2)}%`,
      threshold: `${(breachThreshold * 100).toFixed(2)}%`,
      severity: passed ? 'low' : 'critical',
      message: passed
        ? `Drawdown of ${(currentDrawdown * 100).toFixed(2)}% within limits`
        : `CRITICAL: Drawdown of ${(currentDrawdown * 100).toFixed(2)}% exceeds breach threshold of ${(breachThreshold * 100).toFixed(2)}%`,
      recommendedAction: passed ? undefined : 'Demote strategy immediately to prevent further losses',
      metadata: {
        maxDrawdownLimit: `${(maxDrawdownLimit * 100).toFixed(2)}%`,
        breachMultiplier: this.BREACH_MULTIPLIER,
        exceedancePercent: passed ? 0 : ((currentDrawdown / breachThreshold - 1) * 100).toFixed(2)
      }
    };
  }
}
