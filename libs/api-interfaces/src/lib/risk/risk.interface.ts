/**
 * Risk interface representing a risk entity
 */
export interface Risk {
  id: string;
  name: string;
  description: string;
  level: number;
  /** Number of coins to auto-select for this risk level */
  coinCount: number;
  /** Cron pattern for coin selection updates (null = no auto-updates) */
  selectionUpdateCron: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Default coin counts per risk level
 * Higher diversification for conservative, concentrated for aggressive
 */
export const DEFAULT_COIN_COUNTS: Record<number, number> = {
  1: 20, // Conservative - max diversification
  2: 15,
  3: 12, // Moderate - balanced
  4: 8,
  5: 5, // Aggressive - concentrated bets
  6: 0 // Custom - user manages their own
};

/**
 * Default coin selection update cron patterns per risk level
 * More aggressive = more frequent updates to track market changes
 */
export const DEFAULT_SELECTION_UPDATE_CRONS: Record<number, string | null> = {
  1: '0 2 * * 1', // Conservative: Weekly (Mon 2 AM)
  2: '0 3 * * 1', // Moderate-Low: Weekly (Mon 3 AM)
  3: '0 4 * * 3', // Moderate: Weekly (Wed 4 AM)
  4: '0 0 * * *', // Growth: Daily (midnight)
  5: '0 */12 * * *', // Aggressive: Every 12 hours
  6: null // Custom: No auto-updates
};

/**
 * Interface for risk creation payload
 */
export interface CreateRisk {
  name: string;
  description: string;
  level: number;
  coinCount?: number;
}

/**
 * Interface for risk update payload
 */
export interface UpdateRisk {
  id: string;
  name?: string;
  description?: string;
  level?: number;
  coinCount?: number;
}

export const CALCULATION_RISK_CAPITAL_ALLOCATION: Record<number, number> = {
  1: 15,
  2: 25,
  3: 35,
  4: 50,
  5: 70
};

export function getCapitalAllocationForRisk(calculationRiskLevel: number): number {
  return (
    CALCULATION_RISK_CAPITAL_ALLOCATION[calculationRiskLevel] ?? CALCULATION_RISK_CAPITAL_ALLOCATION[DEFAULT_RISK_LEVEL]
  );
}

export interface TradingStyleProfile {
  capitalAllocation: number;
  maxSinglePosition: number;
  dailyLossLimit: number;
  bearMarketCapital: number;
}

export const TRADING_STYLE_PROFILES: Record<number, TradingStyleProfile> = {
  1: { capitalAllocation: 15, maxSinglePosition: 25, dailyLossLimit: 5, bearMarketCapital: 5 },
  2: { capitalAllocation: 25, maxSinglePosition: 30, dailyLossLimit: 7.5, bearMarketCapital: 8 },
  3: { capitalAllocation: 35, maxSinglePosition: 35, dailyLossLimit: 10, bearMarketCapital: 10 },
  4: { capitalAllocation: 50, maxSinglePosition: 45, dailyLossLimit: 12.5, bearMarketCapital: 15 },
  5: { capitalAllocation: 70, maxSinglePosition: 55, dailyLossLimit: 15, bearMarketCapital: 20 }
};

/** Default risk level (Moderate) when user's risk is not set */
export const DEFAULT_RISK_LEVEL = 3;

/** Risk level indicating custom/user-defined coin selection */
export const CUSTOM_RISK_LEVEL = 6;

/** Minimum coins required in watchlist for custom risk level users */
export const MIN_WATCHLIST_COINS = 3;

export function getEffectiveCalculationRisk(
  coinRiskLevel: number | undefined | null,
  calculationRiskLevel?: number | null
): number {
  if (calculationRiskLevel != null) {
    return calculationRiskLevel;
  }
  if (coinRiskLevel == null) return DEFAULT_RISK_LEVEL;
  return coinRiskLevel >= 1 && coinRiskLevel <= 5 ? coinRiskLevel : DEFAULT_RISK_LEVEL;
}
