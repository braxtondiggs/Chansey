import {
  buildHistogram,
  HOLD_TIME_BUCKET_EDGES,
  mergeHistograms,
  percentileFromHistogram,
  SLIPPAGE_BPS_BUCKET_EDGES,
  SUMMARY_HISTOGRAM_VERSION
} from './summary-histogram.util';

describe('summary-histogram.util', () => {
  describe('buildHistogram', () => {
    it('returns null when there are no valid samples', () => {
      expect(buildHistogram([], HOLD_TIME_BUCKET_EDGES)).toBeNull();
      expect(buildHistogram([null, undefined, NaN], HOLD_TIME_BUCKET_EDGES)).toBeNull();
    });

    it('distributes samples into the correct buckets and records aggregates', () => {
      // Buckets are half-open [lo, hi); 60_000ms (=1 min) falls into [1m, 10m), not [10s, 1m)
      const samples = [500, 1500, 9000, 60_000];
      const hist = buildHistogram(samples, HOLD_TIME_BUCKET_EDGES);
      expect(hist).not.toBeNull();
      expect(hist?.count).toBe(4);
      expect(hist?.sum).toBe(500 + 1500 + 9000 + 60_000);
      expect(hist?.min).toBe(500);
      expect(hist?.max).toBe(60_000);

      const counts = hist?.buckets.map((b) => b[2]) ?? [];
      expect(counts[0]).toBe(1); // [0, 1s)
      expect(counts[1]).toBe(2); // [1s, 10s)
      expect(counts[2]).toBe(0); // [10s, 1m) — empty because 60_000 lands at the next boundary
      expect(counts[3]).toBe(1); // [1m, 10m)
      expect(counts.slice(4).every((c) => c === 0)).toBe(true);
    });

    it('uses half-open [lo, hi) semantics at bucket boundaries', () => {
      const hist = buildHistogram([1_000], HOLD_TIME_BUCKET_EDGES); // exactly 1s
      expect(hist?.buckets[0][2]).toBe(0); // [0, 1s) excludes 1000
      expect(hist?.buckets[1][2]).toBe(1); // [1s, 10s) includes 1000
    });

    it('places values beyond the highest finite edge into the final bucket', () => {
      const hist = buildHistogram([200 * 24 * 60 * 60 * 1000], HOLD_TIME_BUCKET_EDGES); // 200 days
      const last = (hist?.buckets.length ?? 0) - 1;
      expect(hist?.buckets[last][2]).toBe(1);
    });
  });

  describe('mergeHistograms', () => {
    it('sums bucket counts and recomputes min/max/sum', () => {
      const h1 = buildHistogram([500, 1500], HOLD_TIME_BUCKET_EDGES);
      const h2 = buildHistogram([9000, 60_000], HOLD_TIME_BUCKET_EDGES);
      const merged = mergeHistograms([h1, h2]);
      expect(merged?.count).toBe(4);
      expect(merged?.sum).toBe(500 + 1500 + 9000 + 60_000);
      expect(merged?.min).toBe(500);
      expect(merged?.max).toBe(60_000);

      const counts = merged?.buckets.map((b) => b[2]) ?? [];
      expect(counts[0]).toBe(1); // 500
      expect(counts[1]).toBe(2); // 1500, 9000
      expect(counts[3]).toBe(1); // 60_000 (boundary falls into [1m, 10m))
    });

    it('returns null when all inputs are null or undefined', () => {
      expect(mergeHistograms([null, undefined])).toBeNull();
    });

    it('filters out histograms with a different version', () => {
      const base = buildHistogram([500, 1500], HOLD_TIME_BUCKET_EDGES);
      if (!base) throw new Error('expected histogram for version-filter test');
      const wrongVersion = { ...base, version: SUMMARY_HISTOGRAM_VERSION + 1 };
      expect(mergeHistograms([wrongVersion])).toBeNull();
    });

    it('throws when bucket layouts disagree', () => {
      const h1 = buildHistogram([500], HOLD_TIME_BUCKET_EDGES);
      const h2 = buildHistogram([100], SLIPPAGE_BPS_BUCKET_EDGES);
      expect(() => mergeHistograms([h1, h2])).toThrow(/bucket count mismatch/);
    });
  });

  describe('percentileFromHistogram', () => {
    it('returns null for a null histogram', () => {
      expect(percentileFromHistogram(null, 0.5)).toBeNull();
    });

    it('interpolates the median uniformly within the containing bucket', () => {
      const samples = [50, 60, 70, 80, 90]; // all in [0, 100)
      const hist = buildHistogram(samples, SLIPPAGE_BPS_BUCKET_EDGES);
      // 5 samples, target=2.5, offset=2.5, fraction=0.5 → 0 + 0.5*(100-0)
      expect(percentileFromHistogram(hist, 0.5)).toBe(50);
    });

    it('clamps percentile inputs to [0, 1] and pins to histogram.min/max at the boundaries', () => {
      const hist = buildHistogram([100, 200, 300], SLIPPAGE_BPS_BUCKET_EDGES);
      expect(percentileFromHistogram(hist, -0.5)).toBe(100); // clamped to p=0 → histogram.min
      expect(percentileFromHistogram(hist, 1.5)).toBe(300); // clamped to p=1 → histogram.max
    });

    it('uses histogram.max as the upper bound when the containing bucket is unbounded', () => {
      const hist = buildHistogram([50, 2500], SLIPPAGE_BPS_BUCKET_EDGES); // 2500 → [2000, ∞)
      expect(percentileFromHistogram(hist, 1)).toBe(2500);
    });
  });
});
