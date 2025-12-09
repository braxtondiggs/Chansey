import { Injectable } from '@nestjs/common';

import { IPromotionGate, PromotionGateResult, PromotionGateContext } from './promotion-gate.interface';

import { BacktestRun } from '../entities/backtest-run.entity';
import { StrategyConfig } from '../entities/strategy-config.entity';
import { StrategyScore } from '../entities/strategy-score.entity';

/**
 * MinimumTradesGate
 *
 * Gate 2: Minimum Trade Count Requirement
 * Strategy must have executed at least 30 trades during backtesting.
 *
 * Rationale: Statistical significance requires sufficient sample size.
 * Strategies with < 30 trades may have misleading metrics.
 */
@Injectable()
export class MinimumTradesGate implements IPromotionGate {
  readonly name = 'minimum-trades';
  readonly description = 'Strategy must have executed at least 30 trades in backtest';
  readonly priority = 2;
  readonly isCritical = true;

  private readonly MINIMUM_TRADES = 30;

  async evaluate(
    strategyConfig: StrategyConfig,
    strategyScore: StrategyScore,
    backtestRun: BacktestRun,
    context?: PromotionGateContext
  ): Promise<PromotionGateResult> {
    const actualTrades = backtestRun.results?.totalTrades || 0;
    const passed = actualTrades >= this.MINIMUM_TRADES;

    return {
      gateName: this.name,
      passed,
      actualValue: actualTrades,
      requiredValue: this.MINIMUM_TRADES,
      message: passed
        ? `${actualTrades} trades exceeds minimum of ${this.MINIMUM_TRADES}`
        : `Only ${actualTrades} trades, need at least ${this.MINIMUM_TRADES}`,
      severity: passed ? undefined : 'critical',
      metadata: {
        backtestDuration: backtestRun.results?.durationDays,
        tradesPerDay: backtestRun.results?.durationDays
          ? (actualTrades / backtestRun.results.durationDays).toFixed(2)
          : null
      }
    };
  }
}
