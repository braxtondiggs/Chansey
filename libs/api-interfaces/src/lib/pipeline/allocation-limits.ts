/**
 * Unified Position Sizing — Allocation Limits
 *
 * Single source of truth for max/min allocation per trade,
 * keyed by (PipelineStage, riskLevel). Consumed by BacktestEngine,
 * PaperTradingEngine, and the optimization orchestrator.
 */
import { PipelineStage } from './pipeline.interface';

import { DEFAULT_RISK_LEVEL } from '../risk/risk.interface';

export interface AllocationLimits {
  /** Maximum allocation per trade as fraction of portfolio (0‑1) */
  maxAllocation: number;
  /** Minimum allocation per trade as fraction of portfolio (0‑1) */
  minAllocation: number;
}

/**
 * Absolute safety cap — no override can exceed this.
 */
export const ABSOLUTE_MAX_ALLOCATION_CAP = 0.25;

/**
 * Maximum fraction of portfolio that can be deployed in positions at any time.
 * Reserves 30% cash to ensure buy signals aren't skipped due to locked capital.
 */
export const MAX_PORTFOLIO_DEPLOYMENT = 0.7;

/**
 * Stage × Risk allocation matrix.
 * Outer key: PipelineStage (only tradeable stages).
 * Inner array index: riskLevel − 1 (risk levels 1‑5).
 */
export const STAGE_RISK_ALLOCATION_MATRIX: Record<string, AllocationLimits[]> = {
  [PipelineStage.OPTIMIZE]: [
    { maxAllocation: 0.04, minAllocation: 0.02 },
    { maxAllocation: 0.05, minAllocation: 0.02 },
    { maxAllocation: 0.05, minAllocation: 0.02 },
    { maxAllocation: 0.06, minAllocation: 0.02 },
    { maxAllocation: 0.07, minAllocation: 0.02 }
  ],
  [PipelineStage.HISTORICAL]: [
    { maxAllocation: 0.05, minAllocation: 0.02 },
    { maxAllocation: 0.06, minAllocation: 0.02 },
    { maxAllocation: 0.08, minAllocation: 0.03 },
    { maxAllocation: 0.09, minAllocation: 0.03 },
    { maxAllocation: 0.1, minAllocation: 0.03 }
  ],
  [PipelineStage.LIVE_REPLAY]: [
    { maxAllocation: 0.05, minAllocation: 0.02 },
    { maxAllocation: 0.06, minAllocation: 0.02 },
    { maxAllocation: 0.07, minAllocation: 0.02 },
    { maxAllocation: 0.08, minAllocation: 0.03 },
    { maxAllocation: 0.08, minAllocation: 0.03 }
  ],
  [PipelineStage.PAPER_TRADE]: [
    { maxAllocation: 0.04, minAllocation: 0.02 },
    { maxAllocation: 0.05, minAllocation: 0.02 },
    { maxAllocation: 0.05, minAllocation: 0.02 },
    { maxAllocation: 0.06, minAllocation: 0.02 },
    { maxAllocation: 0.07, minAllocation: 0.03 }
  ]
};

/**
 * Minimum capital required per strategy, keyed by risk level (1-5).
 * Lower risk levels allow smaller starting amounts for beginners.
 */
export const MIN_CAPITAL_PER_STRATEGY: Record<number, number> = {
  1: 15, // Conservative
  2: 15, // Low-Moderate
  3: 25, // Moderate
  4: 35, // Moderately Aggressive
  5: 50 // Aggressive
};

/**
 * Get the minimum capital per strategy for a given risk level (1-5).
 * Defaults to moderate (risk 3) for invalid/out-of-range values.
 */
export function getMinCapitalPerStrategy(riskLevel: number): number {
  const clamped = Math.max(1, Math.min(5, Math.round(riskLevel)));
  return MIN_CAPITAL_PER_STRATEGY[clamped];
}

/**
 * Resolve allocation limits for a given pipeline stage and risk level.
 *
 * @param stage  Pipeline stage (defaults to HISTORICAL for backward compatibility)
 * @param riskLevel  User risk level 1‑5 (defaults to 3 — moderate)
 * @param overrides  Optional per-run overrides (e.g. from ExecuteOptions)
 * @returns Clamped allocation limits (never exceeds ABSOLUTE_MAX_ALLOCATION_CAP)
 */
export function getAllocationLimits(
  stage?: PipelineStage | string,
  riskLevel?: number,
  overrides?: Partial<AllocationLimits>
): AllocationLimits {
  const effectiveStage = stage ?? PipelineStage.HISTORICAL;
  const effectiveRisk = Math.round(Math.max(1, Math.min(5, riskLevel ?? DEFAULT_RISK_LEVEL)));
  const index = effectiveRisk - 1;

  const stageRow = STAGE_RISK_ALLOCATION_MATRIX[effectiveStage];
  const base: AllocationLimits = stageRow
    ? stageRow[index]
    : // Fallback to HISTORICAL risk-3 if stage is unknown (e.g. COMPLETED)
      STAGE_RISK_ALLOCATION_MATRIX[PipelineStage.HISTORICAL][2];

  const maxAllocation = Math.min(overrides?.maxAllocation ?? base.maxAllocation, ABSOLUTE_MAX_ALLOCATION_CAP);
  const minAllocation = Math.min(overrides?.minAllocation ?? base.minAllocation, maxAllocation);

  return { maxAllocation, minAllocation };
}
