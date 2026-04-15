import {
  calculateArrayAverage,
  evaluateATRSignal,
  evaluateBollingerBandsSignal,
  evaluateEMASignal,
  evaluateMACDSignal,
  evaluateRSISignal
} from './confluence-evaluators.util';

describe('Confluence Evaluators', () => {
  describe('calculateArrayAverage', () => {
    it('should calculate average of valid values in range', () => {
      const values = [1, 2, 3, 4, 5];
      const result = calculateArrayAverage(values, 4, 5);
      expect(result.average).toBe(3);
      expect(result.count).toBe(5);
    });

    it('should skip NaN values', () => {
      const values = [1, NaN, 3, NaN, 5];
      const result = calculateArrayAverage(values, 4, 5);
      expect(result.average).toBe(3);
      expect(result.count).toBe(3);
    });

    it('should return zero average when all values are NaN', () => {
      const values = [NaN, NaN, NaN];
      const result = calculateArrayAverage(values, 2, 3);
      expect(result.average).toBe(0);
      expect(result.count).toBe(0);
    });

    it('should use absolute values when useAbsolute is true', () => {
      const values = [-2, 4, -6];
      const result = calculateArrayAverage(values, 2, 3, true);
      expect(result.average).toBe(4); // (2+4+6)/3
    });

    it('should clamp startIndex to 0 when lookback exceeds array', () => {
      const values = [10, 20];
      const result = calculateArrayAverage(values, 1, 100);
      expect(result.average).toBe(15);
      expect(result.count).toBe(2);
    });
  });

  describe('evaluateEMASignal', () => {
    const buildArrays = (current12: number, current26: number, prev12?: number, prev26?: number) => {
      const ema12 = Array(50).fill(NaN);
      const ema26 = Array(50).fill(NaN);
      ema12[49] = current12;
      ema26[49] = current26;
      if (prev12 !== undefined) ema12[48] = prev12;
      if (prev26 !== undefined) ema26[48] = prev26;
      return { ema12, ema26 };
    };

    it('should return bullish when EMA12 > EMA26', () => {
      const { ema12, ema26 } = buildArrays(105, 100);
      const result = evaluateEMASignal(ema12, ema26, 49);
      expect(result.signal).toBe('bullish');
      expect(result.name).toBe('EMA');
      expect(result.strength).toBeGreaterThan(0);
    });

    it('should return bearish when EMA12 < EMA26', () => {
      const { ema12, ema26 } = buildArrays(95, 100);
      const result = evaluateEMASignal(ema12, ema26, 49);
      expect(result.signal).toBe('bearish');
    });

    it('should add crossover bonus when crossing from below to above', () => {
      // Use small spread so base strength is low enough for the +0.2 bonus to be visible
      const { ema12: noCross12, ema26: noCross26 } = buildArrays(100.5, 100, 100.3, 100);
      const noCross = evaluateEMASignal(noCross12, noCross26, 49);

      const { ema12: cross12, ema26: cross26 } = buildArrays(100.5, 100, 99.5, 100);
      const withCross = evaluateEMASignal(cross12, cross26, 49);

      expect(withCross.strength).toBeGreaterThan(noCross.strength);
    });

    it('should return neutral with zero strength when data is NaN', () => {
      const { ema12, ema26 } = buildArrays(NaN, NaN);
      const result = evaluateEMASignal(ema12, ema26, 49);
      expect(result.signal).toBe('neutral');
      expect(result.strength).toBe(0);
    });

    it('should return neutral when EMA26 is zero', () => {
      const { ema12, ema26 } = buildArrays(100, 0);
      const result = evaluateEMASignal(ema12, ema26, 49);
      expect(result.signal).toBe('neutral');
      expect(result.strength).toBe(0);
    });

    it('should increase strength with larger spread', () => {
      const { ema12: small12, ema26: small26 } = buildArrays(101, 100);
      const small = evaluateEMASignal(small12, small26, 49);

      const { ema12: large12, ema26: large26 } = buildArrays(110, 100);
      const large = evaluateEMASignal(large12, large26, 49);

      expect(large.strength).toBeGreaterThan(small.strength);
    });
  });

  describe('evaluateRSISignal', () => {
    const buildArray = (value: number) => {
      const arr = Array(50).fill(NaN);
      arr[49] = value;
      return arr;
    };
    const defaultConfig = { buyThreshold: 55, sellThreshold: 45 };

    it('should return bullish when RSI > buyThreshold', () => {
      const result = evaluateRSISignal(buildArray(70), 49, defaultConfig);
      expect(result.signal).toBe('bullish');
      expect(result.strength).toBeGreaterThan(0.3); // base 0.3 + distance
    });

    it('should return bearish when RSI < sellThreshold', () => {
      const result = evaluateRSISignal(buildArray(30), 49, defaultConfig);
      expect(result.signal).toBe('bearish');
      expect(result.strength).toBeGreaterThan(0.3);
    });

    it('should return neutral when RSI is between thresholds', () => {
      const result = evaluateRSISignal(buildArray(50), 49, defaultConfig);
      expect(result.signal).toBe('neutral');
      expect(result.strength).toBe(0.3);
    });

    it('should return neutral with zero strength for NaN', () => {
      const result = evaluateRSISignal(buildArray(NaN), 49, defaultConfig);
      expect(result.signal).toBe('neutral');
      expect(result.strength).toBe(0);
    });

    it('should respect custom thresholds', () => {
      // RSI 60 is neutral with default (55), but bearish with custom (buyThreshold: 70, sellThreshold: 65)
      const result = evaluateRSISignal(buildArray(60), 49, { buyThreshold: 70, sellThreshold: 65 });
      expect(result.signal).toBe('bearish');
    });
  });

  describe('evaluateMACDSignal', () => {
    const buildArrays = (hist: number, prevHist?: number) => {
      const macd = Array(50).fill(NaN);
      const signal = Array(50).fill(NaN);
      const histogram = Array(50).fill(NaN);
      macd[49] = hist > 0 ? 0.002 : -0.002;
      signal[49] = 0.001;
      histogram[49] = hist;
      if (prevHist !== undefined) histogram[48] = prevHist;
      return { macd, signal, histogram };
    };

    it('should return bullish when histogram is positive', () => {
      const { macd, signal, histogram } = buildArrays(0.005, 0.003);
      const result = evaluateMACDSignal(macd, signal, histogram, 49, 0.004);
      expect(result.signal).toBe('bullish');
    });

    it('should return bearish when histogram is negative', () => {
      const { macd, signal, histogram } = buildArrays(-0.005, -0.003);
      const result = evaluateMACDSignal(macd, signal, histogram, 49, 0.004);
      expect(result.signal).toBe('bearish');
    });

    it('should return neutral when histogram is zero', () => {
      const arr = Array(50).fill(NaN);
      arr[49] = 0;
      const result = evaluateMACDSignal(arr, arr, arr, 49, 0.004);
      expect(result.signal).toBe('neutral');
      expect(result.strength).toBe(0.2);
    });

    it('should return neutral when histogram AND avgHistogram are both zero', () => {
      const macd = Array(50).fill(NaN);
      const signal = Array(50).fill(NaN);
      const histogram = Array(50).fill(NaN);
      macd[49] = 0;
      signal[49] = 0;
      histogram[49] = 0;
      histogram[48] = 0;
      const result = evaluateMACDSignal(macd, signal, histogram, 49, 0);
      expect(result.signal).toBe('neutral');
    });

    it('should add momentum bonus when histogram direction and momentum agree', () => {
      // Positive histogram with increasing momentum
      const { macd: m1, signal: s1, histogram: h1 } = buildArrays(0.005, 0.003);
      const withMomentum = evaluateMACDSignal(m1, s1, h1, 49, 0.004);

      // Positive histogram with decreasing momentum
      const { macd: m2, signal: s2, histogram: h2 } = buildArrays(0.005, 0.008);
      const against = evaluateMACDSignal(m2, s2, h2, 49, 0.004);

      expect(withMomentum.strength).toBeGreaterThan(against.strength);
    });

    it('should return neutral for NaN inputs', () => {
      const arr = Array(50).fill(NaN);
      const result = evaluateMACDSignal(arr, arr, arr, 49, 0.004);
      expect(result.signal).toBe('neutral');
      expect(result.strength).toBe(0);
    });
  });

  describe('evaluateATRSignal', () => {
    const buildArray = (value: number) => {
      const arr = Array(50).fill(1.0);
      arr[49] = value;
      return arr;
    };
    const config = { period: 14, volatilityThresholdMultiplier: 2.0 };

    it('should return filtered when ATR exceeds threshold', () => {
      const result = evaluateATRSignal(buildArray(2.5), 49, config, 1.0);
      expect(result.signal).toBe('filtered');
      expect(result.strength).toBe(0);
    });

    it('should return neutral when ATR is below threshold', () => {
      const result = evaluateATRSignal(buildArray(1.0), 49, config, 1.0);
      expect(result.signal).toBe('neutral');
      expect(result.strength).toBeGreaterThanOrEqual(0.4);
    });

    it('should return higher strength for lower volatility ratio', () => {
      const low = evaluateATRSignal(buildArray(0.5), 49, config, 1.0);
      const mid = evaluateATRSignal(buildArray(1.5), 49, config, 1.0);
      expect(low.strength).toBeGreaterThan(mid.strength);
    });

    it('should return neutral with 0.5 strength for NaN', () => {
      const arr = Array(50).fill(NaN);
      const result = evaluateATRSignal(arr, 49, config, 1.0);
      expect(result.signal).toBe('neutral');
      expect(result.strength).toBe(0.5);
    });

    it('should filter at exactly the threshold boundary', () => {
      // ATR = 2.0, avg = 1.0, multiplier = 2.0 → ratio = 2.0 is NOT > 2.0 → neutral
      const atThreshold = evaluateATRSignal(buildArray(2.0), 49, config, 1.0);
      expect(atThreshold.signal).toBe('neutral');

      // ATR = 2.01 → ratio = 2.01 > 2.0 → filtered
      const aboveThreshold = evaluateATRSignal(buildArray(2.01), 49, config, 1.0);
      expect(aboveThreshold.signal).toBe('filtered');
    });
  });

  describe('evaluateBollingerBandsSignal', () => {
    const buildArrays = (pb: number, bw = 0.05) => {
      const pbArr = Array(50).fill(0.5);
      pbArr[49] = pb;
      const bwArr = Array(50).fill(bw);
      return { pb: pbArr, bw: bwArr };
    };
    const config = { buyThreshold: 0.55, sellThreshold: 0.45 };

    it('should return bullish when %B > buyThreshold', () => {
      const { pb, bw } = buildArrays(0.8);
      const result = evaluateBollingerBandsSignal(pb, bw, 49, config);
      expect(result.signal).toBe('bullish');
      expect(result.name).toBe('BB');
    });

    it('should return bearish when %B < sellThreshold', () => {
      const { pb, bw } = buildArrays(0.2);
      const result = evaluateBollingerBandsSignal(pb, bw, 49, config);
      expect(result.signal).toBe('bearish');
    });

    it('should return neutral when %B is between thresholds', () => {
      const { pb, bw } = buildArrays(0.5);
      const result = evaluateBollingerBandsSignal(pb, bw, 49, config);
      expect(result.signal).toBe('neutral');
      expect(result.strength).toBe(0.3);
    });

    it('should return neutral with zero strength for NaN', () => {
      const { pb, bw } = buildArrays(NaN);
      const result = evaluateBollingerBandsSignal(pb, bw, 49, config);
      expect(result.signal).toBe('neutral');
      expect(result.strength).toBe(0);
    });

    it('should not produce NaN when buyThreshold is 1', () => {
      const { pb, bw } = buildArrays(1.1);
      const result = evaluateBollingerBandsSignal(pb, bw, 49, { buyThreshold: 1, sellThreshold: 0.45 });
      expect(result.signal).toBe('bullish');
      expect(result.strength).toBeCloseTo(0.9, 1); // 0.5 + 0.4
      expect(Number.isNaN(result.strength)).toBe(false);
    });

    it('should not produce Infinity when sellThreshold is 0', () => {
      const { pb, bw } = buildArrays(-0.1);
      const result = evaluateBollingerBandsSignal(pb, bw, 49, { buyThreshold: 0.55, sellThreshold: 0 });
      expect(result.signal).toBe('bearish');
      expect(result.strength).toBeCloseTo(0.9, 1); // 0.5 + 0.4
      expect(Number.isFinite(result.strength)).toBe(true);
    });

    it('should increase strength further from threshold', () => {
      const { pb: close, bw: bw1 } = buildArrays(0.6);
      const closeResult = evaluateBollingerBandsSignal(close, bw1, 49, config);

      const { pb: far, bw: bw2 } = buildArrays(0.95);
      const farResult = evaluateBollingerBandsSignal(far, bw2, 49, config);

      expect(farResult.strength).toBeGreaterThan(closeResult.strength);
    });
  });
});
