import { Injectable } from '@nestjs/common';

import { IPromotionGate, PromotionGateResult, PromotionGateContext } from './promotion-gate.interface';

import { BacktestRun } from '../entities/backtest-run.entity';
import { StrategyConfig } from '../entities/strategy-config.entity';
import { StrategyScore } from '../entities/strategy-score.entity';

/**
 * PortfolioCapacityGate
 *
 * Gate 8: Portfolio Capacity Limit
 * Total active deployments must be < 35 strategies.
 *
 * Rationale: Managing more than 35 concurrent strategies becomes
 * operationally complex and dilutes allocation effectiveness.
 */
@Injectable()
export class PortfolioCapacityGate implements IPromotionGate {
  readonly name = 'portfolio-capacity';
  readonly description = 'Portfolio must have capacity (< 35 active strategies)';
  readonly priority = 8;
  readonly isCritical = true;

  private readonly MAXIMUM_STRATEGIES = 35;

  async evaluate(
    strategyConfig: StrategyConfig,
    strategyScore: StrategyScore,
    backtestRun: BacktestRun,
    context?: PromotionGateContext
  ): Promise<PromotionGateResult> {
    const activeDeployments = context?.existingDeployments?.length || 0;
    const passed = activeDeployments < this.MAXIMUM_STRATEGIES;

    return {
      gateName: this.name,
      passed,
      actualValue: activeDeployments,
      requiredValue: `< ${this.MAXIMUM_STRATEGIES}`,
      message: passed
        ? `Portfolio has capacity (${activeDeployments}/${this.MAXIMUM_STRATEGIES} active)`
        : `Portfolio at capacity (${activeDeployments}/${this.MAXIMUM_STRATEGIES} active)`,
      severity: passed ? undefined : 'critical',
      metadata: {
        utilizationPercent: ((activeDeployments / this.MAXIMUM_STRATEGIES) * 100).toFixed(1),
        remainingCapacity: Math.max(0, this.MAXIMUM_STRATEGIES - activeDeployments),
        totalAllocation: context?.totalAllocation
      }
    };
  }
}
