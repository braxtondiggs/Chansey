import { Injectable } from '@nestjs/common';

import { calculateMean, calculateStandardDeviation } from './metric-calculator';

/**
 * Sharpe Ratio Calculator
 *
 * Measures risk-adjusted return using the formula:
 * `Sharpe = (Mean Excess Return / Std Dev) * sqrt(periodsPerYear)`
 *
 * ## Annualization Convention
 *
 * The `periodsPerYear` parameter determines how returns are annualized:
 * - **252** - Daily returns (trading days per year, excludes weekends/holidays)
 * - **365** - Daily returns (calendar days, use for 24/7 crypto markets)
 * - **52** - Weekly returns
 * - **12** - Monthly returns
 *
 * This codebase uses **252** as the default, representing traditional trading days.
 * For cryptocurrency backtests running on calendar days, consider using 365.
 *
 * @see https://en.wikipedia.org/wiki/Sharpe_ratio
 */
@Injectable()
export class SharpeRatioCalculator {
  /**
   * Calculate annualized Sharpe ratio from an array of period returns.
   *
   * @param returns Array of period returns (e.g., daily returns as decimals: 0.01 = 1%)
   * @param riskFreeRate Annual risk-free rate as decimal (default: 0.02 = 2%)
   * @param periodsPerYear Number of return periods per year for annualization.
   *   Common values: 252 (trading days), 365 (calendar days), 52 (weeks), 12 (months)
   * @returns Annualized Sharpe ratio, or 0 if returns array is empty or has zero volatility
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
   * Calculate Sharpe ratio from pre-computed annualized metrics.
   *
   * Use this when you already have annualized return and volatility figures.
   * Unlike `calculate()`, no annualization is applied here.
   *
   * @param annualizedReturn Annualized return as decimal (e.g., 0.15 = 15%)
   * @param annualizedVolatility Annualized volatility (standard deviation) as decimal
   * @param riskFreeRate Annual risk-free rate as decimal (default: 0.02 = 2%)
   * @returns Sharpe ratio, or 0 if volatility is zero
   */
  calculateFromMetrics(annualizedReturn: number, annualizedVolatility: number, riskFreeRate = 0.02): number {
    if (annualizedVolatility === 0) return 0;

    return (annualizedReturn - riskFreeRate) / annualizedVolatility;
  }

  /**
   * Calculate rolling Sharpe ratio over a sliding window.
   *
   * Useful for visualizing how risk-adjusted performance changes over time.
   *
   * @param returns Array of period returns (e.g., daily returns)
   * @param windowSize Number of periods in rolling window (default: 30)
   * @param riskFreeRate Annual risk-free rate as decimal (default: 0.02 = 2%)
   * @param periodsPerYear Number of periods per year for annualization (default: 252)
   * @returns Array of Sharpe ratios, one for each complete window. Empty if returns.length < windowSize
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
   * Calculate Sortino ratio (modified Sharpe using downside deviation).
   *
   * Unlike Sharpe ratio, Sortino only penalizes downside volatility (returns below
   * the risk-free rate), making it more appropriate for strategies with asymmetric
   * return distributions.
   *
   * @param returns Array of period returns (e.g., daily returns)
   * @param riskFreeRate Annual risk-free rate as decimal (default: 0.02 = 2%)
   * @param periodsPerYear Number of periods per year for annualization (default: 252)
   * @returns Annualized Sortino ratio. Returns Infinity if all returns exceed risk-free rate
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
   * Interpret Sharpe ratio quality with human-readable grades.
   *
   * Industry-standard thresholds:
   * - `> 2.0`: Excellent (exceptional risk-adjusted returns)
   * - `> 1.0`: Good (solid risk-adjusted returns)
   * - `> 0.5`: Acceptable (adequate risk-adjusted returns)
   * - `≤ 0.5`: Poor (insufficient compensation for risk)
   *
   * @param sharpe The Sharpe ratio to interpret
   * @returns Object with grade and description
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
