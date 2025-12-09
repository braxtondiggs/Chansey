import { Injectable } from '@nestjs/common';

import { IPromotionGate, PromotionGateResult, PromotionGateContext } from './promotion-gate.interface';

import { BacktestRun } from '../entities/backtest-run.entity';
import { StrategyConfig } from '../entities/strategy-config.entity';
import { StrategyScore } from '../entities/strategy-score.entity';

/**
 * VolatilityCapGate
 *
 * Gate 7: Maximum Volatility Limit
 * Strategy volatility must be < 150% annualized.
 *
 * Rationale: Excessive volatility makes returns unpredictable and
 * increases risk of large losses. Cap at 1.5x (150%) annualized.
 */
@Injectable()
export class VolatilityCapGate implements IPromotionGate {
  readonly name = 'volatility-cap';
  readonly description = 'Annualized volatility must be < 150%';
  readonly priority = 7;
  readonly isCritical = false; // Warning only

  private readonly MAXIMUM_VOLATILITY = 1.5; // 150% annualized

  async evaluate(
    strategyConfig: StrategyConfig,
    strategyScore: StrategyScore,
    backtestRun: BacktestRun,
    context?: PromotionGateContext
  ): Promise<PromotionGateResult> {
    const volatility = Number(backtestRun.results?.volatility || 0);
    const passed = volatility < this.MAXIMUM_VOLATILITY;

    return {
      gateName: this.name,
      passed,
      actualValue: `${(volatility * 100).toFixed(2)}%`,
      requiredValue: `< ${(this.MAXIMUM_VOLATILITY * 100).toFixed(0)}%`,
      message: passed
        ? `Volatility of ${(volatility * 100).toFixed(2)}% is within acceptable range`
        : `High volatility of ${(volatility * 100).toFixed(2)}% may lead to unpredictable returns`,
      severity: passed ? undefined : 'warning',
      metadata: {
        sharpeRatio: backtestRun.results?.sharpeRatio,
        sortinoRatio: backtestRun.results?.sortinoRatio,
        volatilityRank: volatility < 0.5 ? 'low' : volatility < 1.0 ? 'medium' : volatility < 1.5 ? 'high' : 'extreme'
      }
    };
  }
}
