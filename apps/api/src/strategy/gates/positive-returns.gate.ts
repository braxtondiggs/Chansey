import { Injectable } from '@nestjs/common';

import { IPromotionGate, PromotionGateResult, PromotionGateContext } from './promotion-gate.interface';

import { BacktestRun } from '../entities/backtest-run.entity';
import { StrategyConfig } from '../entities/strategy-config.entity';
import { StrategyScore } from '../entities/strategy-score.entity';

/**
 * PositiveReturnsGate
 *
 * Gate 5: Positive Returns Requirement
 * Strategy must have positive total returns in backtesting.
 *
 * Rationale: While obvious, this gate prevents accidentally promoting
 * loss-making strategies that might score well on other metrics.
 */
@Injectable()
export class PositiveReturnsGate implements IPromotionGate {
  readonly name = 'positive-returns';
  readonly description = 'Strategy must have positive total returns';
  readonly priority = 5;
  readonly isCritical = true;

  async evaluate(
    strategyConfig: StrategyConfig,
    strategyScore: StrategyScore,
    backtestRun: BacktestRun,
    context?: PromotionGateContext
  ): Promise<PromotionGateResult> {
    const totalReturn = Number(backtestRun.results?.totalReturn || 0);
    const passed = totalReturn > 0;

    return {
      gateName: this.name,
      passed,
      actualValue: `${(totalReturn * 100).toFixed(2)}%`,
      requiredValue: '> 0%',
      message: passed
        ? `Total return of ${(totalReturn * 100).toFixed(2)}% is positive`
        : `Negative total return of ${(totalReturn * 100).toFixed(2)}%`,
      severity: passed ? undefined : 'critical',
      metadata: {
        annualizedReturn: backtestRun.results?.annualizedReturn,
        sharpeRatio: backtestRun.results?.sharpeRatio,
        profitFactor: backtestRun.results?.profitFactor
      }
    };
  }
}
