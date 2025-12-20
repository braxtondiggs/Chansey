import { Injectable } from '@nestjs/common';

import { IRiskCheck, RiskCheckResult } from './risk-check.interface';

import { Deployment } from '../entities/deployment.entity';
import { PerformanceMetric } from '../entities/performance-metric.entity';

/**
 * VolatilitySpikeCheck
 *
 * Risk Check 4: Volatility Spike Detection
 * - Warning: Volatility exceeds 2x expected
 * - Critical + Auto-Demote: Volatility exceeds 3x expected
 *
 * Rationale: 2x volatility is uncomfortable but manageable. 3x+ is dangerous
 * territory where position sizing assumptions break down and a single bad day
 * could wipe out months of gains.
 */
@Injectable()
export class VolatilitySpikeCheck implements IRiskCheck {
  readonly name = 'volatility-spike';
  readonly description = 'Detect volatility spikes (warns at 2x, auto-demotes at 3x expected)';
  readonly priority = 4;
  readonly autoDemote = true; // Auto-demotes at critical threshold (3x expected)

  private readonly WARNING_MULTIPLIER = 2.0;
  private readonly CRITICAL_MULTIPLIER = 3.0;
  private readonly EPSILON = 1e-10; // For floating point comparison precision

  async evaluate(deployment: Deployment, latestMetric: PerformanceMetric | null): Promise<RiskCheckResult> {
    if (!latestMetric || latestMetric.volatility === null) {
      return {
        checkName: this.name,
        passed: true,
        actualValue: 'N/A',
        threshold: 'N/A',
        severity: 'low',
        message: 'Volatility data not available yet'
      };
    }

    // Get expected volatility from backtest metadata
    const expectedVolatility = deployment.metadata?.backtestVolatility || 0.5; // Default 50% if not set
    const currentVolatility = Number(latestMetric.volatility);
    const warningThreshold = expectedVolatility * this.WARNING_MULTIPLIER;
    const criticalThreshold = expectedVolatility * this.CRITICAL_MULTIPLIER;

    // Use epsilon for floating point precision at exact threshold boundaries
    const passed = currentVolatility < warningThreshold;
    const isCritical = currentVolatility >= criticalThreshold - this.EPSILON;

    let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (isCritical) severity = 'critical';
    else if (currentVolatility >= warningThreshold) severity = 'high';
    else if (currentVolatility >= warningThreshold * 0.8) severity = 'medium';

    return {
      checkName: this.name,
      passed,
      actualValue: `${(currentVolatility * 100).toFixed(2)}%`,
      threshold: `< ${(warningThreshold * 100).toFixed(2)}% (critical at ${(criticalThreshold * 100).toFixed(2)}%+)`,
      severity,
      message: isCritical
        ? `CRITICAL: Volatility ${(currentVolatility * 100).toFixed(2)}% exceeds ${this.CRITICAL_MULTIPLIER}x expected - automatic demotion triggered`
        : passed
          ? `Volatility of ${(currentVolatility * 100).toFixed(2)}% within expected range`
          : `WARNING: Volatility of ${(currentVolatility * 100).toFixed(2)}% exceeds ${this.WARNING_MULTIPLIER}x expected`,
      recommendedAction: isCritical
        ? 'Strategy auto-demoted due to extreme volatility'
        : passed
          ? undefined
          : 'Consider reducing position sizes or pausing strategy',
      metadata: {
        expectedVolatility: `${(expectedVolatility * 100).toFixed(2)}%`,
        warningMultiplier: this.WARNING_MULTIPLIER,
        criticalMultiplier: this.CRITICAL_MULTIPLIER,
        sharpeRatio: latestMetric.sharpeRatio
      }
    };
  }
}
