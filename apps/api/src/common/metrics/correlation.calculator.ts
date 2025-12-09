import { Injectable } from '@nestjs/common';

import { calculateMean, calculateStandardDeviation } from './metric-calculator';

export interface CorrelationMatrix {
  matrix: number[][];
  labels: string[];
}

/**
 * Correlation Calculator
 * Calculates correlation between strategy returns for portfolio diversification
 */
@Injectable()
export class CorrelationCalculator {
  /**
   * Calculate Pearson correlation coefficient between two return series
   * @param returns1 First return series
   * @param returns2 Second return series
   * @returns Correlation coefficient (-1 to 1)
   */
  calculatePearsonCorrelation(returns1: number[], returns2: number[]): number {
    if (returns1.length === 0 || returns2.length === 0) return 0;
    if (returns1.length !== returns2.length) {
      throw new Error('Return series must have the same length');
    }

    const n = returns1.length;
    const mean1 = calculateMean(returns1);
    const mean2 = calculateMean(returns2);

    let numerator = 0;
    let sumSquares1 = 0;
    let sumSquares2 = 0;

    for (let i = 0; i < n; i++) {
      const diff1 = returns1[i] - mean1;
      const diff2 = returns2[i] - mean2;

      numerator += diff1 * diff2;
      sumSquares1 += diff1 * diff1;
      sumSquares2 += diff2 * diff2;
    }

    const denominator = Math.sqrt(sumSquares1 * sumSquares2);

    if (denominator === 0) return 0;

    return numerator / denominator;
  }

  /**
   * Calculate Spearman rank correlation (non-parametric)
   * More robust to outliers than Pearson correlation
   */
  calculateSpearmanCorrelation(returns1: number[], returns2: number[]): number {
    if (returns1.length === 0 || returns2.length === 0) return 0;
    if (returns1.length !== returns2.length) {
      throw new Error('Return series must have the same length');
    }

    // Convert to ranks
    const ranks1 = this.convertToRanks(returns1);
    const ranks2 = this.convertToRanks(returns2);

    // Calculate Pearson correlation on ranks
    return this.calculatePearsonCorrelation(ranks1, ranks2);
  }

