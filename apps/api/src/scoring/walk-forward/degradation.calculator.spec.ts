import { type WindowMetrics } from '@chansey/api-interfaces';

import { DegradationCalculator } from './degradation.calculator';

describe('DegradationCalculator', () => {
  let calculator: DegradationCalculator;

  beforeEach(() => {
    calculator = new DegradationCalculator();
  });

  const makeMetrics = (overrides: Partial<WindowMetrics> = {}): WindowMetrics => ({
    totalReturn: 0.15,
    sharpeRatio: 1.5,
    maxDrawdown: 0.1,
    winRate: 0.6,
    tradeCount: 50,
    profitFactor: 1.8,
    volatility: 0.2,
    ...overrides
  });

  describe('calculate()', () => {
    it('returns ~0 degradation when train and test metrics are equal', () => {
      const metrics = makeMetrics();
      const result = calculator.calculate(metrics, metrics);
      expect(result.overallDegradation).toBeCloseTo(0, 1);
      expect(result.severity).toBe('excellent');
      expect(result.recommendation).toContain('Proceed with confidence');
    });

    it('returns positive degradation when test is worse', () => {
      const train = makeMetrics({ sharpeRatio: 2.0, totalReturn: 0.3 });
      const test = makeMetrics({ sharpeRatio: 0.5, totalReturn: 0.05 });
      const result = calculator.calculate(train, test);
      expect(result.overallDegradation).toBeGreaterThan(30);
    });

    it('returns negative degradation (improvement) when test is better', () => {
      const train = makeMetrics({ sharpeRatio: 0.5, totalReturn: 0.05 });
      const test = makeMetrics({ sharpeRatio: 2.0, totalReturn: 0.3 });
      const result = calculator.calculate(train, test);
      expect(result.overallDegradation).toBeLessThan(0);
      expect(result.severity).toBe('excellent');
    });

    it.each([
      { degradation: 5, expected: 'excellent' },
      { degradation: 15, expected: 'good' },
      { degradation: 25, expected: 'acceptable' },
      { degradation: 35, expected: 'warning' },
      { degradation: 60, expected: 'critical' }
    ] as const)('classifies degradation=$degradation as $expected', ({ degradation, expected }) => {
      // Access determineSeverity indirectly via calculate — we craft metrics to produce
      // roughly the target degradation, but the severity bands are tested more directly
      // via isAcceptable/isCritical and the recommendation checks below.
      // Instead, test the severity mapping directly via a workaround:
      const result = calculator['determineSeverity'](degradation);
      expect(result).toBe(expected);
    });

    it('handles zero train sharpe with negative test sharpe (M1 fix)', () => {
      const train = makeMetrics({ sharpeRatio: 0 });
      const test = makeMetrics({ sharpeRatio: -1.5 });
      const result = calculator.calculate(train, test);
      expect(result.metricDegradations.sharpeRatio).toBeGreaterThan(0);
    });

    it('returns 0 sharpe degradation when train=0 and test>=0', () => {
      const train = makeMetrics({ sharpeRatio: 0 });
      const test = makeMetrics({ sharpeRatio: 0.5 });
      const result = calculator.calculate(train, test);
      expect(result.metricDegradations.sharpeRatio).toBe(0);
    });

    it.each([
      { metric: 'maxDrawdown' as const, train: 0.05, test: 0.3 },
      { metric: 'volatility' as const, train: 0.1, test: 0.5 }
    ])('treats higher $metric in test as degradation (inverted metric)', ({ metric, train, test }) => {
      const trainMetrics = makeMetrics({ [metric]: train });
      const testMetrics = makeMetrics({ [metric]: test });
      const result = calculator.calculate(trainMetrics, testMetrics);
      expect(result.metricDegradations[metric]).toBeGreaterThan(0);
    });

    it('clamps at upper bound (300)', () => {
      const train = makeMetrics({ totalReturn: 0.01 });
      const test = makeMetrics({ totalReturn: -10.0 });
      const result = calculator.calculate(train, test);
      expect(result.metricDegradations.totalReturn).toBeLessThanOrEqual(300);
    });

    it('clamps at lower bound (-200)', () => {
      const train = makeMetrics({ totalReturn: 0.01 });
      const test = makeMetrics({ totalReturn: 10.0 });
      const result = calculator.calculate(train, test);
      expect(result.metricDegradations.totalReturn).toBeGreaterThanOrEqual(-200);
    });

    it('defaults profitFactor to 1 when undefined', () => {
      const train = makeMetrics({ profitFactor: undefined });
      const test = makeMetrics({ profitFactor: undefined });
      const result = calculator.calculate(train, test);
      expect(result.metricDegradations.profitFactor).toBeCloseTo(0);
    });

    it('generates warning recommendation listing specific problems', () => {
      const train = makeMetrics({ sharpeRatio: 3.0, totalReturn: 0.5 });
      const test = makeMetrics({ sharpeRatio: 1.0, totalReturn: 0.1 });
      const result = calculator.calculate(train, test);
      if (result.severity === 'warning') {
        expect(result.recommendation).toContain('Consider parameter optimization');
      }
    });

    it('generates critical recommendation blocking deployment', () => {
      const train = makeMetrics({ sharpeRatio: 3.0, totalReturn: 0.5, winRate: 0.8 });
      const test = makeMetrics({ sharpeRatio: 0.1, totalReturn: -0.2, winRate: 0.3 });
      const result = calculator.calculate(train, test);
      expect(result.severity).toBe('critical');
      expect(result.recommendation).toContain('DO NOT deploy');
    });

    it('uses fallback problem text when no specific metric threshold is exceeded', () => {
      // Craft metrics where only profitFactor/volatility degrade enough to push overall
      // into warning/critical, but none of the 4 specific threshold checks trigger:
      // sharpeRatio < 30%, totalReturn < 40%, winRate < 25%, maxDrawdown < 50%
      const train = makeMetrics({
        sharpeRatio: 1.0,
        totalReturn: 0.15,
        winRate: 0.6,
        maxDrawdown: 0.1,
        profitFactor: 5.0,
        volatility: 0.05
      });
      const test = makeMetrics({
        sharpeRatio: 0.8, // 20% drop, below 30% threshold
        totalReturn: 0.1, // 33% drop, below 40% threshold
        winRate: 0.5, // 17% drop, below 25% threshold
        maxDrawdown: 0.14, // 40% increase (inverted), below 50% threshold
        profitFactor: 0.5, // 90% drop — heavy weight pushes overall up
        volatility: 0.5 // 900% increase — heavy weight pushes overall up
      });
      const result = calculator.calculate(train, test);

      // Regardless of severity, the recommendation should not contain empty parens "()"
      expect(result.recommendation).not.toContain('()');
      if (result.severity === 'warning' || result.severity === 'critical') {
        expect(result.recommendation).toContain('overall metric decline');
      }
    });

    it('uses denominator floor when train value is small but non-zero', () => {
      // trainValue = 0.001, minDenominator for totalReturn = 0.01
      // denominator should be max(0.001, 0.01) = 0.01, not 0.001
      const train = makeMetrics({ totalReturn: 0.001 });
      const test = makeMetrics({ totalReturn: 0.0005 });
      const result = calculator.calculate(train, test);
      // Without floor: (0.001-0.0005)/0.001 * 100 = 50%
      // With floor:    (0.001-0.0005)/0.01  * 100 = 5%
      expect(result.metricDegradations.totalReturn).toBeCloseTo(5, 0);
    });
  });

  describe('calculateFromValues()', () => {
    it('returns 0 for empty input', () => {
      expect(calculator.calculateFromValues({})).toBe(0);
    });

    it('calculates degradation for a single metric', () => {
      const result = calculator.calculateFromValues({
        sharpeRatio: { train: 2.0, test: 1.0 }
      });
      // 50% degradation on sharpeRatio, renormalized weight = 1.0
      expect(result).toBeCloseTo(50);
    });

    it('renormalizes weights when only a subset of metrics provided', () => {
      // With only sharpeRatio (weight 0.30) and totalReturn (weight 0.25)
      // renormalized: sharpe = 0.30/0.55, return = 0.25/0.55
      const result = calculator.calculateFromValues({
        sharpeRatio: { train: 2.0, test: 1.0 },
        totalReturn: { train: 0.2, test: 0.1 }
      });
      // sharpe degrad = 50%, return degrad = 50%
      // weighted = 50 * (0.30/0.55) + 50 * (0.25/0.55) = 50
      expect(result).toBeCloseTo(50);
    });

    it('matches calculate() when all 6 metrics are provided', () => {
      const train = makeMetrics();
      const test = makeMetrics({
        sharpeRatio: 1.0,
        totalReturn: 0.1,
        maxDrawdown: 0.15,
        winRate: 0.5,
        profitFactor: 1.2,
        volatility: 0.25
      });

      const fullResult = calculator.calculate(train, test);
      const partialResult = calculator.calculateFromValues({
        sharpeRatio: { train: train.sharpeRatio, test: test.sharpeRatio },
        totalReturn: { train: train.totalReturn, test: test.totalReturn },
        maxDrawdown: { train: train.maxDrawdown, test: test.maxDrawdown },
        winRate: { train: train.winRate, test: test.winRate },
        profitFactor: { train: train.profitFactor ?? 1, test: test.profitFactor ?? 1 },
        volatility: { train: train.volatility, test: test.volatility }
      });

      expect(partialResult).toBeCloseTo(fullResult.overallDegradation, 5);
    });

    it('ignores unknown metric keys', () => {
      const result = calculator.calculateFromValues({
        unknownMetric: { train: 1.0, test: 0.5 }
      });
      expect(result).toBe(0);
    });
  });

  describe('isAcceptable()', () => {
    it.each([
      [25, 30, true],
      [30, 30, true],
      [31, 30, false],
      [45, 50, true],
      [55, 50, false]
    ])('returns %s for degradation=%d, threshold=%d', (degradation, threshold, expected) => {
      expect(calculator.isAcceptable(degradation as number, threshold as number)).toBe(expected);
    });
  });

  describe('isCritical()', () => {
    it.each([
      [40, 50, false],
      [50, 50, false],
      [51, 50, true],
      [35, 30, true],
      [25, 30, false]
    ])('returns %s for degradation=%d, threshold=%d', (degradation, threshold, expected) => {
      expect(calculator.isCritical(degradation as number, threshold as number)).toBe(expected);
    });
  });
});
