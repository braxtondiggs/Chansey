import { Injectable } from '@nestjs/common';

import { IPromotionGate, PromotionGateResult, PromotionGateContext } from './promotion-gate.interface';

import { BacktestRun } from '../entities/backtest-run.entity';
import { StrategyConfig } from '../entities/strategy-config.entity';
import { StrategyScore } from '../entities/strategy-score.entity';

/**
 * WFAConsistencyGate
 *
 * Gate 4: Walk-Forward Analysis Consistency
 * Performance degradation between train and test windows must be < 30%.
 *
 * Rationale: High degradation indicates overfitting - the strategy won't
 * perform well on unseen data (live trading).
 */
@Injectable()
export class WFAConsistencyGate implements IPromotionGate {
  readonly name = 'wfa-consistency';
  readonly description = 'Walk-forward degradation must be less than 30%';
  readonly priority = 4;
  readonly isCritical = true;

  private readonly MAXIMUM_DEGRADATION = 0.3; // 30%

  async evaluate(
    strategyConfig: StrategyConfig,
    strategyScore: StrategyScore,
    backtestRun: BacktestRun,
    context?: PromotionGateContext
  ): Promise<PromotionGateResult> {
    const wfaDegradation = Number(strategyScore.componentScores.wfaDegradation.value || 0);
    const passed = wfaDegradation < this.MAXIMUM_DEGRADATION;

    return {
      gateName: this.name,
      passed,
      actualValue: `${(wfaDegradation * 100).toFixed(2)}%`,
      requiredValue: `< ${(this.MAXIMUM_DEGRADATION * 100).toFixed(0)}%`,
      message: passed
        ? `WFA degradation of ${(wfaDegradation * 100).toFixed(2)}% shows good consistency`
        : `WFA degradation of ${(wfaDegradation * 100).toFixed(2)}% indicates overfitting`,
      severity: passed ? undefined : 'critical',
      metadata: {
        wfaScore: strategyScore.componentScores.wfaDegradation.score,
        windowCount: backtestRun.results?.wfaWindows,
        consistency: wfaDegradation < 0.15 ? 'excellent' : wfaDegradation < 0.25 ? 'good' : 'marginal'
      }
    };
  }
}
