/**
 * Constants for walk-forward degradation calculation.
 * Shared across DegradationCalculator, WindowProcessor, and PipelineProgressionService.
 */

/** Output clamp range for degradation percentages */
export const DEGRAD_CLAMP = { min: -200, max: 300 } as const;

/** Per-metric minimum denominator floors to prevent near-zero blowup */
export const DEGRAD_MIN_DENOMINATOR: Record<string, number> = {
  sharpeRatio: 0.1,
  totalReturn: 0.01,
  maxDrawdown: 0.01,
  winRate: 0.05,
  profitFactor: 0.1,
  volatility: 0.005
};

/** Per-metric weights for overall degradation (must sum to 1.0) */
export const DEGRADATION_WEIGHTS: Record<string, number> = {
  sharpeRatio: 0.3,
  totalReturn: 0.25,
  winRate: 0.15,
  profitFactor: 0.15,
  maxDrawdown: 0.1,
  volatility: 0.05
};

/** Metrics where higher test values indicate worse performance */
export const INVERTED_METRICS = new Set(['maxDrawdown', 'volatility']);
