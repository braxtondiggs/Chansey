import { Injectable } from '@nestjs/common';

import { IPromotionGate, PromotionGateResult, PromotionGateContext } from './promotion-gate.interface';

import { BacktestRun } from '../entities/backtest-run.entity';
import { StrategyConfig } from '../entities/strategy-config.entity';
import { StrategyScore } from '../entities/strategy-score.entity';

/**
 * CorrelationLimitGate
 *
 * Gate 6: Maximum Correlation with Existing Deployments
 * New strategy must have correlation < 0.7 with existing deployments.
 *
 * Rationale: Highly correlated strategies don't provide diversification.
 * Portfolio should have uncorrelated strategies for risk reduction.
 */
@Injectable()
export class CorrelationLimitGate implements IPromotionGate {
  readonly name = 'correlation-limit';
  readonly description = 'Correlation with existing deployments must be < 0.7';
  readonly priority = 6;
  readonly isCritical = false; // Warning only - can override

  private readonly MAXIMUM_CORRELATION = 0.7;

  async evaluate(
    strategyConfig: StrategyConfig,
    strategyScore: StrategyScore,
    backtestRun: BacktestRun,
    context?: PromotionGateContext
  ): Promise<PromotionGateResult> {
    // Get correlation score (calculated against existing deployments)
    const correlationScore = Number(strategyScore.componentScores.correlation.value || 0);

    // If no existing deployments, correlation is 0
    const hasExistingDeployments = (context?.existingDeployments?.length || 0) > 0;
    const passed = !hasExistingDeployments || correlationScore < this.MAXIMUM_CORRELATION;

    return {
      gateName: this.name,
      passed,
      actualValue: correlationScore.toFixed(2),
      requiredValue: `< ${this.MAXIMUM_CORRELATION}`,
      message: passed
        ? hasExistingDeployments
          ? `Correlation of ${correlationScore.toFixed(2)} provides good diversification`
          : 'First deployment - no correlation check needed'
        : `High correlation of ${correlationScore.toFixed(2)} with existing strategies`,
      severity: passed ? undefined : 'warning',
      metadata: {
        existingDeployments: context?.existingDeployments?.length || 0,
        correlationScore: strategyScore.componentScores.correlation.score,
        diversificationBenefit: correlationScore < 0.3 ? 'high' : correlationScore < 0.5 ? 'medium' : 'low'
      }
    };
  }
}
