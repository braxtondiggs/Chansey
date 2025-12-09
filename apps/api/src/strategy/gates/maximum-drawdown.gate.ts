import { Injectable } from '@nestjs/common';

import { IPromotionGate, PromotionGateResult, PromotionGateContext } from './promotion-gate.interface';

import { BacktestRun } from '../entities/backtest-run.entity';
import { StrategyConfig } from '../entities/strategy-config.entity';
import { StrategyScore } from '../entities/strategy-score.entity';

/**
 * MaximumDrawdownGate
 *
 * Gate 3: Maximum Drawdown Limit
 * Strategy must have max drawdown < 40% during backtesting.
 *
 * Rationale: Drawdowns > 40% are difficult to recover from and
 * indicate excessive risk exposure.
 */
@Injectable()
export class MaximumDrawdownGate implements IPromotionGate {
  readonly name = 'maximum-drawdown';
  readonly description = 'Maximum drawdown must be less than 40%';
  readonly priority = 3;
  readonly isCritical = true;

  private readonly MAXIMUM_DRAWDOWN = 0.4; // 40%

  async evaluate(
    strategyConfig: StrategyConfig,
    strategyScore: StrategyScore,
    backtestRun: BacktestRun,
    context?: PromotionGateContext
  ): Promise<PromotionGateResult> {
    const actualDrawdown = Math.abs(Number(backtestRun.results?.maxDrawdown || 0));
    const passed = actualDrawdown < this.MAXIMUM_DRAWDOWN;

    return {
      gateName: this.name,
      passed,
      actualValue: `${(actualDrawdown * 100).toFixed(2)}%`,
      requiredValue: `< ${(this.MAXIMUM_DRAWDOWN * 100).toFixed(0)}%`,
      message: passed
        ? `Max drawdown of ${(actualDrawdown * 100).toFixed(2)}% is acceptable`
        : `Max drawdown of ${(actualDrawdown * 100).toFixed(2)}% exceeds limit of ${(this.MAXIMUM_DRAWDOWN * 100).toFixed(0)}%`,
      severity: passed ? undefined : 'critical',
      metadata: {
        avgDrawdown: backtestRun.results?.avgDrawdown,
        drawdownDuration: backtestRun.results?.maxDrawdownDuration,
        recoveryTime: backtestRun.results?.avgRecoveryTime
      }
    };
  }
}
