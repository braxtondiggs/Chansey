import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { AuditEventType, CompositeRegimeType, getRegimeMultiplier } from '@chansey/api-interfaces';

import { StrategyConfig } from './entities/strategy-config.entity';
import { StrategyScore } from './entities/strategy-score.entity';

import { AuditService } from '../audit/audit.service';
import { Order, OrderStatus } from '../order/order.entity';

export interface RegimeContext {
  compositeRegime: CompositeRegimeType;
  riskLevel: number;
}

export interface CapitalAllocation {
  strategyConfigId: string;
  allocatedCapital: number;
  percentage: number;
  score: number;
}

/**
 * Handles capital allocation across multiple strategies for robo-advisor users.
 * Uses performance-weighted allocation based on backtest scores.
 */
@Injectable()
export class CapitalAllocationService {
  private readonly logger = new Logger(CapitalAllocationService.name);

  // Allocation constraints
  private readonly MIN_ALLOCATION_PER_STRATEGY = 50; // Minimum $50 per strategy
  private readonly MAX_ALLOCATION_PERCENTAGE = 0.15; // No strategy gets more than 15%
  private readonly MIN_SCORE_THRESHOLD = 50; // Exclude strategies with score < 50

  // Kelly Criterion constants
  private readonly KELLY_MULTIPLIER = 0.25; // Quarter-Kelly for safety
  private readonly MIN_TRADES_FOR_KELLY = 30; // Minimum completed trades required

  constructor(
    @InjectRepository(StrategyScore)
    private readonly strategyScoreRepo: Repository<StrategyScore>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    private readonly auditService: AuditService
  ) {}

  /**
   * Dynamic per-strategy cap: max(15%, 1/eligible).
   * Prevents idle capital with few strategies while still diversifying with many.
   */
  private getMaxAllocationPerStrategy(userCapital: number, eligibleCount: number): number {
    const dynamicPercent = Math.max(this.MAX_ALLOCATION_PERCENTAGE, 1 / eligibleCount);
    return userCapital * dynamicPercent;
  }

  /**
   * Fetch latest scores for strategy IDs and return as a Map.
   */
  private async buildScoreMap(strategyIds: string[]): Promise<Map<string, number>> {
    const scoreMap = new Map<string, number>();
    if (strategyIds.length === 0) return scoreMap;

    const scores = await this.strategyScoreRepo.find({
      where: strategyIds.map((id) => ({ strategyConfigId: id })),
      order: { calculatedAt: 'DESC' }
    });

    for (const score of scores) {
      if (!scoreMap.has(score.strategyConfigId)) {
        scoreMap.set(score.strategyConfigId, Number(score.overallScore));
      }
    }

    return scoreMap;
  }

  /**
   * Get detailed allocation breakdown for transparency.
   */
  async getAllocationDetails(
    userCapital: number,
    strategies: StrategyConfig[],
    regimeContext?: RegimeContext
  ): Promise<CapitalAllocation[]> {
    const allocation = await this.allocateCapitalByKelly(userCapital, strategies, regimeContext);
    const details: CapitalAllocation[] = [];

    const strategyIds = strategies.map((s) => s.id);
    const scoreMap = await this.buildScoreMap(strategyIds);

    for (const [strategyConfigId, allocatedCapital] of allocation.entries()) {
      details.push({
        strategyConfigId,
        allocatedCapital,
        percentage: (allocatedCapital / userCapital) * 100,
        score: scoreMap.get(strategyConfigId) || 0
      });
    }

    // Sort by allocated capital descending
    return details.sort((a, b) => b.allocatedCapital - a.allocatedCapital);
  }

  /**
   * Calculate minimum capital required based on strategy count and minimum per strategy.
   */
  calculateMinimumCapitalRequired(strategyCount: number): number {
    return strategyCount * this.MIN_ALLOCATION_PER_STRATEGY;
  }

  /**
   * Validate if user has enough capital for allocation.
   */
  validateCapitalAllocation(userCapital: number, strategies: StrategyConfig[]): { valid: boolean; reason?: string } {
    if (userCapital <= 0) {
      return { valid: false, reason: 'Capital must be greater than 0' };
    }

    if (strategies.length === 0) {
      return { valid: false, reason: 'No strategies available for allocation' };
    }

    const minRequired = this.calculateMinimumCapitalRequired(strategies.length);
    if (userCapital < minRequired) {
      return {
        valid: false,
        reason: `Minimum capital required: $${minRequired} (${strategies.length} strategies × $${this.MIN_ALLOCATION_PER_STRATEGY})`
      };
    }

    return { valid: true };
  }

