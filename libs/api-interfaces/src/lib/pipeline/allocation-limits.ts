/**
 * Unified Position Sizing — Allocation Limits
 *
 * Single source of truth for max/min allocation per trade,
 * keyed by (PipelineStage, riskLevel). Consumed by BacktestEngine,
 * PaperTradingEngine, and the optimization orchestrator.
 */
import { PipelineStage } from './pipeline.interface';

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
 * Stage × Risk allocation matrix.
 * Outer key: PipelineStage (only tradeable stages).
 * Inner array index: riskLevel − 1 (risk levels 1‑5).
 */
export const STAGE_RISK_ALLOCATION_MATRIX: Record<string, AllocationLimits[]> = {
  [PipelineStage.OPTIMIZE]: [
    { maxAllocation: 0.06, minAllocation: 0.02 },
    { maxAllocation: 0.07, minAllocation: 0.02 },
    { maxAllocation: 0.08, minAllocation: 0.02 },
    { maxAllocation: 0.09, minAllocation: 0.02 },
    { maxAllocation: 0.1, minAllocation: 0.02 }
  ],
  [PipelineStage.HISTORICAL]: [
    { maxAllocation: 0.08, minAllocation: 0.02 },
    { maxAllocation: 0.1, minAllocation: 0.02 },
    { maxAllocation: 0.12, minAllocation: 0.03 },
    { maxAllocation: 0.13, minAllocation: 0.03 },
    { maxAllocation: 0.15, minAllocation: 0.03 }
  ],
  [PipelineStage.LIVE_REPLAY]: [
    { maxAllocation: 0.07, minAllocation: 0.02 },
    { maxAllocation: 0.09, minAllocation: 0.02 },
    { maxAllocation: 0.1, minAllocation: 0.02 },
    { maxAllocation: 0.11, minAllocation: 0.03 },
    { maxAllocation: 0.12, minAllocation: 0.03 }
  ],
  [PipelineStage.PAPER_TRADE]: [
    { maxAllocation: 0.06, minAllocation: 0.02 },
    { maxAllocation: 0.07, minAllocation: 0.02 },
    { maxAllocation: 0.08, minAllocation: 0.02 },
    { maxAllocation: 0.09, minAllocation: 0.02 },
    { maxAllocation: 0.1, minAllocation: 0.03 }
  ]
};

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
  const effectiveRisk = Math.round(Math.max(1, Math.min(5, riskLevel ?? 3)));
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
