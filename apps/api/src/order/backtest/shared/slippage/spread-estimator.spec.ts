import { SpreadEstimationContext } from './slippage.interface';
import { estimateSpreadCorwinSchultz, estimateSpreadHighLow, estimateSpreadBps } from './spread-estimator';

describe('Spread Estimator', () => {
  describe('estimateSpreadCorwinSchultz', () => {
    it('should return a positive spread for typical candle data', () => {
      const spread = estimateSpreadCorwinSchultz({ high: 50500, low: 49500 }, { high: 50300, low: 49700 });
      expect(spread).toBeGreaterThan(0);
      expect(spread).toBeLessThan(0.05);
    });

    it('should return 0 when high equals low (no range)', () => {
      const spread = estimateSpreadCorwinSchultz({ high: 50000, low: 50000 }, { high: 50000, low: 50000 });
      expect(spread).toBe(0);
    });

    it('should clamp negative estimates to 0 (trending markets)', () => {
      const spread = estimateSpreadCorwinSchultz({ high: 55000, low: 54500 }, { high: 50500, low: 50000 });
      expect(spread).toBeGreaterThanOrEqual(0);
    });

    it('should return larger spread for wider high-low ranges', () => {
      const narrow = estimateSpreadCorwinSchultz({ high: 50100, low: 49900 }, { high: 50050, low: 49950 });
      const wide = estimateSpreadCorwinSchultz({ high: 51000, low: 49000 }, { high: 50800, low: 49200 });
      expect(wide).toBeGreaterThan(narrow);
    });
  });

  describe('estimateSpreadHighLow', () => {
    it('should estimate spread from single candle high-low range', () => {
      const spread = estimateSpreadHighLow(102, 98, 100);
      expect(spread).toBeGreaterThan(0);
      expect(spread).toBeLessThan(0.1);
    });

    it('should return 0 when high equals low', () => {
      const spread = estimateSpreadHighLow(100, 100, 100);
      expect(spread).toBe(0);
    });

    it('should return tighter spread for higher volume', () => {
      const lowVol = estimateSpreadHighLow(102, 98, 100, 10000);
      const highVol = estimateSpreadHighLow(102, 98, 100, 10000000);
      expect(highVol).toBeLessThan(lowVol);
    });
  });

  describe('estimateSpreadBps', () => {
    it('should use Corwin-Schultz when previous candle data is available', () => {
      const ctx: SpreadEstimationContext = {
        high: 50500,
        low: 49500,
        close: 50000,
        prevHigh: 50300,
        prevLow: 49700
      };
      const bps = estimateSpreadBps(ctx);
      expect(bps).toBeGreaterThan(0);
    });

    it('should fall back to high-low when no previous candle data', () => {
      const ctx: SpreadEstimationContext = {
        high: 50500,
        low: 49500,
        close: 50000
      };
      const bps = estimateSpreadBps(ctx);
      expect(bps).toBeGreaterThan(0);
    });

    it('should apply calibration factor', () => {
      const ctx: SpreadEstimationContext = {
        high: 50500,
        low: 49500,
        close: 50000
      };
      const base = estimateSpreadBps(ctx, 1.0);
      const doubled = estimateSpreadBps(ctx, 2.0);
      expect(doubled).toBeCloseTo(base * 2, 1);
    });

    it('should respect minimum spread floor', () => {
      const ctx: SpreadEstimationContext = {
        high: 50001,
        low: 49999,
        close: 50000
      };
      const bps = estimateSpreadBps(ctx, 1.0, 5);
      expect(bps).toBeGreaterThanOrEqual(5);
    });
  });
});
