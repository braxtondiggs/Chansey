import { SpreadEstimationContext } from './slippage.interface';

/**
 * Corwin-Schultz (2012) bid-ask spread estimator using two consecutive OHLC candles.
 *
 * @param current  Current candle { high, low }
 * @param previous Previous candle { high, low }
 * @returns Estimated spread as a decimal fraction (e.g. 0.002 = 0.2%), clamped to [0, ∞)
 */
export function estimateSpreadCorwinSchultz(
  current: { high: number; low: number },
  previous: { high: number; low: number }
): number {
  // Guard: invalid or flat prices
  if (current.high <= 0 || current.low <= 0 || previous.high <= 0 || previous.low <= 0) {
    return 0;
  }

  if (current.high === current.low && previous.high === previous.low) {
    return 0;
  }

  const logCurrHL = Math.log(current.high / current.low);
  const logPrevHL = Math.log(previous.high / previous.low);

  // beta = sum of squared log(H/L) over two periods
  const beta = logCurrHL * logCurrHL + logPrevHL * logPrevHL;

  const combinedHigh = Math.max(current.high, previous.high);
  const combinedLow = Math.min(current.low, previous.low);

  // gamma = squared log of two-period high-low range
  const gamma = Math.pow(Math.log(combinedHigh / combinedLow), 2);

  const sqrt2 = Math.sqrt(2);
  const denom = 3 - 2 * sqrt2;

  // alpha = Corwin-Schultz alpha parameter
  const alpha = (sqrt2 * Math.sqrt(beta) - Math.sqrt(beta)) / denom - Math.sqrt(gamma / denom);

  // Negative alpha indicates trending market — clamp to 0
  if (alpha <= 0) {
    return 0;
  }

  const eAlpha = Math.exp(alpha);
  const spread = (2 * (eAlpha - 1)) / (1 + eAlpha);

  return spread;
}

/**
 * Single-candle high-low spread estimator with optional volume adjustment.
 *
 * @param high             Candle high price
 * @param low              Candle low price
 * @param close            Candle close price (used as reference)
 * @param volume           Candle volume (base currency); if provided, tightens spread at high volumes
 * @param referenceVolume  Reference volume for normalisation (default: 1_000_000)
 * @returns Estimated spread as a decimal fraction
 */
export function estimateSpreadHighLow(
  high: number,
  low: number,
  close: number,
  volume?: number,
  referenceVolume = 1_000_000
): number {
  if (high <= low || close <= 0) {
    return 0;
  }

  // Empirical heuristic: the bid-ask spread is roughly 30% of the high-low range.
  // Derived from Corwin-Schultz (2012) estimates on liquid crypto pairs.
  const RANGE_TO_SPREAD_RATIO = 0.3;
  const rangeFraction = (high - low) / close;
  let spread = rangeFraction * RANGE_TO_SPREAD_RATIO;

  if (volume !== undefined && volume > 0) {
    // Higher volume → tighter spread; clamp adjustment factor to [0.33, 3]
    const volumeRatio = volume / referenceVolume;
    const adjustmentFactor = Math.min(3, Math.max(0.33, Math.sqrt(volumeRatio)));
    spread /= adjustmentFactor;
  }

  return spread;
}

/**
 * Unified entry point: estimates the bid-ask spread in basis points.
 *
 * Uses Corwin-Schultz when previous candle data is available, falling back to
 * the high-low estimator when it returns zero or when previous data is absent.
 *
 * @param ctx               OHLCV context for the current (and optionally previous) candle
 * @param calibrationFactor Multiplier applied to the raw spread estimate (default: 1.0)
 * @param minSpreadBps      Minimum spread floor in basis points (default: 2)
 * @returns Spread in basis points
 */
export function estimateSpreadBps(ctx: SpreadEstimationContext, calibrationFactor = 1.0, minSpreadBps = 2): number {
  let spreadFraction: number;

  if (ctx.prevHigh !== undefined && ctx.prevLow !== undefined) {
    const csSpread = estimateSpreadCorwinSchultz(
      { high: ctx.high, low: ctx.low },
      { high: ctx.prevHigh, low: ctx.prevLow }
    );

    spreadFraction = csSpread > 0 ? csSpread : estimateSpreadHighLow(ctx.high, ctx.low, ctx.close, ctx.volume);
  } else {
    spreadFraction = estimateSpreadHighLow(ctx.high, ctx.low, ctx.close, ctx.volume);
  }

  const spreadBps = spreadFraction * 10_000 * calibrationFactor;

  return Math.max(spreadBps, minSpreadBps);
}
