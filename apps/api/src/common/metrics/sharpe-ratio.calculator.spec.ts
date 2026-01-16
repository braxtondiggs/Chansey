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

    it('returns 0 when returns have zero volatility', () => {
      expect(calculator.calculate([0.01, 0.01, 0.01], 0, 1)).toBe(0);
    });

    it('calculates a sharpe ratio with risk-free conversion and annualization', () => {
      const sharpe = calculator.calculate([0.03, 0.02], 0.12, 12);
      expect(sharpe).toBeCloseTo(10.3923, 4);
    });
  });

  describe('calculateFromMetrics', () => {
    it('returns 0 when annualized volatility is zero', () => {
      expect(calculator.calculateFromMetrics(0.1, 0)).toBe(0);
    });

    it('calculates sharpe from annualized return and volatility', () => {
      expect(calculator.calculateFromMetrics(0.1, 0.2, 0.02)).toBeCloseTo(0.4, 6);
    });
  });

  describe('calculateRolling', () => {
    it('returns empty array when window size is larger than data', () => {
      expect(calculator.calculateRolling([0.01, 0.02], 3)).toEqual([]);
    });

    it('returns rolling sharpe values for each window', () => {
      const returns = [0.03, 0.02, 0.01];
      const rolling = calculator.calculateRolling(returns, 2, 0.12, 12);

      const expected = [calculator.calculate([0.03, 0.02], 0.12, 12), calculator.calculate([0.02, 0.01], 0.12, 12)];

      expect(rolling).toEqual(expected);
    });
  });

  describe('calculateSortino', () => {
    it('returns 0 when returns array is empty', () => {
      expect(calculator.calculateSortino([])).toBe(0);
    });

    it('returns Infinity when all returns exceed the risk-free rate', () => {
      expect(calculator.calculateSortino([0.02, 0.03], 0.12, 12)).toBe(Infinity);
    });

    it('returns 0 when mean excess return is zero', () => {
      expect(calculator.calculateSortino([0.02, -0.02], 0, 1)).toBe(0);
    });
  });

  describe('interpretSharpe', () => {
    it.each([
      [2.5, 'excellent'],
      [1.5, 'good'],
      [0.75, 'acceptable'],
      [0.1, 'poor']
    ])('grades %p as %s', (value, grade) => {
      expect(calculator.interpretSharpe(value).grade).toBe(grade);
    });
  });
});
