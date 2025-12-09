import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { StrategyConfig } from './entities/strategy-config.entity';
import { StrategyScore } from './entities/strategy-score.entity';

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

  constructor(
    @InjectRepository(StrategyScore)
    private readonly strategyScoreRepo: Repository<StrategyScore>
  ) {}

  /**
   * Allocate capital across strategies based on their performance scores.
   * Higher-scoring strategies receive more capital.
   *
   * @param userCapital - Total capital available for allocation
   * @param strategies - Strategies to allocate capital across
   * @returns Map of strategy ID to allocated capital amount
   */
  async allocateCapitalByPerformance(userCapital: number, strategies: StrategyConfig[]): Promise<Map<string, number>> {
    const allocation = new Map<string, number>();

    if (strategies.length === 0 || userCapital <= 0) {
      this.logger.warn('No strategies or capital provided for allocation');
      return allocation;
    }

    // Fetch scores for all strategies
    const strategyIds = strategies.map((s) => s.id);
    const scores = await this.strategyScoreRepo.find({
      where: strategyIds.map((id) => ({ strategyConfigId: id })),
      order: { calculatedAt: 'DESC' }
    });

    // Create map of strategy ID to latest score
    const scoreMap = new Map<string, number>();
    for (const score of scores) {
      if (!scoreMap.has(score.strategyConfigId)) {
        scoreMap.set(score.strategyConfigId, Number(score.overallScore));
      }
    }

    // Filter strategies by minimum score threshold
    const eligibleStrategies = strategies.filter((s) => {
      const score = scoreMap.get(s.id) || 0;
      return score >= this.MIN_SCORE_THRESHOLD;
    });

    if (eligibleStrategies.length === 0) {
      this.logger.warn(`No strategies meet minimum score threshold of ${this.MIN_SCORE_THRESHOLD}`);
      return allocation;
    }

    // Calculate total score across eligible strategies
    const totalScore = eligibleStrategies.reduce((sum, strategy) => {
      return sum + (scoreMap.get(strategy.id) || 0);
    }, 0);

    if (totalScore === 0) {
      this.logger.warn('Total score is 0, cannot allocate capital');
      return allocation;
    }

    // Allocate capital proportionally to scores
    let allocatedCapital = 0;
    const maxPerStrategy = userCapital * this.MAX_ALLOCATION_PERCENTAGE;

    for (const strategy of eligibleStrategies) {
      const strategyScore = scoreMap.get(strategy.id) || 0;
      let capitalAmount = (strategyScore / totalScore) * userCapital;

      // Apply maximum cap
      if (capitalAmount > maxPerStrategy) {
        capitalAmount = maxPerStrategy;
      }

      // Apply minimum threshold
      if (capitalAmount < this.MIN_ALLOCATION_PER_STRATEGY) {
        this.logger.debug(
          `Strategy ${strategy.id} allocation $${capitalAmount.toFixed(2)} below minimum, excluding from allocation`
        );
        continue;
      }

      allocation.set(strategy.id, capitalAmount);
      allocatedCapital += capitalAmount;
    }

    this.logger.log(
      `Allocated $${allocatedCapital.toFixed(2)} across ${allocation.size} strategies (${eligibleStrategies.length} eligible, ${strategies.length} total). ` +
        `Score range: ${Math.min(...Array.from(scoreMap.values()))}-${Math.max(...Array.from(scoreMap.values()))}`
    );

    return allocation;
  }

  /**
   * Get detailed allocation breakdown for transparency.
   */
  async getAllocationDetails(userCapital: number, strategies: StrategyConfig[]): Promise<CapitalAllocation[]> {
    const allocation = await this.allocateCapitalByPerformance(userCapital, strategies);
    const details: CapitalAllocation[] = [];

    // Fetch scores for details
    const strategyIds = strategies.map((s) => s.id);
    const scores = await this.strategyScoreRepo.find({
      where: strategyIds.map((id) => ({ strategyConfigId: id })),
      order: { calculatedAt: 'DESC' }
    });

    const scoreMap = new Map<string, number>();
    for (const score of scores) {
      if (!scoreMap.has(score.strategyConfigId)) {
        scoreMap.set(score.strategyConfigId, Number(score.overallScore));
      }
    }

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

  // TODO: Implement Kelly Criterion allocation for live performance optimization
  // Kelly Criterion formula: f = (bp - q) / b
  // where:
  //   f = fraction of capital to allocate
  //   b = odds received on bet (avg win / avg loss)
  //   p = probability of winning
  //   q = probability of losing (1 - p)
  //
  // Implementation steps:
  //   1. Track win rate (p) and loss rate (q) from live trades
  //   2. Calculate avg win and avg loss from historical performance
  //   3. Apply Kelly fraction with conservative multiplier (0.25 or 0.5)
  //   4. Combine with backtest score weighting for final allocation
  //
  // async allocateCapitalByKelly(userCapital: number, strategies: StrategyConfig[]): Promise<Map<string, number>> {
  //   // Implementation here after 30+ days of live trading data
  // }
}
