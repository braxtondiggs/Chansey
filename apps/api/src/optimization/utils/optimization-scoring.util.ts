import { type WindowMetrics } from '@chansey/api-interfaces';

import { SharpeRatioCalculator } from '../../common/metrics/sharpe-ratio.calculator';
import { type OptimizationConfig } from '../interfaces';

export const ZERO_TRADE_PENALTY = -0.5;

/**
 * Per-window trade-count floor below which the objective score is scaled away from a
 * full-trade window. Positive scores shrink toward zero and negative scores deepen
 * away from zero, so a 1-trade window can never out-rank a 5-trade window with the
 * same sharpe — regardless of sign.
 */
export const MIN_TRADES_PER_WINDOW = 5;

/**
 * Floor for the downside-deviation denominator in Sortino. Anything smaller is treated
 * as effectively-zero noise — without this, a return of 0.05 over a downside-deviation
 * of 0.001 produced a Sortino of ~30, blowing past sensible Sharpe-equivalent ranges.
 * 0.005 ≈ 0.5% return std-dev, the smallest dispersion that's still statistically real.
 */
export const MIN_DOWNSIDE_DEVIATION = 0.005;

/**
 * Per-run total-trades floor below which the SQL ranking score is downscaled by
 * `LEAST(1.0, totalTrades / MIN_TOTAL_TRADES)`. Combos that traded fewer than this
 * across all walk-forward windows are penalized linearly so a 5-trade combo can't
 * ride a high `avgTestScore` to rank 1 over a combo with a similar score and
 * statistically-meaningful trade count.
 */
export const MIN_TOTAL_TRADES = 30;

/**
 * Normalization ranges for composite score calculation.
 * Each metric is normalized to [0, 1] using: (value - min) / (max - min)
 */
export const METRIC_NORMALIZATION = {
  /** Sharpe ratio typically ranges from -1 (losing) to 3+ (excellent) */
  sharpeRatio: { min: -1, max: 3 },
  /** Total return as decimal, e.g., -50% to +50% */
  totalReturn: { min: -0.5, max: 0.5 },
  /** Calmar ratio (return / max drawdown) typically 0 to 3 */
  calmarRatio: { min: 0, max: 3 },
  /** Profit factor typically 0.5 (losing) to 3+ (excellent) */
  profitFactor: { min: 0.5, max: 3 },
  /** Max drawdown as negative decimal, -100% to 0% */
  maxDrawdown: { min: -1, max: 0 },
  /** Win rate already normalized as decimal 0.0 to 1.0 */
  winRate: { min: 0, max: 1 }
} as const;

/**
 * Multiplier for converting standard deviation to consistency penalty.
 * Calibrated for scores typically in [-1, 3] range (e.g., Sharpe ratios):
 * - stdDev=0.0 → 100% consistency (perfect)
 * - stdDev=0.5 → 75% consistency (good)
 * - stdDev=1.0 → 50% consistency (moderate)
 * - stdDev=2.0 → 0% consistency (poor)
 */
export const CONSISTENCY_STDDEV_MULTIPLIER = 50;

/**
 * Calculate objective score from metrics
 */
export function calculateObjectiveScore(metrics: WindowMetrics, objective: OptimizationConfig['objective']): number {
  // Penalize zero-trade combinations first — doing nothing should never win
  if (metrics.tradeCount === 0) return ZERO_TRADE_PENALTY;

  let score: number;

  switch (objective.metric) {
    case 'sharpe_ratio':
      score = metrics.sharpeRatio;
      break;
    case 'total_return':
      score = metrics.totalReturn;
      break;
    case 'calmar_ratio':
      score = metrics.maxDrawdown !== 0 ? metrics.totalReturn / Math.abs(metrics.maxDrawdown) : 0;
      break;
    case 'profit_factor':
      score = metrics.profitFactor || 1;
      break;
    case 'sortino_ratio': {
      // Sortino ratio: (Return - Risk Free Rate) / Downside Deviation
      // Uses 2% annual risk-free rate, consistent with Sharpe calculation.
      // Floor the denominator so vanishingly small downside dispersion can no longer
      // inflate Sortino past sensible bounds (the previous === 0 fallback let values
      // like 0.001 through, producing scores in the 30–100 range).
      const riskFreeRate = 0.02;
      const downsideDeviation = Math.max(metrics.downsideDeviation ?? 0, MIN_DOWNSIDE_DEVIATION);
      score = (metrics.totalReturn - riskFreeRate) / downsideDeviation;
      break;
    }
    case 'composite':
      score = calculateCompositeScore(metrics, objective.weights);
      break;
    default:
      score = metrics.sharpeRatio;
  }

  // Guard non-finite values and clamp to prevent downstream overflow
  if (!Number.isFinite(score)) return 0;

  // Symmetric drag-down for low-trade windows: shrink positive scores toward zero,
  // deepen negative scores away from zero. Multiplying both signs by `factor < 1`
  // would actually *improve* a losing window's rank — a 1-trade losing window with
  // sharpe -2 would score -0.4 vs a 5-trade -2 → -2, the opposite of "low trades = noisy".
  // factor is bounded (1/MIN_TRADES_PER_WINDOW = 0.2) since tradeCount=0 is short-circuited
  // above; the existing ±MAX_SHARPE clamp below catches divisions like -50/0.2 = -250.
  if (metrics.tradeCount < MIN_TRADES_PER_WINDOW) {
    const factor = metrics.tradeCount / MIN_TRADES_PER_WINDOW;
    score = score >= 0 ? score * factor : score / factor;
  }

  return Math.max(-SharpeRatioCalculator.MAX_SHARPE, Math.min(SharpeRatioCalculator.MAX_SHARPE, score));
}

