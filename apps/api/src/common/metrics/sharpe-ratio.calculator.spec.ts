import { SharpeRatioCalculator } from './sharpe-ratio.calculator';

describe('SharpeRatioCalculator', () => {
  let calculator: SharpeRatioCalculator;

  beforeEach(() => {
    calculator = new SharpeRatioCalculator();
  });

  describe('calculate', () => {
    it('returns 0 when returns array is empty', () => {
      expect(calculator.calculate([])).toBe(0);
    });

    it('returns 0 when stdDev is at or below MIN_STDDEV threshold', () => {
      // Exact zero volatility
      expect(calculator.calculate([0.01, 0.01, 0.01], 0, 1)).toBe(0);
      // Near-zero volatility (below 1e-10 threshold)
      const tinyDiff = 1e-15;
      expect(calculator.calculate([0.01, 0.01 + tinyDiff, 0.01 - tinyDiff], 0, 1)).toBe(0);
    });

    it('clamps extreme positive Sharpe to MAX_SHARPE (100)', () => {
      // Large mean relative to stdDev produces Sharpe >> 100 without clamping
      const returns = Array.from({ length: 100 }, (_, i) => 0.5 + (i % 2 === 0 ? 1e-8 : -1e-8));
      expect(calculator.calculate(returns, 0, 1)).toBe(100);
    });

    it('clamps extreme negative Sharpe to -MAX_SHARPE (-100)', () => {
      // Large negative mean relative to stdDev
      const returns = Array.from({ length: 100 }, (_, i) => -0.5 + (i % 2 === 0 ? 1e-8 : -1e-8));
      expect(calculator.calculate(returns, 0, 1)).toBe(-100);
    });

    it('calculates correctly with risk-free conversion and annualization', () => {
      expect(calculator.calculate([0.03, 0.02], 0.12, 12)).toBeCloseTo(10.3923, 4);
    });
  });

  describe('calculateFromMetrics', () => {
    it('returns 0 when volatility is at or below MIN_STDDEV threshold', () => {
      expect(calculator.calculateFromMetrics(0.1, 0)).toBe(0);
      expect(calculator.calculateFromMetrics(0.1, 1e-15)).toBe(0);
    });

    it('clamps extreme output to MAX_SHARPE (100)', () => {
      // return=100, vol=1e-5 → unclamped would be 1e7
      expect(calculator.calculateFromMetrics(100, 1e-5, 0)).toBe(100);
    });

    it('calculates correctly from annualized return and volatility', () => {
      expect(calculator.calculateFromMetrics(0.1, 0.2, 0.02)).toBeCloseTo(0.4, 6);
    });
  });

  describe('calculateRolling', () => {
    it('returns empty array when window size exceeds data length', () => {
      expect(calculator.calculateRolling([0.01, 0.02], 3)).toEqual([]);
    });

    it('produces one Sharpe value per sliding window position', () => {
      const returns = [0.03, 0.02, 0.01];
      const rolling = calculator.calculateRolling(returns, 2, 0.12, 12);
      expect(rolling).toHaveLength(2);
      expect(rolling[0]).toBeCloseTo(calculator.calculate([0.03, 0.02], 0.12, 12));
      expect(rolling[1]).toBeCloseTo(calculator.calculate([0.02, 0.01], 0.12, 12));
    });
  });

  describe('calculateSortino', () => {
    it('returns 0 when returns array is empty', () => {
      expect(calculator.calculateSortino([])).toBe(0);
    });

    it('returns MAX_SHARPE (100) when all returns exceed risk-free rate', () => {
      expect(calculator.calculateSortino([0.02, 0.03], 0.12, 12)).toBe(100);
    });

    it('returns MAX_SHARPE when downside deviation is below MIN_STDDEV threshold', () => {
      const periodRate = 0.02 / 252;
      const returns = [periodRate - 1e-18, periodRate + 0.01];
      expect(calculator.calculateSortino(returns, 0.02, 252)).toBe(100);
    });

    it('clamps extreme Sortino to MAX_SHARPE (100)', () => {
      // Large positive return with tiny downside produces extreme ratio
      expect(calculator.calculateSortino([0.5, -0.0001], 0, 1)).toBe(100);
    });

    it('calculates a reasonable value for mixed returns', () => {
      const returns = [0.05, -0.03, 0.02, -0.01, 0.04];
      const result = calculator.calculateSortino(returns, 0, 1);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(100);
    });
  });

  describe('interpretSharpe', () => {
    it.each([
      [2.5, 'excellent'],
      [1.5, 'good'],
      [0.75, 'acceptable'],
      [0.1, 'poor']
    ] as const)('grades %p as %s', (value, grade) => {
      expect(calculator.interpretSharpe(value).grade).toBe(grade);
    });
  });
});
