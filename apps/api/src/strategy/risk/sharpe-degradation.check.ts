import { Injectable } from '@nestjs/common';

import { IRiskCheck, RiskCheckResult } from './risk-check.interface';

import { Deployment } from '../entities/deployment.entity';
import { PerformanceMetric } from '../entities/performance-metric.entity';

/**
 * SharpeDegradationCheck
 *
 * Risk Check 5: Sharpe Ratio Degradation
 * Triggers if live Sharpe ratio is 50%+ worse than backtest Sharpe.
 *
 * Rationale: Significant Sharpe degradation indicates the strategy is not
 * generating risk-adjusted returns as expected - a sign of drift.
 */
@Injectable()
export class SharpeDegradationCheck implements IRiskCheck {
  readonly name = 'sharpe-degradation';
  readonly description = 'Detect if Sharpe ratio degrades 50%+ from backtest';
  readonly priority = 5;
  readonly autoDemote = false; // Warning only, requires multiple confirmations

  private readonly DEGRADATION_THRESHOLD = 0.5; // 50% degradation

  async evaluate(
    deployment: Deployment,
    latestMetric: PerformanceMetric | null,
    historicalMetrics?: PerformanceMetric[]
  ): Promise<RiskCheckResult> {
    if (!latestMetric || latestMetric.sharpeRatio === null) {
      return {
        checkName: this.name,
        passed: true,
        actualValue: 'N/A',
        threshold: 'N/A',
        severity: 'low',
        message: 'Sharpe ratio data not available yet'
      };
    }

    // Get expected Sharpe from backtest metadata
    const expectedSharpe = deployment.metadata?.backtestSharpe || deployment.liveSharpeRatio || 1.0;
    const currentSharpe = Number(latestMetric.sharpeRatio);

    // Calculate degradation percentage
    const degradation = (expectedSharpe - currentSharpe) / Math.abs(expectedSharpe);

    const passed = degradation < this.DEGRADATION_THRESHOLD;

    let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (degradation >= 0.8)
      severity = 'critical'; // 80%+ degradation
    else if (degradation >= 0.65)
      severity = 'high'; // 65%+ degradation
    else if (degradation >= 0.5) severity = 'medium'; // 50%+ degradation

    return {
      checkName: this.name,
      passed,
      actualValue: currentSharpe.toFixed(2),
      threshold: `> ${(expectedSharpe * (1 - this.DEGRADATION_THRESHOLD)).toFixed(2)}`,
      severity,
      message: passed
        ? `Sharpe of ${currentSharpe.toFixed(2)} within acceptable range`
        : `WARNING: Sharpe degraded ${(degradation * 100).toFixed(1)}% from expected ${expectedSharpe.toFixed(2)}`,
      recommendedAction: passed
        ? undefined
        : degradation >= 0.65
          ? 'Consider demoting strategy - significant performance drift detected'
          : 'Monitor closely for continued degradation',
      metadata: {
        expectedSharpe: expectedSharpe.toFixed(2),
        currentSharpe: currentSharpe.toFixed(2),
        degradationPercent: `${(degradation * 100).toFixed(2)}%`,
        daysLive: deployment.daysLive
      }
    };
  }
}
