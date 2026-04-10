import { type WindowMetrics } from '@chansey/api-interfaces';

import {
  calculateCompositeScore,
  calculateConsistencyScore,
  calculateImprovement,
  calculateObjectiveScore,
  computeRankingScore,
  ZERO_TRADE_PENALTY
} from './optimization-scoring.util';

import { type OptimizationConfig } from '../interfaces';

describe('optimization-scoring.util', () => {
  describe('calculateObjectiveScore', () => {
    const calculateScore = (
      metrics: Partial<WindowMetrics> & Pick<WindowMetrics, 'tradeCount'>,
      metric: OptimizationConfig['objective']['metric'],
      weights?: any
    ) => {
      return calculateObjectiveScore({ ...baseMetrics, ...metrics } as WindowMetrics, {
        metric,
        minimize: false,
        weights
      });
    };

    const baseMetrics: WindowMetrics = {
      sharpeRatio: 1.5,
      totalReturn: 0.25,
      maxDrawdown: -0.15,
      winRate: 0.6,
      tradeCount: 100,
      profitFactor: 2.0,
      volatility: 0.2,
      downsideDeviation: 0.15
    };

    it.each([
      ['sharpe_ratio', 1.5],
      ['total_return', 0.25],
      ['profit_factor', 2.0]
    ])('should return direct metric for %s', (metric, expected) => {
      const score = calculateObjectiveScore(baseMetrics, {
        metric: metric as OptimizationConfig['objective']['metric'],
        minimize: false
      });
      expect(score).toBe(expected);
    });

    it('should calculate calmar ratio as return / abs(drawdown)', () => {
      const score = calculateObjectiveScore(baseMetrics, { metric: 'calmar_ratio', minimize: false });
      expect(score).toBeCloseTo(1.667, 2); // 0.25 / 0.15
    });

    it('should return 0 for calmar ratio when maxDrawdown is 0', () => {
      const score = calculateScore({ maxDrawdown: 0, tradeCount: 100 }, 'calmar_ratio');
      expect(score).toBe(0);
    });

    it('should default profit factor to 1 when falsy', () => {
      const score = calculateScore({ profitFactor: undefined as unknown as number, tradeCount: 100 }, 'profit_factor');
      expect(score).toBe(1);
    });

    it('should calculate sortino ratio using downside deviation and risk-free rate', () => {
      const score = calculateObjectiveScore(baseMetrics, { metric: 'sortino_ratio', minimize: false });
      // (0.25 - 0.02) / 0.15 = 1.533
      expect(score).toBeCloseTo(1.533, 2);
    });

    it('should fallback to sharpe when downsideDeviation is 0', () => {
      const score = calculateScore({ downsideDeviation: 0, tradeCount: 100 }, 'sortino_ratio');
      expect(score).toBe(1.5);
    });

    it('should default to sharpe ratio for unknown metric', () => {
      const score = calculateObjectiveScore(baseMetrics, { metric: 'unknown_metric' as any, minimize: false });
      expect(score).toBe(1.5);
    });

    it('should delegate to calculateCompositeScore for composite metric', () => {
      const score = calculateObjectiveScore(baseMetrics, { metric: 'composite', minimize: false });
      const expectedComposite = calculateCompositeScore(baseMetrics);
      expect(score).toBe(expectedComposite);
    });

    it('should return ZERO_TRADE_PENALTY when tradeCount is 0', () => {
      const metrics = { ...baseMetrics, tradeCount: 0 };
      const score = calculateObjectiveScore(metrics, { metric: 'sharpe_ratio', minimize: false });
      expect(score).toBe(ZERO_TRADE_PENALTY);
      expect(score).toBe(-10);
    });

    it('should return 0 for non-finite scores (NaN, Infinity)', () => {
      // Force NaN via 0/0 in calmar path
      const metrics = { ...baseMetrics, totalReturn: NaN, tradeCount: 50 };
      expect(calculateObjectiveScore(metrics, { metric: 'total_return', minimize: false })).toBe(0);
    });

    it('should clamp extreme scores to ±MAX_SHARPE (100)', () => {
      const metrics = { ...baseMetrics, sharpeRatio: 150, tradeCount: 50 };
      expect(calculateObjectiveScore(metrics, { metric: 'sharpe_ratio', minimize: false })).toBe(100);

      const negMetrics = { ...baseMetrics, sharpeRatio: -150, tradeCount: 50 };
      expect(calculateObjectiveScore(negMetrics, { metric: 'sharpe_ratio', minimize: false })).toBe(-100);
    });
  });

  describe('calculateCompositeScore', () => {
    const baseMetrics: WindowMetrics = {
      sharpeRatio: 1.5,
      totalReturn: 0.25,
      maxDrawdown: -0.15,
      winRate: 0.6,
      tradeCount: 100,
      profitFactor: 2.0,
      volatility: 0.2,
      downsideDeviation: 0.15
    };

    it('should return a score between 0 and 1 with default weights', () => {
      const score = calculateCompositeScore(baseMetrics);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should use provided weights instead of defaults', () => {
      const heavySharpe = calculateCompositeScore(baseMetrics, {
        sharpeRatio: 1.0,
        totalReturn: 0,
        calmarRatio: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        winRate: 0
      });
      const heavyWinRate = calculateCompositeScore(baseMetrics, {
        sharpeRatio: 0,
        totalReturn: 0,
        calmarRatio: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        winRate: 1.0
      });
      // Different weights produce different scores
      expect(heavySharpe).not.toBeCloseTo(heavyWinRate, 2);
    });

    it('should normalize values to [0,1] range, clamping outliers', () => {
      // Extreme metrics beyond normalization ranges
      const extreme: WindowMetrics = {
        ...baseMetrics,
        sharpeRatio: 10, // way above max of 3 → clamped to 1.0
        totalReturn: -2, // way below min of -0.5 → clamped to 0.0
        tradeCount: 100
      };
      const score = calculateCompositeScore(extreme);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should return 0 for calmar component when maxDrawdown is 0', () => {
      const metrics = { ...baseMetrics, maxDrawdown: 0 };
      const score = calculateCompositeScore(metrics, {
        sharpeRatio: 0,
        totalReturn: 0,
        calmarRatio: 1.0,
        profitFactor: 0,
        maxDrawdown: 0,
        winRate: 0
      });
      expect(score).toBe(0);
    });
  });

  describe('calculateConsistencyScore', () => {
    it('should return 100 for single score (early return)', () => {
      expect(calculateConsistencyScore([1.5])).toBe(100);
    });

    it('should return 100 for identical scores (zero variance)', () => {
      expect(calculateConsistencyScore([1.5, 1.5, 1.5, 1.5])).toBe(100);
    });

    it('should return lower score for higher variance', () => {
      const lowVariance = calculateConsistencyScore([1.0, 1.1, 1.0, 1.1]);
      const highVariance = calculateConsistencyScore([0.5, 2.0, 0.5, 2.0]);
      expect(lowVariance).toBeGreaterThan(highVariance);
    });

    it('should floor at 0 for very high variance (stdDev >= 2)', () => {
      expect(calculateConsistencyScore([-5, 5, -5, 5])).toBe(0);
    });

    it('should return 50 for stdDev of 1 (validates multiplier constant)', () => {
      expect(calculateConsistencyScore([-1, 1])).toBe(50); // stdDev=1 → 100 - 50 = 50
    });
  });

  describe('calculateImprovement', () => {
    it('should calculate percentage improvement for positive baseline', () => {
      expect(calculateImprovement(2, 1)).toBe(100); // (2-1)/1 * 100
    });

    it('should floor denominator at 1 for small negative baselines', () => {
      // baseline=-0.78 → denom=max(0.78, 1)=1 → (1.23+0.78)/1 * 100 = 201%
      expect(calculateImprovement(1.23, -0.78)).toBeCloseTo(201, 0);
    });

    it('should use abs(baseline) when abs > 1 for negative baselines', () => {
      // baseline=-2 → denom=max(2, 1)=2 → (1+2)/2 * 100 = 150%
      expect(calculateImprovement(1, -2)).toBe(150);
    });

    it.each([
      [1.5, 0, 150],
      [0.5, 0, 50],
      [10, 0, 500],
      [0, 0, 0],
      [-0.5, 0, 0]
    ])('should handle zero baseline: best=%s → %s%%', (best, baseline, expected) => {
      expect(calculateImprovement(best, baseline)).toBe(expected);
    });

    it('should cap at ±500%', () => {
      expect(calculateImprovement(100, 1)).toBe(500);
      expect(calculateImprovement(-100, 1)).toBe(-500);
    });
  });

  describe('computeRankingScore', () => {
    it('should give full multiplier (1.0x) at consistency=100 with no overfitting', () => {
      expect(computeRankingScore(2.0, 100, 0)).toBeCloseTo(2.0, 4);
    });

    it('should apply 0.6x multiplier at consistency=0', () => {
      expect(computeRankingScore(2.0, 0, 0)).toBeCloseTo(1.2, 4);
    });

    it('should apply overfitting penalty of -10% per window', () => {
      const clean = computeRankingScore(2.0, 100, 0);
      const penalized = computeRankingScore(2.0, 100, 2);
      expect(penalized).toBeCloseTo(clean * 0.8, 4);
    });

    it('should floor overfitting penalty at 0.5x', () => {
      // 10 windows → max(0.5, 1.0-1.0) = 0.5
      expect(computeRankingScore(2.0, 100, 10)).toBeCloseTo(1.0, 4);
    });
  });
});
