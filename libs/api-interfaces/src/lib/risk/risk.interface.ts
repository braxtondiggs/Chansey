/**
 * Risk interface representing a risk entity
 */
export interface Risk {
  id: string;
  name: string;
  description: string;
  level: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Interface for risk creation payload
 */
export interface CreateRisk {
  name: string;
  description: string;
  level: number;
}

/**
 * Interface for risk update payload
 */
export interface UpdateRisk {
  id: string;
  name?: string;
  description?: string;
  level?: number;
}

export const CALCULATION_RISK_CAPITAL_ALLOCATION: Record<number, number> = {
  1: 15,
  2: 25,
  3: 35,
  4: 50,
  5: 70
};

export function getCapitalAllocationForRisk(calculationRiskLevel: number): number {
  return CALCULATION_RISK_CAPITAL_ALLOCATION[calculationRiskLevel] ?? 35;
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

export function getEffectiveCalculationRisk(
  coinRiskLevel: number | undefined | null,
  calculationRiskLevel?: number | null
): number {
  if (calculationRiskLevel != null) {
    return calculationRiskLevel;
  }
  if (coinRiskLevel == null) return 3;
  return coinRiskLevel >= 1 && coinRiskLevel <= 5 ? coinRiskLevel : 3;
}
