import { Injectable } from '@nestjs/common';

/**
 * Stability Calculator
 * Measures consistency and distribution of trades over time
 */
@Injectable()
export class StabilityCalculator {
  /**
   * Calculate stability score based on trade distribution
   * Higher score = more stable, consistent trading
   */
  calculate(
    trades: number[],
    periods: number
  ): {
    stabilityScore: number;
    tradesPerPeriod: number;
    consistency: number;
  } {
    if (trades.length === 0 || periods === 0) {
      return { stabilityScore: 0, tradesPerPeriod: 0, consistency: 0 };
    }

    const tradesPerPeriod = trades.length / periods;

    // Calculate variance in returns
    const returns = trades;
    const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    // Consistency score (inverse of coefficient of variation)
    const coefficientOfVariation = meanReturn !== 0 ? stdDev / Math.abs(meanReturn) : Infinity;
    const consistency = coefficientOfVariation !== Infinity ? Math.max(0, 100 - coefficientOfVariation * 10) : 0;

    // Overall stability score (0-100)
    const tradeFrequencyScore = Math.min(100, tradesPerPeriod * 10);
    const stabilityScore = (consistency + tradeFrequencyScore) / 2;

    return {
      stabilityScore,
      tradesPerPeriod,
      consistency
    };
  }

  /**
   * Calculate return consistency using R-squared
   * Measures how well returns fit a linear trend
   */
  calculateRSquared(cumulativeReturns: number[]): number {
    if (cumulativeReturns.length < 2) return 0;

    const n = cumulativeReturns.length;
    const xValues = Array.from({ length: n }, (_, i) => i);
    const yValues = cumulativeReturns;

    // Calculate means
    const xMean = xValues.reduce((sum, x) => sum + x, 0) / n;
    const yMean = yValues.reduce((sum, y) => sum + y, 0) / n;

    // Calculate regression line
    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      numerator += (xValues[i] - xMean) * (yValues[i] - yMean);
      denominator += Math.pow(xValues[i] - xMean, 2);
    }

    const slope = denominator !== 0 ? numerator / denominator : 0;
    const intercept = yMean - slope * xMean;

    // Calculate R-squared
    let ssRes = 0; // Sum of squares of residuals
    let ssTot = 0; // Total sum of squares

    for (let i = 0; i < n; i++) {
      const predicted = slope * xValues[i] + intercept;
      ssRes += Math.pow(yValues[i] - predicted, 2);
      ssTot += Math.pow(yValues[i] - yMean, 2);
    }

    return ssTot !== 0 ? 1 - ssRes / ssTot : 0;
  }

  /**
   * Calculate maximum consecutive wins and losses
   */
  calculateStreaks(trades: number[]): {
    maxWinStreak: number;
    maxLossStreak: number;
    currentStreak: number;
    streakType: 'win' | 'loss' | 'none';
  } {
    if (trades.length === 0) {
      return { maxWinStreak: 0, maxLossStreak: 0, currentStreak: 0, streakType: 'none' };
    }

    let maxWinStreak = 0;
    let maxLossStreak = 0;
    let currentWinStreak = 0;
    let currentLossStreak = 0;

    for (const trade of trades) {
      if (trade > 0) {
        currentWinStreak++;
        currentLossStreak = 0;
        maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
      } else if (trade < 0) {
        currentLossStreak++;
        currentWinStreak = 0;
        maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
      }
    }

    const lastTrade = trades[trades.length - 1];
    const currentStreak = lastTrade > 0 ? currentWinStreak : currentLossStreak;
    const streakType = lastTrade > 0 ? 'win' : lastTrade < 0 ? 'loss' : 'none';

    return {
      maxWinStreak,
      maxLossStreak,
      currentStreak,
      streakType
    };
  }

  /**
   * Interpret stability score
   */
  interpret(stabilityScore: number): {
    grade: 'excellent' | 'good' | 'acceptable' | 'poor';
    description: string;
  } {
    if (stabilityScore >= 80) {
      return { grade: 'excellent', description: 'Highly stable and consistent performance' };
    } else if (stabilityScore >= 60) {
      return { grade: 'good', description: 'Good stability with acceptable consistency' };
    } else if (stabilityScore >= 40) {
      return { grade: 'acceptable', description: 'Moderate stability, monitor for improvements' };
    } else {
      return { grade: 'poor', description: 'Poor stability, inconsistent performance' };
    }
  }
}
