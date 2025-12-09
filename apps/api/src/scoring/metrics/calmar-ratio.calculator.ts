import { Injectable } from '@nestjs/common';

/**
 * Calmar Ratio Calculator
 * Measures annualized return relative to maximum drawdown
 * Calmar = Annualized Return / Max Drawdown
 */
@Injectable()
export class CalmarRatioCalculator {
  /**
   * Calculate Calmar ratio
   * @param annualizedReturn Annual return percentage (e.g., 0.15 = 15%)
   * @param maxDrawdown Maximum drawdown percentage (e.g., 0.20 = 20%)
   */
  calculate(annualizedReturn: number, maxDrawdown: number): number {
    const absDrawdown = Math.abs(maxDrawdown);

    if (absDrawdown === 0) return 0;

    return annualizedReturn / absDrawdown;
  }

  /**
   * Calculate Calmar ratio from period returns
   */
  calculateFromReturns(returns: number[], maxDrawdown: number, periodsPerYear = 252): number {
    if (returns.length === 0) return 0;

    // Calculate total return
    const totalReturn = returns.reduce((cum, ret) => (1 + cum) * (1 + ret) - 1, 0);

    // Annualize the return
    const annualizedReturn = Math.pow(1 + totalReturn, periodsPerYear / returns.length) - 1;

    return this.calculate(annualizedReturn, maxDrawdown);
  }

  /**
   * Interpret Calmar ratio quality
   */
  interpret(calmar: number): {
    grade: 'excellent' | 'good' | 'acceptable' | 'poor';
    description: string;
  } {
    if (calmar > 2.0) {
      return { grade: 'excellent', description: 'Exceptional return-to-drawdown ratio' };
    } else if (calmar > 1.0) {
      return { grade: 'good', description: 'Good return-to-drawdown ratio' };
    } else if (calmar > 0.5) {
      return { grade: 'acceptable', description: 'Acceptable return-to-drawdown ratio' };
    } else {
      return { grade: 'poor', description: 'Poor return-to-drawdown ratio' };
    }
  }
}
