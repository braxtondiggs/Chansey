import { Injectable } from '@nestjs/common';

import { IRiskCheck, RiskCheckResult } from './risk-check.interface';

import { Deployment } from '../entities/deployment.entity';
import { PerformanceMetric } from '../entities/performance-metric.entity';

/**
 * DailyLossLimitCheck
 *
 * Risk Check 2: Daily Loss Limit
 * Triggers if daily loss exceeds the configured limit (default 5%).
 *
 * Rationale: Large single-day losses indicate acute risk and should
 * trigger immediate review and potential suspension.
 */
@Injectable()
export class DailyLossLimitCheck implements IRiskCheck {
  readonly name = 'daily-loss-limit';
  readonly description = 'Detect if daily loss exceeds limit';
  readonly priority = 2;
  readonly autoDemote = true;

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

    const dailyReturn = Number(latestMetric.dailyReturn);
    const dailyLossLimit = Number(deployment.dailyLossLimit);
    const isLoss = dailyReturn < 0;
    const lossAmount = Math.abs(dailyReturn);

    const passed = !isLoss || lossAmount < dailyLossLimit;

    return {
      checkName: this.name,
      passed,
      actualValue: `${(dailyReturn * 100).toFixed(2)}%`,
      threshold: `> -${(dailyLossLimit * 100).toFixed(2)}%`,
      severity: passed ? 'low' : 'critical',
      message: passed
        ? isLoss
          ? `Daily loss of ${(lossAmount * 100).toFixed(2)}% within limits`
          : `Profitable day: +${(dailyReturn * 100).toFixed(2)}%`
        : `CRITICAL: Daily loss of ${(lossAmount * 100).toFixed(2)}% exceeds limit of ${(dailyLossLimit * 100).toFixed(2)}%`,
      recommendedAction: passed ? undefined : 'Pause strategy for review',
      metadata: {
        dailyPnl: latestMetric.dailyPnl,
        date: latestMetric.date,
        tradesCount: latestMetric.tradesCount
      }
    };
  }
}
