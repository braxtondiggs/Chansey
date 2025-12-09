import { Injectable } from '@nestjs/common';

import { IRiskCheck, RiskCheckResult } from './risk-check.interface';

import { Deployment } from '../entities/deployment.entity';
import { PerformanceMetric } from '../entities/performance-metric.entity';

/**
 * VolatilitySpikeCheck
 *
 * Risk Check 4: Volatility Spike Detection
 * Triggers if realized volatility exceeds 2x expected volatility from backtest.
 *
 * Rationale: Unexpected volatility spikes indicate the strategy is experiencing
 * higher risk than anticipated, which may lead to outsized losses.
 */
@Injectable()
export class VolatilitySpikeCheck implements IRiskCheck {
  readonly name = 'volatility-spike';
  readonly description = 'Detect if volatility exceeds 2x expected levels';
  readonly priority = 4;
  readonly autoDemote = false; // Warning only

  private readonly VOLATILITY_MULTIPLIER = 2.0;

  async evaluate(
    deployment: Deployment,
    latestMetric: PerformanceMetric | null,
    historicalMetrics?: PerformanceMetric[]
  ): Promise<RiskCheckResult> {
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
    const spikeThreshold = expectedVolatility * this.VOLATILITY_MULTIPLIER;

    const passed = currentVolatility < spikeThreshold;

    let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (currentVolatility >= spikeThreshold * 1.5) severity = 'critical';
    else if (currentVolatility >= spikeThreshold) severity = 'high';
    else if (currentVolatility >= spikeThreshold * 0.8) severity = 'medium';

    return {
      checkName: this.name,
      passed,
      actualValue: `${(currentVolatility * 100).toFixed(2)}%`,
      threshold: `< ${(spikeThreshold * 100).toFixed(2)}%`,
      severity,
      message: passed
        ? `Volatility of ${(currentVolatility * 100).toFixed(2)}% within expected range`
        : `WARNING: Volatility of ${(currentVolatility * 100).toFixed(2)}% exceeds ${this.VOLATILITY_MULTIPLIER}x expected`,
      recommendedAction: passed ? undefined : 'Consider reducing position sizes or pausing strategy',
      metadata: {
        expectedVolatility: `${(expectedVolatility * 100).toFixed(2)}%`,
        spikeMultiplier: this.VOLATILITY_MULTIPLIER,
        sharpeRatio: latestMetric.sharpeRatio
      }
    };
  }
}