/**
 * Calculate composite score from weighted metrics
 */
export function calculateCompositeScore(
  metrics: WindowMetrics,
  weights?: OptimizationConfig['objective']['weights']
): number {
  const w = weights || {
    sharpeRatio: 0.3,
    totalReturn: 0.25,
    calmarRatio: 0.15,
    profitFactor: 0.15,
    maxDrawdown: 0.1,
    winRate: 0.05
  };

  const calmarRatio = metrics.maxDrawdown !== 0 ? metrics.totalReturn / Math.abs(metrics.maxDrawdown) : 0;
  const norm = METRIC_NORMALIZATION;

  // Helper to normalize a value to [0, 1] given its expected range
  const normalize = (value: number, range: { min: number; max: number }) =>
    Math.max(0, Math.min(1, (value - range.min) / (range.max - range.min)));

  // Normalize each metric to 0-1 scale using documented ranges
  const normalizedSharpe = normalize(metrics.sharpeRatio, norm.sharpeRatio);
  const normalizedReturn = normalize(metrics.totalReturn, norm.totalReturn);
  const normalizedCalmar = normalize(calmarRatio, norm.calmarRatio);
  const normalizedPF = normalize(metrics.profitFactor || 1, norm.profitFactor);
  const normalizedDD = normalize(metrics.maxDrawdown, norm.maxDrawdown);
  const normalizedWR = normalize(metrics.winRate, norm.winRate);

  return (
    normalizedSharpe * (w.sharpeRatio || 0) +
    normalizedReturn * (w.totalReturn || 0) +
    normalizedCalmar * (w.calmarRatio || 0) +
    normalizedPF * (w.profitFactor || 0) +
    normalizedDD * (w.maxDrawdown || 0) +
    normalizedWR * (w.winRate || 0)
  );
}

/**
 * Calculate consistency score based on variance of test scores.
 * Measures how stable performance is across different time windows.
 * Higher score = more consistent (lower variance).
 *
 * @param testScores Array of test scores from each walk-forward window
 * @returns Consistency score from 0-100 (100 = perfectly consistent)
 */
export function calculateConsistencyScore(testScores: number[]): number {
  if (testScores.length < 2) return 100;

  const mean = testScores.reduce((sum, s) => sum + s, 0) / testScores.length;
  const variance = testScores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / testScores.length;
  const stdDev = Math.sqrt(variance);

  // Lower standard deviation = higher consistency
  // Score of 100 at stdDev=0, decreasing as stdDev increases
  const consistencyScore = Math.max(0, 100 - stdDev * CONSISTENCY_STDDEV_MULTIPLIER);
  return Math.round(consistencyScore * 100) / 100;
}

/**
 * Calculate improvement percentage with robust handling for negative/zero baselines.
 * - Floors denominator at max(|baselineScore|, 1) when baseline < 0 to prevent inflation
 * - When baseline=0 and best>0: returns min(bestScore * 100, 500) for meaningful signal
 * - When baseline=0 and best<=0: returns 0
 * - Caps all results at ±500%
 */
export function calculateImprovement(bestScore: number, baselineScore: number): number {
  const MAX_IMPROVEMENT = 500;

  if (baselineScore === 0) {
    if (bestScore > 0) {
      return Math.min(bestScore * 100, MAX_IMPROVEMENT);
    }
    return 0;
  }

  // Floor denominator at 1 when baseline is negative to prevent inflation
  // (e.g., baseline=-0.78, best=1.23 would give 256% without flooring)
  const denominator = baselineScore < 0 ? Math.max(Math.abs(baselineScore), 1) : Math.abs(baselineScore);
  const improvement = ((bestScore - baselineScore) / denominator) * 100;

  return Math.max(-MAX_IMPROVEMENT, Math.min(MAX_IMPROVEMENT, improvement));
}
