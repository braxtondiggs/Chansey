import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { PositionAnalysisService } from './position-analysis.service';

import { OpportunitySellEvaluation } from '../entities/opportunity-sell-evaluation.entity';
import {
  OpportunitySellDecision,
  OpportunitySellOrder,
  OpportunitySellPlan,
  OpportunitySellingUserConfig,
  PositionSellScore
} from '../interfaces/opportunity-selling.interface';

/**
 * Parameters for evaluating an opportunity sell
 */
export interface EvaluateOpportunitySellParams {
  /** Coin ID of the buy signal */
  buySignalCoinId: string;
  /** Confidence of the buy signal (0-1) */
  buySignalConfidence: number;
  /** Total amount needed for the buy (in quote currency) */
  requiredBuyAmount: number;
  /** Available cash balance */
  availableCash: number;
  /** Total portfolio value */
  portfolioValue: number;
  /** Current positions: coinId -> { averagePrice, quantity, entryDate } */
  positions: Map<string, { averagePrice: number; quantity: number; entryDate?: Date }>;
  /** Current market prices: coinId -> price */
  currentPrices: Map<string, number>;
  /** User's opportunity selling config */
  config: OpportunitySellingUserConfig;
  /** Whether the feature is enabled for the user */
  enabled: boolean;
  /** Current timestamp (for hold period calculations) */
  now?: Date;
  /** Optional algorithm rankings: coinId -> rank (1 = best) */
  algoRankings?: Map<string, number>;
}

/**
 * Orchestration service for opportunity-based selling.
 * Evaluates whether existing positions should be sold to fund a new buy signal,
 * and persists evaluation results for auditing.
 */
@Injectable()
export class OpportunitySellService {
  private readonly logger = new Logger(OpportunitySellService.name);

  constructor(
    private readonly positionAnalysis: PositionAnalysisService,
    @InjectRepository(OpportunitySellEvaluation)
    private readonly evaluationRepo: Repository<OpportunitySellEvaluation>
  ) {}