  /**
   * Allocate capital across strategies using the Kelly Criterion.
   * Uses real trade history to calculate mathematically optimal position sizing.
   * Strategies with insufficient trade history fall back to score-based allocation.
   *
   * Kelly formula: f = (b * p - q) / b
   *   f = fraction of capital to allocate
   *   b = avg win / avg loss (odds ratio)
   *   p = probability of winning
   *   q = probability of losing (1 - p)
   *
   * @param userCapital - Total capital available for allocation
   * @param strategies - Strategies to allocate capital across
   * @returns Map of strategy ID to allocated capital amount
   */
  async allocateCapitalByKelly(
    userCapital: number,
    strategies: StrategyConfig[],
    regimeContext?: RegimeContext
  ): Promise<Map<string, number>> {
    const allocation = new Map<string, number>();

    if (strategies.length === 0 || userCapital <= 0) {
      this.logger.warn('No strategies or capital provided for Kelly allocation');
      return allocation;
    }

    // Regime-scaled effective capital
    const regimeMultiplier = regimeContext
      ? getRegimeMultiplier(regimeContext.riskLevel, regimeContext.compositeRegime)
      : 1.0;
    const effectiveCapital = userCapital * regimeMultiplier;

    if (effectiveCapital <= 0) {
      this.logger.warn(
        `Regime multiplier ${regimeMultiplier} (${regimeContext?.compositeRegime}) reduced capital to $0 — skipping allocation`
      );
      this.auditService
        .createAuditLog({
          eventType: AuditEventType.REGIME_SCALED_ALLOCATION,
          entityType: 'capital-allocation',
          entityId: 'system',
          afterState: {
            compositeRegime: regimeContext?.compositeRegime,
            riskLevel: regimeContext?.riskLevel,
            regimeMultiplier,
            userCapital,
            effectiveCapital: 0,
            strategiesAllocated: 0,
            totalAllocated: 0
          }
        })
        .catch((err) => this.logger.warn(`Audit log failed: ${err.message}`));
      return allocation;
    }

    if (regimeMultiplier !== 1.0) {
      this.logger.log(
        `Regime scaling: ${regimeContext!.compositeRegime} (risk ${regimeContext!.riskLevel}) → ` +
          `${regimeMultiplier}x multiplier, effective capital $${effectiveCapital.toFixed(2)} (from $${userCapital.toFixed(2)})`
      );
    }

    const strategyIds = strategies.map((s) => s.id);
    const allOrders = await this.orderRepo.find({
      where: { strategyConfigId: In(strategyIds), isAlgorithmicTrade: true, status: OrderStatus.FILLED },
      select: ['strategyConfigId', 'gainLoss', 'cost']
    });
    const ordersByStrategy = new Map<string, Order[]>();
    for (const order of allOrders) {
      const key = order.strategyConfigId!;
      const group = ordersByStrategy.get(key);
      if (group) {
        group.push(order);
      } else {
        ordersByStrategy.set(key, [order]);
      }
    }

    const kellyFractions = new Map<string, number>();
    const fallbackStrategyIds: string[] = [];

    // Calculate Kelly fraction for each strategy
    for (const strategy of strategies) {
      const orders = ordersByStrategy.get(strategy.id) ?? [];

      const resolvedOrders = orders.filter((o) => o.gainLoss != null && o.gainLoss !== 0);

      if (resolvedOrders.length < this.MIN_TRADES_FOR_KELLY) {
        this.logger.debug(
          `Strategy ${strategy.id} has ${resolvedOrders.length} resolved trades (< ${this.MIN_TRADES_FOR_KELLY}), falling back to score-based`
        );
        fallbackStrategyIds.push(strategy.id);
        continue;
      }

      const wins = resolvedOrders.filter((o) => o.gainLoss! > 0);
      const losses = resolvedOrders.filter((o) => o.gainLoss! < 0);

      const p = wins.length / resolvedOrders.length;
      const avgWin = wins.length > 0 ? wins.reduce((sum, o) => sum + o.gainLoss!, 0) / wins.length : 0;
      const avgLoss = losses.length > 0 ? losses.reduce((sum, o) => sum + Math.abs(o.gainLoss!), 0) / losses.length : 0;

      if (losses.length === 0) {
        // All wins, no losses — use full quarter-Kelly
        kellyFractions.set(strategy.id, this.KELLY_MULTIPLIER);
        continue;
      }

      const b = avgWin / avgLoss;
      let quarterKelly = 0;
      if (b > 0) {
        const f = (b * p - (1 - p)) / b;
        quarterKelly = Math.max(f * this.KELLY_MULTIPLIER, 0);
      }

      kellyFractions.set(strategy.id, quarterKelly);
    }

    // Score-based fallback with Kelly-equivalent normalization
    if (fallbackStrategyIds.length > 0) {
      const scoreMap = await this.buildScoreMap(fallbackStrategyIds);

      for (const id of fallbackStrategyIds) {
        const score = scoreMap.get(id) || 0;
        if (score >= this.MIN_SCORE_THRESHOLD) {
          // Map score to Kelly-equivalent fraction using even-money assumption
          const kellyEquivalent = Math.max(((2 * score) / 100 - 1) * this.KELLY_MULTIPLIER, 0);
          if (kellyEquivalent > 0) {
            kellyFractions.set(id, kellyEquivalent);
          }
        }
      }
    }

    // Normalize fractions to sum to 1.0
    const totalFraction = Array.from(kellyFractions.values()).reduce((sum, f) => sum + f, 0);

    if (totalFraction === 0) {
      this.logger.warn('All strategies have zero Kelly fraction, cannot allocate');
      return allocation;
    }

    // Iterative proportional fitting for capped capital redistribution
    const maxPerStrategy = this.getMaxAllocationPerStrategy(effectiveCapital, kellyFractions.size);
    const remainingFractions = new Map(kellyFractions);
    const lockedAllocations = new Map<string, number>();
    let remainingCapital = effectiveCapital;

    for (let iteration = 0; iteration < kellyFractions.size; iteration++) {
      const poolTotal = Array.from(remainingFractions.values()).reduce((sum, f) => sum + f, 0);
      if (poolTotal === 0) break;

      let cappedThisRound = false;

      for (const [strategyId, fraction] of remainingFractions.entries()) {
        const capitalAmount = (fraction / poolTotal) * remainingCapital;

        if (capitalAmount > maxPerStrategy) {
          lockedAllocations.set(strategyId, maxPerStrategy);
          remainingCapital -= maxPerStrategy;
          remainingFractions.delete(strategyId);
          cappedThisRound = true;
        }
      }

      if (!cappedThisRound) {
        // No caps hit — distribute remaining capital proportionally
        for (const [strategyId, fraction] of remainingFractions.entries()) {
          lockedAllocations.set(strategyId, (fraction / poolTotal) * remainingCapital);
        }
        break;
      }
    }

    // Apply MIN_ALLOCATION_PER_STRATEGY filter
    for (const [strategyId, capitalAmount] of lockedAllocations.entries()) {
      if (capitalAmount < this.MIN_ALLOCATION_PER_STRATEGY) {
        this.logger.debug(
          `Strategy ${strategyId} Kelly allocation $${capitalAmount.toFixed(2)} below minimum, excluding`
        );
        continue;
      }

      allocation.set(strategyId, capitalAmount);
    }

    const allocatedCapital = Array.from(allocation.values()).reduce((sum, v) => sum + v, 0);
    this.logger.log(
      `Kelly allocated $${allocatedCapital.toFixed(2)} across ${allocation.size} strategies ` +
        `(${kellyFractions.size} eligible, ${fallbackStrategyIds.length} score-fallback, ${strategies.length} total)`
    );

    if (regimeContext) {
      this.auditService
        .createAuditLog({
          eventType: AuditEventType.REGIME_SCALED_ALLOCATION,
          entityType: 'capital-allocation',
          entityId: 'system',
          afterState: {
            compositeRegime: regimeContext.compositeRegime,
            riskLevel: regimeContext.riskLevel,
            regimeMultiplier,
            userCapital,
            effectiveCapital,
            strategiesAllocated: allocation.size,
            totalAllocated: allocatedCapital
          }
        })
        .catch((err) => this.logger.warn(`Audit log failed: ${err.message}`));
    }

    return allocation;
  }
}
