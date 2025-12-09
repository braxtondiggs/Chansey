import { ScoringWeights } from '@chansey/api-interfaces';

/**
 * Scoring weights configuration
 * Based on research.md multi-factor scoring framework
 *
 * Weights sum to 1.0 (100%)
 */
export const SCORING_WEIGHTS: ScoringWeights = {
  sharpeRatio: 0.25, // 25% - Primary risk-adjusted return metric
  calmarRatio: 0.15, // 15% - Drawdown consideration
  winRate: 0.1, // 10% - Consistency measure
  profitFactor: 0.1, // 10% - Win/loss magnitude
  wfaDegradation: 0.2, // 20% - Overfitting penalty (most important!)
  stability: 0.1, // 10% - Trade distribution
  correlation: 0.1 // 10% - Portfolio diversification
};

/**
 * Validate that weights sum to 1.0
 */
export function validateWeights(weights: ScoringWeights): boolean {
  const sum = Object.values(weights).reduce((acc, val) => acc + val, 0);
  const tolerance = 0.0001; // Allow for floating point errors

  return Math.abs(sum - 1.0) < tolerance;
}

// Validate on module load
if (!validateWeights(SCORING_WEIGHTS)) {
  throw new Error('Scoring weights do not sum to 1.0');
}

/**
 * Alternative weight configurations for different risk profiles
 */
export const CONSERVATIVE_WEIGHTS: ScoringWeights = {
  sharpeRatio: 0.2,
  calmarRatio: 0.25, // Higher weight on drawdown control
  winRate: 0.15,
  profitFactor: 0.1,
  wfaDegradation: 0.2,
  stability: 0.05,
  correlation: 0.05
};

export const AGGRESSIVE_WEIGHTS: ScoringWeights = {
  sharpeRatio: 0.35, // Higher weight on returns
  calmarRatio: 0.1,
  winRate: 0.05,
  profitFactor: 0.15,
  wfaDegradation: 0.2,
  stability: 0.1,
  correlation: 0.05
};
