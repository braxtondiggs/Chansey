import { computeAdaptiveStepDays, computeWarmupDays, daysBetween } from './optimization-calc.util';

import { ParameterSpace } from '../interfaces';

const createValidSpace = (overrides: Partial<ParameterSpace> = {}): ParameterSpace => ({
  strategyType: 'test-strategy',
  parameters: [],
  ...overrides
});

describe('optimization-calc.util', () => {
  describe('computeWarmupDays', () => {
    it('should return minimum 5 when no period parameters exist', () => {
      // Covers both empty params and non-matching param names (same maxPeriod=0 path)
      const space = createValidSpace({
        parameters: [
          { name: 'threshold', type: 'float', min: 0.1, max: 0.9, step: 0.1, default: 0.5, priority: 'medium' }
        ]
      });
      expect(computeWarmupDays(createValidSpace())).toBe(5);
      expect(computeWarmupDays(space)).toBe(5);
    });

    it('should compute warmup from period parameter max with 1.2x margin', () => {
      const space = createValidSpace({
        parameters: [{ name: 'rsiPeriod', type: 'integer', min: 7, max: 21, step: 7, default: 14, priority: 'medium' }]
      });
      // max=21, no compound, * 1.2 = 25.2 → ceil = 26
      expect(computeWarmupDays(space)).toBe(26);
    });

    it('should apply 1.5x multiplier for compound indicators (slow/signal)', () => {
      const space = createValidSpace({
        parameters: [
          { name: 'slowPeriod', type: 'integer', min: 20, max: 34, step: 2, default: 26, priority: 'medium' },
          { name: 'signalPeriod', type: 'integer', min: 5, max: 12, step: 1, default: 9, priority: 'medium' }
        ]
      });
      // max=34, compound=true, 34*1.5*1.2 = 61.2 → ceil = 62
      expect(computeWarmupDays(space)).toBe(62);
    });

    it('should fall back to default when max is not defined', () => {
      const space = createValidSpace({
        parameters: [{ name: 'lookback', type: 'integer', default: 50, priority: 'medium' } as any]
      });
      // default=50, no compound, * 1.2 = 60
      expect(computeWarmupDays(space)).toBe(60);
    });

    it('should pick the largest period across multiple period parameters', () => {
      const space = createValidSpace({
        parameters: [
          { name: 'fastPeriod', type: 'integer', min: 5, max: 12, step: 1, default: 8, priority: 'medium' },
          { name: 'atrPeriod', type: 'integer', min: 10, max: 30, step: 5, default: 14, priority: 'medium' }
        ]
      });
      // max=30, no compound (fast doesn't match COMPOUND_PARAM_PATTERN), * 1.2 = 36
      expect(computeWarmupDays(space)).toBe(36);
    });
  });

  describe('daysBetween', () => {
    it('should compute days between two dates', () => {
      const a = new Date('2024-01-01');
      const b = new Date('2024-01-31');
      expect(daysBetween(a, b)).toBe(30);
    });

    it('should return 0 for the same date', () => {
      const d = new Date('2024-06-15');
      expect(daysBetween(d, d)).toBe(0);
    });

    it('should be order-independent (absolute difference)', () => {
      const a = new Date('2024-03-01');
      const b = new Date('2024-01-01');
      expect(daysBetween(a, b)).toBe(daysBetween(b, a));
      expect(daysBetween(a, b)).toBe(60);
    });
  });

  describe('computeAdaptiveStepDays', () => {
    it.each([
      {
        desc: 'step fits comfortably',
        totalDays: 300,
        train: 90,
        test: 30,
        step: 15,
        min: 3,
        expected: 15,
        adjusted: false
      },
      {
        desc: 'exact fit (124 days, step=21, 3 windows)',
        totalDays: 124,
        train: 60,
        test: 21,
        step: 21,
        min: 3,
        expected: 21,
        adjusted: false
      },
      {
        desc: 'risk level 5 config on 108 days',
        totalDays: 108,
        train: 30,
        test: 14,
        step: 14,
        min: 3,
        expected: 14,
        adjusted: false
      },
      {
        desc: 'large data never exceeds configured step',
        totalDays: 500,
        train: 30,
        test: 14,
        step: 5,
        min: 3,
        expected: 5,
        adjusted: false
      }
    ])('should not adjust when $desc', ({ totalDays, train, test, step, min, expected, adjusted }) => {
      const result = computeAdaptiveStepDays(totalDays, train, test, step, min);
      expect(result).toEqual({ stepDays: expected, adjusted });
    });

    it('should reduce step when data is tight (108 days, risk level 4)', () => {
      // windowSize=82, maxStep = floor((108-82)/2) = 13
      const result = computeAdaptiveStepDays(108, 60, 21, 21, 3);
      expect(result).toEqual({ stepDays: 13, adjusted: true });
    });

    it('should floor at 1 day for very tight data', () => {
      // windowSize=82, maxStep = floor(0/2) = 0 → floors at 1
      const result = computeAdaptiveStepDays(82, 60, 21, 21, 3);
      expect(result).toEqual({ stepDays: 1, adjusted: true });
    });

    it('should return configured step unchanged when data < one window', () => {
      const result = computeAdaptiveStepDays(50, 60, 21, 21, 3);
      expect(result).toEqual({ stepDays: 21, adjusted: false });
    });

    it('should return configured step unchanged when minWindows <= 1', () => {
      expect(computeAdaptiveStepDays(100, 60, 21, 21, 1)).toEqual({ stepDays: 21, adjusted: false });
      expect(computeAdaptiveStepDays(100, 60, 21, 21, 0)).toEqual({ stepDays: 21, adjusted: false });
    });
  });
});
