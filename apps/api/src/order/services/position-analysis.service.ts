import { Injectable } from '@nestjs/common';

import { OpportunitySellingUserConfig, PositionSellScore } from '../interfaces/opportunity-selling.interface';

/**
 * Stateless service for calculating position sell eligibility scores.
 * Pure calculations with no DB access — usable by both backtest (in-memory)
 * and live trading flows.
 */
@Injectable()
export class PositionAnalysisService {
  /**
   * Calculate the sell eligibility score for a single position.
   * Lower total score = more eligible to sell (worst positions sell first).
   * A score of 100 on protectedGainsScore or holdingPeriodScore makes the position ineligible.
   *
   * @param position - Position data (coinId, averagePrice, quantity, entryDate)
   * @param currentPrice - Current market price of the asset
   * @param buyConfidence - Confidence of the incoming buy signal (0-1)
   * @param config - User's opportunity selling configuration
   * @param algoRank - Optional algorithm ranking (1 = best)
   */
  calculatePositionSellScore(
    position: { coinId: string; averagePrice: number; quantity: number; entryDate?: Date },
    currentPrice: number,
    buyConfidence: number,
    config: OpportunitySellingUserConfig,
    now: Date = new Date(),
    algoRank?: number
  ): PositionSellScore {
    const { pnlPercent } = this.calculateUnrealizedPnL(position.averagePrice, currentPrice, position.quantity);
    const holdingHours = position.entryDate ? this.calculateHoldingPeriodHours(position.entryDate, now) : 0;

    // 1. Unrealized P&L score (0-30): losses get low score = more eligible to sell
    //    -50% or worse => 0, +50% or better => 30, linear interpolation
    const unrealizedPnLScore = Math.max(0, Math.min(30, ((pnlPercent + 50) / 100) * 30));

    // 2. Protected gains (0 or 100): gains above threshold = ineligible
    const protectedGainsScore = pnlPercent > config.protectGainsAbovePercent ? 100 : 0;

    // 3. Holding period score:
    //    - Below minimum hold: 100 = ineligible
    //    - Otherwise: 0-20 based on duration (longer held = higher score = more protection)
    let holdingPeriodScore: number;
    if (holdingHours < config.minHoldingPeriodHours) {
      holdingPeriodScore = 100; // Ineligible — too new
    } else {
      // Scale from 0 to 20 over 720 hours (30 days). Positions held longer get more protection.
      holdingPeriodScore = Math.min(20, (holdingHours / 720) * 20);
    }

    // 4. Opportunity advantage score (0-30): higher buy confidence = lower score = more eligible
    //    Measures how much better the new opportunity is vs keeping this position.
    const opportunityAdvantageScore = Math.max(0, Math.min(30, (1 - buyConfidence) * 30));

    // 5. Algorithm ranking score (0-20): rank 1 = 20pts protection, rank 5+ = 0
    let algorithmRankingScore = 0;
    if (config.useAlgorithmRanking && algoRank !== undefined && algoRank >= 1) {
      algorithmRankingScore = Math.max(0, 20 - (algoRank - 1) * 5);
    }

    const eligible = protectedGainsScore < 100 && holdingPeriodScore < 100;

    let ineligibleReason: string | undefined;
    if (!eligible) {
      if (protectedGainsScore >= 100) {
        ineligibleReason = `Position has ${pnlPercent.toFixed(1)}% gains (protected above ${config.protectGainsAbovePercent}%)`;
      } else if (holdingPeriodScore >= 100) {
        ineligibleReason = `Position held ${holdingHours.toFixed(0)}h (minimum ${config.minHoldingPeriodHours}h)`;
      }
    }

    const totalScore = eligible
      ? unrealizedPnLScore + opportunityAdvantageScore + holdingPeriodScore + algorithmRankingScore
      : Infinity;

    return {
      coinId: position.coinId,
      eligible,
      unrealizedPnLScore,
      protectedGainsScore,
      holdingPeriodScore,
      opportunityAdvantageScore,
      algorithmRankingScore,
      totalScore: eligible ? totalScore : Number.MAX_SAFE_INTEGER,
      ineligibleReason,
      unrealizedPnLPercent: pnlPercent,
      holdingPeriodHours: holdingHours
    };
  }

  /**
   * Calculate unrealized P&L for a position
   */
  calculateUnrealizedPnL(
    avgPrice: number,
    currentPrice: number,
    quantity: number
  ): { pnl: number; pnlPercent: number } {
    const pnl = (currentPrice - avgPrice) * quantity;
    const pnlPercent = avgPrice > 0 ? ((currentPrice - avgPrice) / avgPrice) * 100 : 0;
    return { pnl, pnlPercent };
  }

  /**
   * Calculate how long a position has been held in hours
   */
  calculateHoldingPeriodHours(entryDate: Date, now: Date): number {
    return (now.getTime() - entryDate.getTime()) / (1000 * 60 * 60);
  }
}
