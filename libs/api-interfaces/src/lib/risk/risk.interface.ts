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

export function getEffectiveCalculationRisk(
  coinRiskLevel: number | undefined | null,
  calculationRiskLevel?: number | null
): number {
  if (coinRiskLevel == null) return 3;
  if (coinRiskLevel === 6 && calculationRiskLevel != null) {
    return calculationRiskLevel;
  }
  return coinRiskLevel >= 1 && coinRiskLevel <= 5 ? coinRiskLevel : 3;
}
