/**
 * Opportunity-Based Selling Interfaces
 *
 * Defines the types and interfaces for automatic selling of underperforming positions
 * to fund higher-confidence BUY opportunities. When a BUY signal fires but the user
 * has insufficient cash, this system evaluates existing positions for potential liquidation.
 */

/**
 * Decision outcome of an opportunity sell evaluation
 */
export enum OpportunitySellDecision {
  /** Sell plan approved — sufficient eligible positions found to cover shortfall */
  APPROVED = 'approved',
  /** Rejected — feature disabled by user */
  REJECTED_DISABLED = 'rejected_disabled',
  /** Rejected — buy signal confidence below minimum threshold */
  REJECTED_LOW_CONFIDENCE = 'rejected_low_confidence',
  /** Rejected — no eligible positions after scoring (all protected/too new) */
  REJECTED_NO_ELIGIBLE = 'rejected_no_eligible',
  /** Rejected — eligible positions insufficient to cover shortfall */
  REJECTED_INSUFFICIENT_PROCEEDS = 'rejected_insufficient_proceeds',
  /** Rejected — liquidation would exceed max allowed percentage */
  REJECTED_MAX_LIQUIDATION = 'rejected_max_liquidation'
}

/**
 * User-configurable settings for opportunity selling behavior
 */
export interface OpportunitySellingUserConfig {
  /** Minimum buy signal confidence (0-1) to trigger opportunity selling */
  minOpportunityConfidence: number;
  /** Minimum hours a position must be held before eligible for selling */
  minHoldingPeriodHours: number;
  /** Positions with unrealized gains above this % are protected from selling */
  protectGainsAbovePercent: number;
  /** Coin IDs that are never eligible for opportunity selling */
  protectedCoins: string[];
  /** Minimum advantage (%) the new opportunity must have over existing positions */
  minOpportunityAdvantagePercent: number;
  /** Maximum percentage of portfolio that can be liquidated in a single evaluation */
  maxLiquidationPercent: number;
  /** Use algorithm performance ranking to weight position protection scores */
  useAlgorithmRanking: boolean;
}

/**
 * Default configuration values matching the issue specification
 */
export const DEFAULT_OPPORTUNITY_SELLING_CONFIG: OpportunitySellingUserConfig = {
  minOpportunityConfidence: 0.7,
  minHoldingPeriodHours: 48,
  protectGainsAbovePercent: 15,
  protectedCoins: [],
  minOpportunityAdvantagePercent: 10,
  maxLiquidationPercent: 30,
  useAlgorithmRanking: true
};

/**
 * Score breakdown for a single position's sell eligibility.
 *
 * Lower total score = more eligible to sell (worst positions sell first).
 * A score of 100 on protectedGainsScore or holdingPeriodScore makes the position ineligible.
 */
export interface PositionSellScore {
  /** The coin/asset ID being scored */
  coinId: string;
  /** Whether this position is eligible for selling (not protected) */
  eligible: boolean;
  /** Unrealized P&L score (0-30): losses get low score = more eligible to sell */
  unrealizedPnLScore: number;
  /** Protected gains score (0 or 100): gains > threshold = 100 = ineligible */
  protectedGainsScore: number;
  /** Holding period score (0, 0-20, or 100): below min hold = 100 = ineligible; otherwise 0-20 based on hold duration */
  holdingPeriodScore: number;
  /** Opportunity advantage score (0-30): higher buy confidence = lower score = more eligible */
  opportunityAdvantageScore: number;
  /** Algorithm ranking score (0-20): rank 1 = 20pts protection, rank 5+ = 0 */
  algorithmRankingScore: number;
  /** Sum of all component scores */
  totalScore: number;
  /** Reason for ineligibility (if not eligible) */
  ineligibleReason?: string;
  /** Current unrealized P&L percentage */
  unrealizedPnLPercent: number;
  /** Hours the position has been held */
  holdingPeriodHours: number;
}

/**
 * Individual sell order within an opportunity sell plan
 */
export interface OpportunitySellOrder {
  /** Coin/asset ID to sell */
  coinId: string;
  /** Quantity to sell */
  quantity: number;
  /** Current market price used for calculation */
  currentPrice: number;
  /** Estimated proceeds from this sell (quantity * currentPrice) */
  estimatedProceeds: number;
  /** Position sell score that justified this sell */
  score: PositionSellScore;
}

/**
 * Full evaluation result of an opportunity sell assessment
 */
export interface OpportunitySellPlan {
  /** Buy signal coin that triggered the evaluation */
  buySignalCoinId: string;
  /** Confidence of the buy signal */
  buySignalConfidence: number;
  /** Amount of cash needed beyond what's available */
  shortfall: number;
  /** Cash available before any sells */
  availableCash: number;
  /** Total portfolio value at evaluation time */
  portfolioValue: number;
  /** Total estimated proceeds from all planned sells */
  projectedProceeds: number;
  /** Final decision */
  decision: OpportunitySellDecision;
  /** Human-readable reason for the decision */
  reason: string;
  /** All evaluated positions with their scores */
  evaluatedPositions: PositionSellScore[];
  /** Ordered list of sell orders to execute (lowest score first) */
  sellOrders: OpportunitySellOrder[];
  /** Percentage of portfolio being liquidated */
  liquidationPercent: number;
}
