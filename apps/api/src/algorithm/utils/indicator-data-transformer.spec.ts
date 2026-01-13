import { IndicatorDataTransformer } from './indicator-data-transformer';

import { PriceSummary } from '../../ohlc/ohlc-candle.entity';

describe('IndicatorDataTransformer', () => {
  // Sample test data
  const mockPrices: PriceSummary[] = [
    { avg: 100, high: 105, low: 95, date: new Date('2024-01-01'), coin: 'BTC' },
    { avg: 102, high: 107, low: 97, date: new Date('2024-01-02'), coin: 'BTC' },
    { avg: 104, high: 109, low: 99, date: new Date('2024-01-03'), coin: 'BTC' },
    { avg: 106, high: 111, low: 101, date: new Date('2024-01-04'), coin: 'BTC' },
    { avg: 108, high: 113, low: 103, date: new Date('2024-01-05'), coin: 'BTC' }
  ];

  describe('extractAveragePrices', () => {
    it('should extract average prices from PriceSummary array', () => {
      const result = IndicatorDataTransformer.extractAveragePrices(mockPrices);

      expect(result).toEqual([100, 102, 104, 106, 108]);
      expect(result.length).toBe(mockPrices.length);
    });

    it('should return empty array for empty input', () => {
      const result = IndicatorDataTransformer.extractAveragePrices([]);

      expect(result).toEqual([]);
    });

    it('should not mutate the source array', () => {
      const source = [...mockPrices];

      IndicatorDataTransformer.extractAveragePrices(source);

      expect(source).toEqual(mockPrices);
    });
  });

  describe('extractClosePrices', () => {
    it('should extract average prices as closing prices', () => {
      const result = IndicatorDataTransformer.extractClosePrices(mockPrices);

      expect(result).toEqual([100, 102, 104, 106, 108]);
    });
  });

  describe('extractOpenPrices', () => {
    it('should extract average prices as opening prices', () => {
      const result = IndicatorDataTransformer.extractOpenPrices(mockPrices);

      expect(result).toEqual([100, 102, 104, 106, 108]);
    });
  });

  describe('extractHighPrices', () => {
    it('should extract high prices from PriceSummary array', () => {
      const result = IndicatorDataTransformer.extractHighPrices(mockPrices);

      expect(result).toEqual([105, 107, 109, 111, 113]);
    });
  });

  describe('extractLowPrices', () => {
    it('should extract low prices from PriceSummary array', () => {
      const result = IndicatorDataTransformer.extractLowPrices(mockPrices);

      expect(result).toEqual([95, 97, 99, 101, 103]);
    });
  });

  describe('toOHLC', () => {
    it('should transform PriceSummary to OHLC format', () => {
      const result = IndicatorDataTransformer.toOHLC(mockPrices);

      expect(result).toEqual([
        { open: 100, high: 105, low: 95, close: 100 },
        { open: 102, high: 107, low: 97, close: 102 },
        { open: 104, high: 109, low: 99, close: 104 },
        { open: 106, high: 111, low: 101, close: 106 },
        { open: 108, high: 113, low: 103, close: 108 }
      ]);
    });

    it('should return empty array for empty input', () => {
      const result = IndicatorDataTransformer.toOHLC([]);

      expect(result).toEqual([]);
    });
  });

  describe('toHLC', () => {
    it('should transform PriceSummary to HLC format', () => {
      const result = IndicatorDataTransformer.toHLC(mockPrices);

      expect(result).toEqual([
        { high: 105, low: 95, close: 100 },
        { high: 107, low: 97, close: 102 },
        { high: 109, low: 99, close: 104 },
        { high: 111, low: 101, close: 106 },
        { high: 113, low: 103, close: 108 }
      ]);
    });

    it('should return empty array for empty input', () => {
      const result = IndicatorDataTransformer.toHLC([]);

      expect(result).toEqual([]);
    });
  });

  describe('padResults', () => {
    it('should pad results with NaN to match original length', () => {
      const indicatorResults = [10, 20, 30];
      const originalLength = 5;

      const result = IndicatorDataTransformer.padResults(indicatorResults, originalLength);

      expect(result).toEqual([NaN, NaN, 10, 20, 30]);
      expect(Number.isNaN(result[0])).toBe(true);
      expect(Number.isNaN(result[1])).toBe(true);
      expect(result.length).toBe(originalLength);
    });

    it('should return original array if no padding needed', () => {
      const indicatorResults = [10, 20, 30];
      const originalLength = 3;

      const result = IndicatorDataTransformer.padResults(indicatorResults, originalLength);

      expect(result).toEqual([10, 20, 30]);
    });

    it('should return original array if it is longer than original length', () => {
      const indicatorResults = [10, 20, 30, 40];
      const originalLength = 3;

      const result = IndicatorDataTransformer.padResults(indicatorResults, originalLength);

      expect(result).toEqual([10, 20, 30, 40]);
    });
  });

  describe('getRequiredDataPoints', () => {
    it('should calculate required data points for a period', () => {
      expect(IndicatorDataTransformer.getRequiredDataPoints(20)).toBe(20);
      expect(IndicatorDataTransformer.getRequiredDataPoints(20, 1.5)).toBe(30);
      expect(IndicatorDataTransformer.getRequiredDataPoints(26, 2)).toBe(52);
    });

    it('should round up for fractional multipliers', () => {
      expect(IndicatorDataTransformer.getRequiredDataPoints(3, 1.1)).toBe(4);
    });
  });

  describe('hasMinimumDataPoints', () => {
    it('should return true if sufficient data points', () => {
      const result = IndicatorDataTransformer.hasMinimumDataPoints(mockPrices, 5);

      expect(result).toBe(true);
    });

    it('should return false if insufficient data points', () => {
      const result = IndicatorDataTransformer.hasMinimumDataPoints(mockPrices, 10);

      expect(result).toBe(false);
    });

    it('should consider multiplier in calculation', () => {
      const result = IndicatorDataTransformer.hasMinimumDataPoints(mockPrices, 3, 2);

      expect(result).toBe(false); // needs 3 * 2 = 6, but only has 5
    });

    it('should use rounded required data points when multiplier is fractional', () => {
      const result = IndicatorDataTransformer.hasMinimumDataPoints(mockPrices.slice(0, 4), 3, 1.1);

      expect(result).toBe(true);
    });
  });

  describe('getLatestValue', () => {
    it('should return the latest non-NaN value', () => {
      const values = [NaN, NaN, 10, 20, 30];

      const result = IndicatorDataTransformer.getLatestValue(values);

      expect(result).toBe(30);
    });

    it('should skip trailing NaN values', () => {
      const values = [10, 20, NaN, NaN];

      const result = IndicatorDataTransformer.getLatestValue(values);

      expect(result).toBe(20);
    });

    it('should return null if all values are NaN', () => {
      const values = [NaN, NaN, NaN];

      const result = IndicatorDataTransformer.getLatestValue(values);

      expect(result).toBeNull();
    });

    it('should return null for empty array', () => {
      const result = IndicatorDataTransformer.getLatestValue([]);

      expect(result).toBeNull();
    });
  });

  describe('getPreviousValue', () => {
    it('should return the value before the latest', () => {
      const values = [NaN, NaN, 10, 20, 30];

      const result = IndicatorDataTransformer.getPreviousValue(values);

      expect(result).toBe(20);
    });

    it('should skip trailing NaN values and return previous non-NaN', () => {
      const values = [10, 20, 30, NaN, NaN];

      const result = IndicatorDataTransformer.getPreviousValue(values);

      expect(result).toBe(20);
    });

    it('should return null if only one non-NaN value exists', () => {
      const values = [NaN, NaN, 10];

      const result = IndicatorDataTransformer.getPreviousValue(values);

      expect(result).toBeNull();
    });

    it('should return null for empty array', () => {
      const result = IndicatorDataTransformer.getPreviousValue([]);

      expect(result).toBeNull();
    });
  });

  describe('detectCrossover', () => {
    it('should detect golden cross (line1 crosses above line2)', () => {
      const result = IndicatorDataTransformer.detectCrossover(
        105, // line1 current (above)
        95, // line1 previous (below)
        100, // line2 current
        100 // line2 previous
      );

      expect(result).toBe('golden');
    });

    it('should detect death cross (line1 crosses below line2)', () => {
      const result = IndicatorDataTransformer.detectCrossover(
        95, // line1 current (below)
        105, // line1 previous (above)
        100, // line2 current
        100 // line2 previous
      );

      expect(result).toBe('death');
    });

    it('should return null if no crossover', () => {
      const result = IndicatorDataTransformer.detectCrossover(
        105, // line1 current (above)
        110, // line1 previous (above)
        100, // line2 current
        100 // line2 previous
      );

      expect(result).toBeNull();
    });

    it('should return null if current values are equal', () => {
      const result = IndicatorDataTransformer.detectCrossover(
        100, // line1 current (equal)
        95, // line1 previous (below)
        100, // line2 current
        100 // line2 previous
      );

      expect(result).toBeNull();
    });

    it('should handle exact equality in previous values', () => {
      // Previous values equal, current shows golden cross
      const result = IndicatorDataTransformer.detectCrossover(
        105, // line1 current (above)
        100, // line1 previous (equal)
        100, // line2 current
        100 // line2 previous (equal)
      );

      expect(result).toBe('golden');
    });
  });
});