  /**
   * Calculate correlation matrix for multiple return series
   */
  calculateCorrelationMatrix(returnSeries: number[][], labels?: string[]): CorrelationMatrix {
    const n = returnSeries.length;
    const matrix: number[][] = [];

    // Initialize matrix with zeros
    for (let i = 0; i < n; i++) {
      matrix[i] = new Array(n).fill(0);
    }

    // Calculate correlations
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          matrix[i][j] = 1.0; // Correlation with self is 1
        } else if (j > i) {
          // Calculate correlation for upper triangle
          const corr = this.calculatePearsonCorrelation(returnSeries[i], returnSeries[j]);
          matrix[i][j] = corr;
          matrix[j][i] = corr; // Matrix is symmetric
        }
      }
    }

    return {
      matrix,
      labels: labels || returnSeries.map((_, i) => `Series ${i + 1}`)
    };
  }

  /**
   * Calculate rolling correlation between two return series
   */
  calculateRollingCorrelation(returns1: number[], returns2: number[], windowSize = 30): number[] {
    if (returns1.length < windowSize || returns2.length < windowSize) return [];
    if (returns1.length !== returns2.length) {
      throw new Error('Return series must have the same length');
    }

    const rollingCorr: number[] = [];

    for (let i = windowSize - 1; i < returns1.length; i++) {
      const window1 = returns1.slice(i - windowSize + 1, i + 1);
      const window2 = returns2.slice(i - windowSize + 1, i + 1);

      const corr = this.calculatePearsonCorrelation(window1, window2);
      rollingCorr.push(corr);
    }

    return rollingCorr;
  }

  /**
   * Calculate beta (systematic risk) of strategy relative to benchmark
   * Beta = Covariance(strategy, benchmark) / Variance(benchmark)
   */
  calculateBeta(strategyReturns: number[], benchmarkReturns: number[]): number {
    if (strategyReturns.length === 0 || benchmarkReturns.length === 0) return 0;
    if (strategyReturns.length !== benchmarkReturns.length) {
      throw new Error('Return series must have the same length');
    }

    const covariance = this.calculateCovariance(strategyReturns, benchmarkReturns);
    const benchmarkVariance = this.calculateVariance(benchmarkReturns);

    if (benchmarkVariance === 0) return 0;

    return covariance / benchmarkVariance;
  }

  /**
   * Calculate alpha (excess return) of strategy relative to benchmark
   * Alpha = Strategy Return - (Risk-Free Rate + Beta * (Benchmark Return - Risk-Free Rate))
   */
  calculateAlpha(strategyReturn: number, benchmarkReturn: number, beta: number, riskFreeRate = 0.02): number {
    return strategyReturn - (riskFreeRate + beta * (benchmarkReturn - riskFreeRate));
  }

  /**
   * Calculate covariance between two return series
   */
  private calculateCovariance(returns1: number[], returns2: number[]): number {
    if (returns1.length === 0 || returns2.length === 0) return 0;

    const mean1 = calculateMean(returns1);
    const mean2 = calculateMean(returns2);

    let sum = 0;
    const n = returns1.length;

    for (let i = 0; i < n; i++) {
      sum += (returns1[i] - mean1) * (returns2[i] - mean2);
    }

    return sum / n;
  }

  /**
   * Calculate variance
   */
  private calculateVariance(returns: number[]): number {
    if (returns.length === 0) return 0;

    const mean = calculateMean(returns);
    const squaredDiffs = returns.map((ret) => Math.pow(ret - mean, 2));

    return calculateMean(squaredDiffs);
  }

  /**
   * Convert values to ranks for Spearman correlation
   */
  private convertToRanks(values: number[]): number[] {
    const indexed = values.map((val, idx) => ({ val, idx }));
    indexed.sort((a, b) => a.val - b.val);

    const ranks = new Array(values.length);

    for (let i = 0; i < indexed.length; i++) {
      ranks[indexed[i].idx] = i + 1;
    }

    return ranks;
  }

  /**
   * Interpret correlation strength
   */
  interpretCorrelation(correlation: number): {
    strength: 'none' | 'weak' | 'moderate' | 'strong' | 'very_strong';
    direction: 'positive' | 'negative' | 'neutral';
    description: string;
  } {
    const absCorr = Math.abs(correlation);
    const direction = correlation > 0.05 ? 'positive' : correlation < -0.05 ? 'negative' : 'neutral';

    let strength: 'none' | 'weak' | 'moderate' | 'strong' | 'very_strong';
    let description: string;

    if (absCorr < 0.2) {
      strength = 'none';
      description = 'No meaningful correlation - excellent diversification';
    } else if (absCorr < 0.4) {
      strength = 'weak';
      description = 'Weak correlation - good diversification';
    } else if (absCorr < 0.7) {
      strength = 'moderate';
      description = 'Moderate correlation - some diversification benefit';
    } else if (absCorr < 0.9) {
      strength = 'strong';
      description = 'Strong correlation - limited diversification';
    } else {
      strength = 'very_strong';
      description = 'Very strong correlation - minimal diversification';
    }

    return { strength, direction, description };
  }

  /**
   * Find highly correlated strategy pairs (above threshold)
   */
  findHighlyCorrelatedPairs(
    correlationMatrix: CorrelationMatrix,
    threshold = 0.7
  ): Array<{ strategy1: string; strategy2: string; correlation: number }> {
    const pairs: Array<{ strategy1: string; strategy2: string; correlation: number }> = [];
    const n = correlationMatrix.matrix.length;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const corr = correlationMatrix.matrix[i][j];

        if (Math.abs(corr) >= threshold) {
          pairs.push({
            strategy1: correlationMatrix.labels[i],
            strategy2: correlationMatrix.labels[j],
            correlation: corr
          });
        }
      }
    }

    // Sort by correlation (descending absolute value)
    pairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

    return pairs;
  }
}
