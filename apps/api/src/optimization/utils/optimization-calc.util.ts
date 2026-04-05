import { ParameterSpace } from '../interfaces';

/** Regex matching parameter names that represent indicator lookback periods */
const PERIOD_PARAM_PATTERN = /period|slow|fast|medium|signal|atr|lookback/i;

/** Compound indicator param names that need extra lookback (e.g., MACD slow+signal) */
const COMPOUND_PARAM_PATTERN = /slow|signal/i;

/**
 * Compute the number of warm-up days needed from the parameter space.
 * Examines max values of period-like parameters, applies a 1.5× multiplier for
 * compound indicators (MACD slow+signal), adds 20% safety margin, and enforces
 * a minimum of 5 days.
 */
export function computeWarmupDays(parameterSpace: ParameterSpace): number {
  const MIN_WARMUP_DAYS = 5;

  let maxPeriod = 0;
  let hasCompoundIndicator = false;

  for (const param of parameterSpace.parameters) {
    if (!PERIOD_PARAM_PATTERN.test(param.name)) continue;

    // Use max from the parameter range, or default if no range
    const periodMax = param.max ?? (typeof param.default === 'number' ? param.default : 0);
    if (periodMax > maxPeriod) {
      maxPeriod = periodMax;
    }

    if (COMPOUND_PARAM_PATTERN.test(param.name)) {
      hasCompoundIndicator = true;
    }
  }

  if (maxPeriod === 0) return MIN_WARMUP_DAYS;

  // Compound indicators need 1.5× the max period (e.g., MACD slow 26 + signal 9 ≈ 35)
  let warmupPeriods = hasCompoundIndicator ? maxPeriod * 1.5 : maxPeriod;

  // Add 20% safety margin
  warmupPeriods *= 1.2;

  // Convert periods to days (1 period = 1 day for daily OHLC data)
  return Math.max(MIN_WARMUP_DAYS, Math.ceil(warmupPeriods));
}

/**
 * Compute the number of days between two dates (rounded to nearest integer).
 */
export function daysBetween(date1: Date, date2: Date): number {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.round(Math.abs((date2.getTime() - date1.getTime()) / oneDay));
}

/**
 * Compute an adaptive stepDays that guarantees at least `minWindows` walk-forward windows
 * given the available data span. Uses the inverse of WalkForwardService.estimateWindowCount():
 *
 *   maxStepDays = floor((totalDays - trainDays - testDays) / (minWindows - 1))
 *
 * Returns min(configuredStepDays, maxStepDays) — never increases, only reduces.
 * Floors at 1 day minimum.
 *
 * @returns Object with `stepDays` (possibly reduced) and `adjusted` flag
 */
export function computeAdaptiveStepDays(
  totalDays: number,
  trainDays: number,
  testDays: number,
  configuredStepDays: number,
  minWindows: number
): { stepDays: number; adjusted: boolean } {
  // When minWindows <= 1, a single window needs no stepping at all
  if (minWindows <= 1) {
    return { stepDays: configuredStepDays, adjusted: false };
  }

  // WalkForwardService.generateWindows() inserts a +1 day gap between
  // trainEnd and testStart, so the effective window footprint is
  // trainDays + 1 + testDays, not trainDays + testDays.
  const windowSize = trainDays + 1 + testDays;

  // Not enough data for even one window — return configured value unchanged
  // (will fail at window generation with a clear error)
  if (totalDays < windowSize) {
    return { stepDays: configuredStepDays, adjusted: false };
  }

  const maxStepDays = Math.floor((totalDays - windowSize) / (minWindows - 1));
  const adaptiveStep = Math.max(1, Math.min(configuredStepDays, maxStepDays));

  return {
    stepDays: adaptiveStep,
    adjusted: adaptiveStep < configuredStepDays
  };
}
