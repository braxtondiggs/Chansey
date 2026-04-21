import type { SummaryHistogram } from './backtest-summary.entity';

export const SUMMARY_HISTOGRAM_VERSION = 1;

/**
 * Log-spaced bucket edges for hold time in milliseconds.
 * 14 buckets: <1s, 1-10s, 10s-1m, 1-10m, 10m-1h, 1-6h, 6h-1d, 1-3d, 3-7d,
 * 7-14d, 14-30d, 30-60d, 60-100d, 100d+.
 */
const ONE_SEC = 1_000;
const ONE_MIN = 60 * ONE_SEC;
const ONE_HOUR = 60 * ONE_MIN;
const ONE_DAY = 24 * ONE_HOUR;

export const HOLD_TIME_BUCKET_EDGES: number[] = [
  0,
  ONE_SEC,
  10 * ONE_SEC,
  ONE_MIN,
  10 * ONE_MIN,
  ONE_HOUR,
  6 * ONE_HOUR,
  ONE_DAY,
  3 * ONE_DAY,
  7 * ONE_DAY,
  14 * ONE_DAY,
  30 * ONE_DAY,
  60 * ONE_DAY,
  100 * ONE_DAY,
  Number.POSITIVE_INFINITY
];

/**
 * Linear bucket edges for slippage in basis points. 20 buckets of 100 bps each
 * (0-100, 100-200, ..., 1900-2000, 2000-∞).
 */
export const SLIPPAGE_BPS_BUCKET_EDGES: number[] = (() => {
  const edges: number[] = [];
  for (let i = 0; i <= 20; i++) {
    edges.push(i * 100);
  }
  edges.push(Number.POSITIVE_INFINITY);
  return edges;
})();

function buildEmptyBuckets(edges: number[]): Array<[number, number, number]> {
  const buckets: Array<[number, number, number]> = [];
  for (let i = 0; i < edges.length - 1; i++) {
    buckets.push([edges[i], edges[i + 1], 0]);
  }
  return buckets;
}

/**
 * Build a histogram from a list of numeric samples. Skips samples that are
 * NaN, null, or undefined. Returns `null` if no valid samples remain.
 */
export function buildHistogram(samples: Array<number | null | undefined>, edges: number[]): SummaryHistogram | null {
  const buckets = buildEmptyBuckets(edges);
  let min: number | null = null;
  let max: number | null = null;
  let count = 0;
  let sum = 0;

  for (const raw of samples) {
    if (raw === null || raw === undefined) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;

    // Find bucket: value in [lo, hi). The last bucket's `hi` is +Infinity, so
    // values above any finite edge always land here.
    for (let i = 0; i < buckets.length; i++) {
      const [lo, hi] = buckets[i];
      if (value >= lo && value < hi) {
        buckets[i][2] += 1;
        break;
      }
    }

    if (min === null || value < min) min = value;
    if (max === null || value > max) max = value;
    count += 1;
    sum += value;
  }

  if (count === 0) return null;

  return {
    version: SUMMARY_HISTOGRAM_VERSION,
    buckets,
    min,
    max,
    count,
    sum
  };
}

/**
 * Merge multiple histograms into one. All inputs must share the same version
 * and bucket layout. Returns null when there are no non-empty inputs.
 */
export function mergeHistograms(histograms: Array<SummaryHistogram | null | undefined>): SummaryHistogram | null {
  const valid = histograms.filter(
    (h): h is SummaryHistogram => h !== null && h !== undefined && h.version === SUMMARY_HISTOGRAM_VERSION
  );
  if (valid.length === 0) return null;

  const template = valid[0];
  const mergedBuckets: Array<[number, number, number]> = template.buckets.map(([lo, hi]) => [lo, hi, 0]);

  let min: number | null = null;
  let max: number | null = null;
  let count = 0;
  let sum = 0;

  for (const h of valid) {
    if (h.buckets.length !== mergedBuckets.length) {
      throw new Error(
        `Histogram bucket count mismatch (expected ${mergedBuckets.length}, got ${h.buckets.length}) — version bump required`
      );
    }
    for (let i = 0; i < h.buckets.length; i++) {
      const [bLo, bHi, bCount] = h.buckets[i];
      const [tLo, tHi] = mergedBuckets[i];
      if (bLo !== tLo || bHi !== tHi) {
        throw new Error(`Histogram bucket edge mismatch at index ${i}`);
      }
      mergedBuckets[i][2] += bCount;
    }
    if (h.min !== null && (min === null || h.min < min)) min = h.min;
    if (h.max !== null && (max === null || h.max > max)) max = h.max;
    count += h.count;
    sum += h.sum;
  }

  if (count === 0) return null;

  return {
    version: SUMMARY_HISTOGRAM_VERSION,
    buckets: mergedBuckets,
    min,
    max,
    count,
    sum
  };
}

/**
 * Interpolate a percentile (0..1) from a merged histogram. Exact within a
 * single bucket-width: assumes samples are uniformly distributed in the
 * containing bucket. Returns null when the histogram is empty.
 */
export function percentileFromHistogram(histogram: SummaryHistogram | null, percentile: number): number | null {
  if (!histogram || histogram.count === 0) return null;
  const p = Math.max(0, Math.min(1, percentile));
  if (p <= 0) return histogram.min;
  if (p >= 1) return histogram.max;
  const target = p * histogram.count;

  let cumulative = 0;
  for (const [lo, hi, count] of histogram.buckets) {
    if (count === 0) continue;
    if (cumulative + count >= target) {
      const offset = target - cumulative;
      const fraction = count > 0 ? offset / count : 0;
      const upper = Number.isFinite(hi) ? hi : (histogram.max ?? lo);
      return lo + fraction * (upper - lo);
    }
    cumulative += count;
  }

  return histogram.max;
}
