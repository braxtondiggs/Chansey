import { type WindowMetrics } from '@chansey/api-interfaces';

import { SharpeRatioCalculator } from '../../common/metrics/sharpe-ratio.calculator';
import { type OptimizationConfig } from '../interfaces';

export const ZERO_TRADE_PENALTY = -0.5;

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
      // Uses 2% annual risk-free rate, consistent with Sharpe calculation
      const riskFreeRate = 0.02;
      if (!metrics.downsideDeviation || metrics.downsideDeviation === 0) {
        // Fallback to Sharpe when no downside volatility (all returns positive)
        score = metrics.sharpeRatio;
      } else {
        score = (metrics.totalReturn - riskFreeRate) / metrics.downsideDeviation;
      }
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

/**
 * Compute a composite ranking score that balances raw performance with consistency.
 * - Consistency 100 → 1.0x multiplier, Consistency 0 → 0.6x
 * - Each overfitting window → -10% penalty (floor at 0.5x)
 */
export function computeRankingScore(
  avgTestScore: number,
  consistencyScore: number,
  overfittingWindows: number
): number {
  const consistencyMultiplier = 0.6 + 0.4 * (consistencyScore / 100);
  const overfitPenalty = Math.max(0.5, 1.0 - 0.1 * overfittingWindows);
  return avgTestScore * consistencyMultiplier * overfitPenalty;
}
