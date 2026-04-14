import { Injectable } from '@nestjs/common';

import { WindowMetrics } from '@chansey/api-interfaces';

import { DEGRAD_CLAMP, DEGRAD_MIN_DENOMINATOR, DEGRADATION_WEIGHTS, INVERTED_METRICS } from './degradation.constants';

export interface DegradationAnalysis {
  overallDegradation: number;
  metricDegradations: {
    sharpeRatio: number;
    totalReturn: number;
    maxDrawdown: number;
    winRate: number;
    profitFactor: number;
    volatility: number;
  };
  severity: 'excellent' | 'good' | 'acceptable' | 'warning' | 'critical';
  recommendation: string;
}

/**
 * Degradation Calculator
 * Calculates performance degradation from training to test periods
 * Used for overfitting detection in walk-forward analysis
 */
@Injectable()
export class DegradationCalculator {
  /**
   * Calculate comprehensive degradation analysis from full WindowMetrics
   */
  calculate(trainMetrics: WindowMetrics, testMetrics: WindowMetrics): DegradationAnalysis {
    const metricDegradations = {
      sharpeRatio: this.calculateMetricDegrad('sharpeRatio', trainMetrics.sharpeRatio, testMetrics.sharpeRatio),
      totalReturn: this.calculateMetricDegrad('totalReturn', trainMetrics.totalReturn, testMetrics.totalReturn),
      maxDrawdown: this.calculateMetricDegrad('maxDrawdown', trainMetrics.maxDrawdown, testMetrics.maxDrawdown),
      winRate: this.calculateMetricDegrad('winRate', trainMetrics.winRate, testMetrics.winRate),
      profitFactor: this.calculateMetricDegrad(
        'profitFactor',
        trainMetrics.profitFactor || 1,
        testMetrics.profitFactor || 1
      ),
      volatility: this.calculateMetricDegrad('volatility', trainMetrics.volatility, testMetrics.volatility)
    };

    const overallDegradation = this.calculateWeightedDegradation(metricDegradations);
    const severity = this.determineSeverity(overallDegradation);
    const recommendation = this.generateRecommendation(severity, metricDegradations);

    return {
      overallDegradation,
      metricDegradations,
      severity,
      recommendation
    };
  }

  /**
   * Calculate degradation from partial metric values.
   * Accepts a subset of metrics, renormalizes weights to sum to 1.0.
   * Returns overall degradation percentage.
   */
  calculateFromValues(values: Record<string, { train: number; test: number }>): number {
    const entries = Object.entries(values).filter(([key]) => DEGRADATION_WEIGHTS[key] !== undefined);

    if (entries.length === 0) return 0;

    const totalWeight = entries.reduce((sum, [key]) => sum + DEGRADATION_WEIGHTS[key], 0);
    if (totalWeight === 0) return 0;

    let weighted = 0;
    for (const [key, { train, test }] of entries) {
      const degrad = this.calculateMetricDegrad(key, train, test);
      weighted += degrad * (DEGRADATION_WEIGHTS[key] / totalWeight);
    }

    return weighted;
  }

  /**
   * Shared degradation helper with minimum denominator floor and output clamping.
   * Prevents near-zero train values from producing extreme degradation percentages.
   *
   * When trainValue is 0:
   * - If testValue is worse (positive degradation direction), scale by |testValue| / minDenominator
   * - If testValue is equal or better, return 0
   */
  private calculateMetricDegrad(metric: string, trainValue: number, testValue: number): number {
    const minDenominator = DEGRAD_MIN_DENOMINATOR[metric] ?? 0.1;
    const invert = INVERTED_METRICS.has(metric);

    if (trainValue === 0) {
      const diff = invert ? testValue - trainValue : trainValue - testValue;
      if (diff > 0) {
        // Test is worse: scale degradation against minDenominator
        const change = (diff / minDenominator) * 100;
        return Math.max(DEGRAD_CLAMP.min, Math.min(DEGRAD_CLAMP.max, change));
      }
      return 0;
    }

    const denominator = Math.max(Math.abs(trainValue), minDenominator);
    const diff = invert ? testValue - trainValue : trainValue - testValue;
    const change = (diff / denominator) * 100;

    return Math.max(DEGRAD_CLAMP.min, Math.min(DEGRAD_CLAMP.max, change));
  }

  /**
   * Calculate weighted overall degradation
   */
  private calculateWeightedDegradation(metricDegradations: Record<string, number>): number {
    let result = 0;
    for (const [key, weight] of Object.entries(DEGRADATION_WEIGHTS)) {
      result += (metricDegradations[key] ?? 0) * weight;
    }
    return result;
  }

  /**
   * Determine severity level based on degradation percentage
   */
  private determineSeverity(degradation: number): 'excellent' | 'good' | 'acceptable' | 'warning' | 'critical' {
    if (degradation < 10) return 'excellent';
    if (degradation < 20) return 'good';
    if (degradation < 30) return 'acceptable';
    if (degradation < 50) return 'warning';
    return 'critical';
  }

  /**
   * Generate recommendation based on severity and metric degradations
   */
  private generateRecommendation(severity: string, metricDegradations: Record<string, number>): string {
    if (severity === 'excellent') {
      return 'Strategy generalizes well to out-of-sample data. Proceed with confidence.';
    }

    if (severity === 'good') {
      return 'Strategy shows good generalization with minor performance degradation. Acceptable for deployment.';
    }

    if (severity === 'acceptable') {
      return 'Strategy within acceptable degradation threshold. Monitor closely during live trading.';
    }

    const problems: string[] = [];
    if (metricDegradations.sharpeRatio > 30) problems.push('significant Sharpe ratio drop');
    if (metricDegradations.totalReturn > 40) problems.push('large return degradation');
    if (metricDegradations.winRate > 25) problems.push('win rate decline');
    if (metricDegradations.maxDrawdown > 50) problems.push('increased drawdown risk');

    if (problems.length === 0) problems.push('overall metric decline');

    if (severity === 'warning') {
      return `Strategy shows concerning degradation (${problems.join(', ')}). Consider parameter optimization or reject.`;
    }

    return `Critical overfitting detected (${problems.join(', ')}). DO NOT deploy. Revise strategy parameters.`;
  }

  /**
   * Check if degradation is within acceptable limits
   */
  isAcceptable(degradation: number, threshold = 30): boolean {
    return degradation <= threshold;
  }

  /**
   * Check if degradation indicates critical overfitting
   */
  isCritical(degradation: number, threshold = 50): boolean {
    return degradation > threshold;
  }
}
