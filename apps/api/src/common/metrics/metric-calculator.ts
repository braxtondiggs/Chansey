/**
 * Base metric calculator utilities
 * Provides common statistical functions for performance metrics
 */

export interface MetricCalculatorResult {
  value: number;
  confidence?: number;
  metadata?: Record<string, any>;
}

/**
 * Calculate mean (average) of an array of numbers
 */
export function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

/**
 * Calculate standard deviation of an array of numbers
 */
export function calculateStandardDeviation(values: number[]): number {
  if (values.length === 0) return 0;

  const mean = calculateMean(values);
  const squaredDiffs = values.map((value) => Math.pow(value - mean, 2));
  const variance = calculateMean(squaredDiffs);

  return Math.sqrt(variance);
}

/**
 * Calculate variance of an array of numbers
 */
export function calculateVariance(values: number[]): number {
  if (values.length === 0) return 0;

  const mean = calculateMean(values);
  const squaredDiffs = values.map((value) => Math.pow(value - mean, 2));

  return calculateMean(squaredDiffs);
}

/**
 * Calculate median of an array of numbers
 */
export function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  return sorted[mid];
}

/**
 * Calculate percentile of an array of numbers
 */
export function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  if (percentile < 0 || percentile > 100) {
    throw new Error('Percentile must be between 0 and 100');
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (lower === upper) {
    return sorted[lower];
  }

  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Calculate cumulative returns from a series of period returns
 */
export function calculateCumulativeReturn(returns: number[]): number {
  if (returns.length === 0) return 0;

  return returns.reduce((cumulative, ret) => {
    return (1 + cumulative) * (1 + ret) - 1;
  }, 0);
}

/**
 * Calculate annualized return from total return and number of periods
 */
export function annualizeReturn(totalReturn: number, periods: number, periodsPerYear = 252): number {
  if (periods === 0) return 0;

  return Math.pow(1 + totalReturn, periodsPerYear / periods) - 1;
}

/**
 * Calculate annualized volatility from period returns
 */
export function annualizeVolatility(returns: number[], periodsPerYear = 252): number {
  const stdDev = calculateStandardDeviation(returns);
  return stdDev * Math.sqrt(periodsPerYear);
}

/**
 * Calculate downside deviation (semi-deviation)
 * Only considers returns below a minimum acceptable return (MAR)
 */
export function calculateDownsideDeviation(returns: number[], mar = 0): number {
  if (returns.length === 0) return 0;

  const downsideReturns = returns.filter((ret) => ret < mar);
  if (downsideReturns.length === 0) return 0;

  const squaredDiffs = downsideReturns.map((ret) => Math.pow(ret - mar, 2));
  const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / returns.length;

  return Math.sqrt(variance);
}

/**
 * Calculate rolling window values
 */
export function calculateRollingWindow<T>(
  data: T[],
  windowSize: number,
  calculator: (window: T[]) => number
): number[] {
  if (data.length < windowSize) return [];

  const results: number[] = [];

  for (let i = 0; i <= data.length - windowSize; i++) {
    const window = data.slice(i, i + windowSize);
    results.push(calculator(window));
  }

  return results;
}

/**
 * Calculate exponential moving average
 */
export function calculateEMA(values: number[], period: number): number[] {
  if (values.length === 0 || period <= 0) return [];

  const multiplier = 2 / (period + 1);
  const ema: number[] = [];

  // First EMA is SMA
  let sum = 0;
  for (let i = 0; i < period && i < values.length; i++) {
    sum += values[i];
  }
  ema.push(sum / Math.min(period, values.length));

  // Calculate subsequent EMAs
  for (let i = period; i < values.length; i++) {
    const value = values[i] * multiplier + ema[ema.length - 1] * (1 - multiplier);
    ema.push(value);
  }

  return ema;
}

/**
 * Calculate z-score (standardized score)
 */
export function calculateZScore(value: number, values: number[]): number {
  const mean = calculateMean(values);
  const stdDev = calculateStandardDeviation(values);

  if (stdDev === 0) return 0;

  return (value - mean) / stdDev;
}

/**
 * Calculate rank percentile of a value within a dataset
 */
export function calculateRankPercentile(value: number, values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const rank = sorted.filter((v) => v < value).length;

  return (rank / values.length) * 100;
}
