import { Injectable } from '@nestjs/common';

import { calculateMean, calculateStandardDeviation, annualizeVolatility } from './metric-calculator';

/**
 * Sharpe Ratio Calculator
 * Measures risk-adjusted return: (Return - Risk-Free Rate) / Volatility
 */
@Injectable()
export class SharpeRatioCalculator {
  /**
   * Calculate Sharpe ratio from period returns
   * @param returns Array of period returns (e.g., daily returns)
   * @param riskFreeRate Annual risk-free rate (default: 0.02 = 2%)
   * @param periodsPerYear Number of periods per year for annualization (default: 252 for daily)
   */
  calculate(returns: number[], riskFreeRate = 0.02, periodsPerYear = 252): number {
    if (returns.length === 0) return 0;

    // Convert annual risk-free rate to period rate
    const periodRiskFreeRate = riskFreeRate / periodsPerYear;

    // Calculate excess returns (returns above risk-free rate)
    const excessReturns = returns.map((ret) => ret - periodRiskFreeRate);

    // Calculate mean excess return
    const meanExcessReturn = calculateMean(excessReturns);

    // Calculate standard deviation of excess returns
    const stdDev = calculateStandardDeviation(excessReturns);

    if (stdDev === 0) return 0;

    // Annualize the Sharpe ratio
    return (meanExcessReturn / stdDev) * Math.sqrt(periodsPerYear);
  }

  /**
   * Calculate annualized Sharpe ratio from total return and volatility
   */
  calculateFromMetrics(annualizedReturn: number, annualizedVolatility: number, riskFreeRate = 0.02): number {
    if (annualizedVolatility === 0) return 0;

    return (annualizedReturn - riskFreeRate) / annualizedVolatility;
  }

  /**
   * Calculate rolling Sharpe ratio
   * @param returns Array of period returns
   * @param windowSize Number of periods in rolling window (default: 30 for 30-day)
   * @param riskFreeRate Annual risk-free rate
   * @param periodsPerYear Number of periods per year
   */
  calculateRolling(returns: number[], windowSize = 30, riskFreeRate = 0.02, periodsPerYear = 252): number[] {
    if (returns.length < windowSize) return [];

    const rollingSharpe: number[] = [];

    for (let i = windowSize - 1; i < returns.length; i++) {
      const window = returns.slice(i - windowSize + 1, i + 1);
      const sharpe = this.calculate(window, riskFreeRate, periodsPerYear);
      rollingSharpe.push(sharpe);
    }

    return rollingSharpe;
  }

  /**
   * Calculate Sortino ratio (modified Sharpe using downside deviation)
   * Only penalizes downside volatility
   */
  calculateSortino(returns: number[], riskFreeRate = 0.02, periodsPerYear = 252): number {
    if (returns.length === 0) return 0;

    const periodRiskFreeRate = riskFreeRate / periodsPerYear;
    const excessReturns = returns.map((ret) => ret - periodRiskFreeRate);
    const meanExcessReturn = calculateMean(excessReturns);

    // Calculate downside deviation (only negative returns)
    const downsideReturns = returns.filter((ret) => ret < periodRiskFreeRate);
    if (downsideReturns.length === 0) return Infinity; // All returns above risk-free rate

    const squaredDiffs = downsideReturns.map((ret) => Math.pow(ret - periodRiskFreeRate, 2));
    const downsideVariance = squaredDiffs.reduce((sum, val) => sum + val, 0) / returns.length;
    const downsideDeviation = Math.sqrt(downsideVariance);

    if (downsideDeviation === 0) return 0;

    return (meanExcessReturn / downsideDeviation) * Math.sqrt(periodsPerYear);
  }

  /**
   * Interpret Sharpe ratio quality
   */
  interpretSharpe(sharpe: number): {
    grade: 'excellent' | 'good' | 'acceptable' | 'poor';
    description: string;
  } {
    if (sharpe > 2.0) {
      return { grade: 'excellent', description: 'Exceptional risk-adjusted returns' };
    } else if (sharpe > 1.0) {
      return { grade: 'good', description: 'Good risk-adjusted returns' };
    } else if (sharpe > 0.5) {
      return { grade: 'acceptable', description: 'Acceptable risk-adjusted returns' };
    } else {
      return { grade: 'poor', description: 'Poor risk-adjusted returns' };
    }
  }
}