  /**
   * Evaluate whether to sell existing positions to fund a buy opportunity.
   * Pure evaluation — does not persist or execute anything.
   */
  evaluateOpportunitySell(params: EvaluateOpportunitySellParams): OpportunitySellPlan {
    const {
      buySignalCoinId,
      buySignalConfidence,
      requiredBuyAmount,
      availableCash,
      portfolioValue,
      positions,
      currentPrices,
      config,
      enabled,
      algoRankings
    } = params;
    const now = params.now ?? new Date();

    const basePlan: Omit<OpportunitySellPlan, 'decision' | 'reason'> = {
      buySignalCoinId,
      buySignalConfidence,
      shortfall: requiredBuyAmount - availableCash,
      availableCash,
      portfolioValue,
      projectedProceeds: 0,
      evaluatedPositions: [],
      sellOrders: [],
      liquidationPercent: 0
    };

    // Gate 1: Feature disabled
    if (!enabled) {
      return {
        ...basePlan,
        decision: OpportunitySellDecision.REJECTED_DISABLED,
        reason: 'Opportunity selling is disabled for this user'
      };
    }

    // Gate 2: Buy confidence too low
    if (buySignalConfidence < config.minOpportunityConfidence) {
      return {
        ...basePlan,
        decision: OpportunitySellDecision.REJECTED_LOW_CONFIDENCE,
        reason: `Buy signal confidence ${(buySignalConfidence * 100).toFixed(1)}% is below minimum ${(config.minOpportunityConfidence * 100).toFixed(1)}%`
      };
    }

    const shortfall = requiredBuyAmount - availableCash;
    if (shortfall <= 0) {
      // No shortfall — should not have been called, but handle gracefully
      return {
        ...basePlan,
        shortfall: 0,
        decision: OpportunitySellDecision.APPROVED,
        reason: 'Sufficient cash available — no selling needed'
      };
    }

    // Score all positions (exclude the coin we're trying to buy and protected coins)
    const evaluatedPositions: PositionSellScore[] = [];
    for (const [coinId, position] of positions) {
      // Skip the coin we want to buy
      if (coinId === buySignalCoinId) continue;

      // Skip protected coins
      if (config.protectedCoins.includes(coinId)) {
        evaluatedPositions.push({
          coinId,
          eligible: false,
          unrealizedPnLScore: 0,
          protectedGainsScore: 0,
          holdingPeriodScore: 0,
          opportunityAdvantageScore: 0,
          algorithmRankingScore: 0,
          totalScore: Number.MAX_SAFE_INTEGER,
          ineligibleReason: 'Coin is in the protected list',
          unrealizedPnLPercent: 0,
          holdingPeriodHours: 0
        });
        continue;
      }

      const currentPrice = currentPrices.get(coinId);
      if (!currentPrice || currentPrice <= 0) continue;

      const algoRank = algoRankings?.get(coinId);
      const score = this.positionAnalysis.calculatePositionSellScore(
        { coinId, ...position },
        currentPrice,
        buySignalConfidence,
        config,
        now,
        algoRank
      );
      evaluatedPositions.push(score);
    }

    const eligible = evaluatedPositions.filter((p) => p.eligible);

    // Gate 3: No eligible positions
    if (eligible.length === 0) {
      return {
        ...basePlan,
        shortfall,
        evaluatedPositions,
        decision: OpportunitySellDecision.REJECTED_NO_ELIGIBLE,
        reason: 'No eligible positions to sell (all protected, too new, or have large gains)'
      };
    }

    // Sort eligible positions by totalScore ASC (lowest = sell first)
    eligible.sort((a, b) => a.totalScore - b.totalScore);

    // Build sell orders until shortfall is covered or max liquidation reached
    const sellOrders: OpportunitySellOrder[] = [];
    let remainingShortfall = shortfall;
    let totalSellValue = 0;
    const maxSellValue = (portfolioValue * config.maxLiquidationPercent) / 100;

    for (const scored of eligible) {
      if (remainingShortfall <= 0) break;
      if (totalSellValue >= maxSellValue) break;

      const position = positions.get(scored.coinId);
      const currentPrice = currentPrices.get(scored.coinId);
      if (!position || !currentPrice) continue;

      // Calculate quantity to sell: enough to cover remaining shortfall, but not more than we hold
      const maxSellByShortfall = remainingShortfall / currentPrice;
      const maxSellByLiquidation = (maxSellValue - totalSellValue) / currentPrice;
      const quantityToSell = Math.min(position.quantity, maxSellByShortfall, maxSellByLiquidation);

      if (quantityToSell <= 0) continue;

      const estimatedProceeds = quantityToSell * currentPrice;

      sellOrders.push({
        coinId: scored.coinId,
        quantity: quantityToSell,
        currentPrice,
        estimatedProceeds,
        score: scored
      });

      totalSellValue += estimatedProceeds;
      remainingShortfall -= estimatedProceeds;
    }

    const liquidationPercent = portfolioValue > 0 ? (totalSellValue / portfolioValue) * 100 : 0;

    // Gate 4: Max liquidation exceeded (shouldn't happen with the loop guard, but be safe)
    if (liquidationPercent > config.maxLiquidationPercent) {
      return {
        ...basePlan,
        shortfall,
        evaluatedPositions,
        sellOrders: [],
        liquidationPercent,
        decision: OpportunitySellDecision.REJECTED_MAX_LIQUIDATION,
        reason: `Liquidation would require ${liquidationPercent.toFixed(1)}% of portfolio (max: ${config.maxLiquidationPercent}%)`
      };
    }

    // Gate 5: Still can't cover shortfall
    if (remainingShortfall > 0) {
      return {
        ...basePlan,
        shortfall,
        evaluatedPositions,
        sellOrders,
        projectedProceeds: totalSellValue,
        liquidationPercent,
        decision: OpportunitySellDecision.REJECTED_INSUFFICIENT_PROCEEDS,
        reason: `Eligible positions can raise $${totalSellValue.toFixed(2)} but shortfall is $${shortfall.toFixed(2)}`
      };
    }

    // Approved
    return {
      ...basePlan,
      shortfall,
      evaluatedPositions,
      sellOrders,
      projectedProceeds: totalSellValue,
      liquidationPercent,
      decision: OpportunitySellDecision.APPROVED,
      reason: `Selling ${sellOrders.length} position(s) for $${totalSellValue.toFixed(2)} to fund ${buySignalCoinId} buy`
    };
  }

  /**
   * Persist an evaluation result to the database
   */
  async persistEvaluation(
    plan: OpportunitySellPlan,
    userId: string,
    isBacktest = false,
    backtestId?: string
  ): Promise<OpportunitySellEvaluation> {
    const evaluation = this.evaluationRepo.create({
      userId,
      buySignalCoinId: plan.buySignalCoinId,
      buySignalConfidence: plan.buySignalConfidence,
      shortfall: plan.shortfall,
      availableCash: plan.availableCash,
      portfolioValue: plan.portfolioValue,
      projectedProceeds: plan.projectedProceeds,
      decision: plan.decision,
      reason: plan.reason,
      evaluationDetails: plan,
      isBacktest,
      backtestId
    });

    const saved = await this.evaluationRepo.save(evaluation);
    this.logger.log(
      `Persisted opportunity sell evaluation: decision=${plan.decision}, ` +
        `coin=${plan.buySignalCoinId}, user=${userId}, isBacktest=${isBacktest}`
    );
    return saved;
  }

  /**
   * Evaluate and persist in one call — convenience for live trading flow
   */
  async evaluateAndPersist(
    params: EvaluateOpportunitySellParams,
    userId: string,
    isBacktest = false,
    backtestId?: string
  ): Promise<OpportunitySellPlan> {
    const plan = this.evaluateOpportunitySell(params);
    await this.persistEvaluation(plan, userId, isBacktest, backtestId);
    return plan;
  }
}
