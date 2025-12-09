import { Injectable } from '@nestjs/common';

import { IPromotionGate, PromotionGateResult, PromotionGateContext } from './promotion-gate.interface';

import { BacktestRun } from '../entities/backtest-run.entity';
import { StrategyConfig } from '../entities/strategy-config.entity';
import { StrategyScore } from '../entities/strategy-score.entity';

/**
 * MinimumScoreGate
 *
 * Gate 1: Minimum Score Requirement
 * Strategy must have an overall score of at least 70/100 to be promoted.
 *
 * Rationale: 70+ score indicates the strategy has acceptable risk-adjusted
 * returns, robustness, and diversification characteristics.
 */
@Injectable()
export class MinimumScoreGate implements IPromotionGate {
  readonly name = 'minimum-score';
  readonly description = 'Strategy must have a minimum overall score of 70/100';
  readonly priority = 1; // Check first - most important gate
  readonly isCritical = true;

  private readonly MINIMUM_SCORE = 70;

  async evaluate(
    strategyConfig: StrategyConfig,
    strategyScore: StrategyScore,
    backtestRun: BacktestRun,
    context?: PromotionGateContext
  ): Promise<PromotionGateResult> {
    const actualScore = Number(strategyScore.overallScore);
    const passed = actualScore >= this.MINIMUM_SCORE;

    return {
      gateName: this.name,
      passed,
      actualValue: actualScore,
      requiredValue: this.MINIMUM_SCORE,
      message: passed
        ? `Score of ${actualScore.toFixed(1)} meets minimum requirement`
        : `Score of ${actualScore.toFixed(1)} below minimum of ${this.MINIMUM_SCORE}`,
      severity: passed ? undefined : 'critical',
      metadata: {
        grade: strategyScore.grade,
        percentile: strategyScore.percentile
      }
    };
  }
}
