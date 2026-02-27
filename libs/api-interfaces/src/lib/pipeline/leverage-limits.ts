/**
 * Risk level → maximum leverage mapping
 * Scoped to Coinbase Advanced (CFTC-regulated perps, max 10x)
 */
export const RISK_LEVERAGE_MAP: Record<number, number> = {
  1: 1,
  2: 2,
  3: 3,
  4: 5,
  5: 10
};

/** Hard cap on leverage (Coinbase Advanced limit) */
export const MAX_LEVERAGE_CAP = 10;

/** Maintenance margin rate (Coinbase typical) */
export const MAINTENANCE_MARGIN_RATE = 0.005;

/**
 * Get the maximum allowed leverage for a given risk level (1-5).
 * Returns 1 for invalid/out-of-range risk levels.
 */
export function getMaxLeverage(riskLevel: number): number {
  const clamped = Math.max(1, Math.min(5, Math.round(riskLevel)));
  const mapped = RISK_LEVERAGE_MAP[clamped] ?? 1;
  return Math.min(mapped, MAX_LEVERAGE_CAP);
}
