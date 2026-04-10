import { LiveTradeFiltersDto } from './dto/filters.dto';
import {
  calculateDeviationPercent,
  convertToCsv,
  getDateRange,
  latestPerformanceCondition,
  mapSlippageStatsRow,
  toInt,
  toNumber
} from './live-trade-monitoring.utils';

describe('live-trade-monitoring.utils', () => {
  describe('getDateRange', () => {
    it('returns undefined for both when filters are empty', () => {
      expect(getDateRange({} as LiveTradeFiltersDto)).toEqual({ startDate: undefined, endDate: undefined });
    });

    it('parses valid ISO start and end dates', () => {
      const result = getDateRange({
        startDate: '2025-01-01T00:00:00Z',
        endDate: '2025-02-01T00:00:00Z'
      } as LiveTradeFiltersDto);
      expect(result.startDate).toEqual(new Date('2025-01-01T00:00:00Z'));
      expect(result.endDate).toEqual(new Date('2025-02-01T00:00:00Z'));
    });

    it('handles partial range (start only)', () => {
      const result = getDateRange({ startDate: '2025-01-01T00:00:00Z' } as LiveTradeFiltersDto);
      expect(result.startDate).toEqual(new Date('2025-01-01T00:00:00Z'));
      expect(result.endDate).toBeUndefined();
    });
  });

  describe('toNumber', () => {
    it('returns fallback for null/undefined', () => {
      expect(toNumber(null)).toBe(0);
      expect(toNumber(undefined)).toBe(0);
      expect(toNumber(null, 42)).toBe(42);
    });

    it('parses numeric strings from raw SQL', () => {
      expect(toNumber('123.45')).toBe(123.45);
      expect(toNumber('0')).toBe(0);
    });

    it('returns fallback for NaN / non-finite', () => {
      expect(toNumber('not a number')).toBe(0);
      expect(toNumber('not a number', 7)).toBe(7);
      expect(toNumber(Infinity)).toBe(0);
    });

    it('passes through numeric values', () => {
      expect(toNumber(3.14)).toBe(3.14);
    });
  });

  describe('toInt', () => {
    it('returns fallback for null/undefined', () => {
      expect(toInt(null)).toBe(0);
      expect(toInt(undefined)).toBe(0);
      expect(toInt(undefined, 10)).toBe(10);
    });

    it('parses integer strings from raw SQL', () => {
      expect(toInt('42')).toBe(42);
      expect(toInt('42.9')).toBe(42);
    });

    it('returns fallback for non-numeric strings', () => {
      expect(toInt('abc')).toBe(0);
      expect(toInt('abc', 5)).toBe(5);
    });

    it('returns fallback for non-finite numeric input', () => {
      expect(toInt(Infinity, 5)).toBe(5);
    });
  });

  describe('mapSlippageStatsRow', () => {
    it('returns all-zero stats for null row', () => {
      expect(mapSlippageStatsRow(null)).toEqual({
        avgBps: 0,
        medianBps: 0,
        minBps: 0,
        maxBps: 0,
        p95Bps: 0,
        stdDevBps: 0,
        orderCount: 0
      });
    });

    it('maps a populated row with string values', () => {
      expect(
        mapSlippageStatsRow({
          avgBps: '10.5',
          medianBps: '9',
          minBps: '0',
          maxBps: '50',
          p95Bps: '40',
          stdDevBps: '5.2',
          orderCount: '100'
        })
      ).toEqual({
        avgBps: 10.5,
        medianBps: 9,
        minBps: 0,
        maxBps: 50,
        p95Bps: 40,
        stdDevBps: 5.2,
        orderCount: 100
      });
    });

    it('fills missing fields with zero', () => {
      expect(mapSlippageStatsRow({ avgBps: '3' })).toEqual({
        avgBps: 3,
        medianBps: 0,
        minBps: 0,
        maxBps: 0,
        p95Bps: 0,
        stdDevBps: 0,
        orderCount: 0
      });
    });
  });

  describe('convertToCsv', () => {
    it('returns empty buffer for empty array', () => {
      expect(convertToCsv([]).toString()).toBe('');
    });

    it('writes headers and rows', () => {
      const buf = convertToCsv([
        { a: 1, b: 'x' },
        { a: 2, b: 'y' }
      ]);
      expect(buf.toString()).toBe('a,b\n1,x\n2,y');
    });

    it('quotes values containing commas, quotes, and newlines', () => {
      const buf = convertToCsv([{ a: 'has,comma', b: 'has"quote', c: 'has\nnewline' }]);
      expect(buf.toString()).toBe('a,b,c\n"has,comma","has""quote","has\nnewline"');
    });

    it('prefixes formula-injection characters with single quote', () => {
      const buf = convertToCsv([
        { val: '=cmd()' },
        { val: '+SUM(A1)' },
        { val: '-1' },
        { val: '@foo' },
        { val: '\tTAB' }
      ]);
      const lines = buf.toString().split('\n');
      expect(lines[1]).toBe("'=cmd()");
      expect(lines[2]).toBe("'+SUM(A1)");
      expect(lines[3]).toBe("'-1");
      expect(lines[4]).toBe("'@foo");
      expect(lines[5]).toBe("'\tTAB");
    });

    it('quotes values containing mid-string carriage return', () => {
      const buf = convertToCsv([{ a: 'foo\rbar' }]);
      expect(buf.toString()).toBe('a\n"foo\rbar"');
    });

    it('quotes and prefixes values starting with carriage return', () => {
      const buf = convertToCsv([{ val: '\rCR' }]);
      // Leading \r triggers formula-injection prefix AND requires quoting for the embedded \r
      expect(buf.toString()).toBe('val\n"\'\rCR"');
    });

    it('renders null and undefined as empty strings', () => {
      const buf = convertToCsv([{ a: null, b: undefined, c: 'x' }]);
      expect(buf.toString()).toBe('a,b,c\n,,x');
    });
  });

  describe('calculateDeviationPercent', () => {
    it('returns 0 when both values are zero', () => {
      expect(calculateDeviationPercent(0, 0)).toBe(0);
    });

    it('returns 100 when backtest is zero and live is positive', () => {
      expect(calculateDeviationPercent(5, 0)).toBe(100);
    });

    it('returns -100 when backtest is zero and live is negative', () => {
      expect(calculateDeviationPercent(-3, 0)).toBe(-100);
    });

    it('calculates positive deviation correctly', () => {
      expect(calculateDeviationPercent(120, 100)).toBe(20);
    });

    it('calculates negative deviation correctly', () => {
      expect(calculateDeviationPercent(80, 100)).toBe(-20);
    });

    it('handles negative backtest values', () => {
      // live=-10, backtest=-20 → (-10 - -20) / |-20| * 100 = 50%
      expect(calculateDeviationPercent(-10, -20)).toBe(50);
    });
  });

  describe('latestPerformanceCondition', () => {
    it('builds a correlated subquery against the given alias', () => {
      const condition = latestPerformanceCondition('ap');
      expect(condition).toContain('ap.calculatedAt =');
      expect(condition).toContain('MAX(ap2."calculatedAt")');
      expect(condition).toContain('ap2."algorithmActivationId" = ap."algorithmActivationId"');
    });

    it('honors a different alias', () => {
      expect(latestPerformanceCondition('perf')).toContain('perf."algorithmActivationId"');
    });

    it('honors a custom inner alias', () => {
      const condition = latestPerformanceCondition('ap', 'inner');
      expect(condition).toContain('MAX(inner."calculatedAt")');
      expect(condition).toContain('algorithm_performances inner');
      expect(condition).toContain('inner."algorithmActivationId" = ap."algorithmActivationId"');
    });
  });
});
