import { SMA } from 'technicalindicators';

import { BaseIndicatorCalculator } from './base-indicator.calculator';

import { CalculatorPeriodOptions } from '../indicator.interface';

/**
 * Simple Moving Average (SMA) Calculator
 *
 * Calculates the arithmetic mean of prices over a specified period.
 * The SMA is a lagging indicator that smooths price data by averaging
 * a specified number of past periods.
 *
 * Formula: SMA = (P1 + P2 + ... + Pn) / n
 *
 * @example
 * const calculator = new SMACalculator();
 * const result = calculator.calculate({ values: [1, 2, 3, 4, 5], period: 3 });
 * // Returns: [2, 3, 4] (average of each 3-value window)
 */
export class SMACalculator extends BaseIndicatorCalculator<CalculatorPeriodOptions, number[]> {
  readonly id = 'sma';
  readonly name = 'Simple Moving Average';

  /**
   * Calculate SMA values for the given price data
   *
   * @param options - Values array and period
   * @returns Array of SMA values (length = values.length - period + 1)
   */
  calculate(options: CalculatorPeriodOptions): number[] {
    this.validateOptions(options);

    const { values, period } = options;
    return SMA.calculate({ values, period });
  }

  /**
   * Get the warmup period for SMA
   * SMA requires (period - 1) data points before first valid value
   *
   * @param options - Options containing period
   * @returns Number of warmup data points needed
   */
  getWarmupPeriod(options: Partial<CalculatorPeriodOptions>): number {
    const period = options.period ?? 1;
    return period - 1;
  }

  /**
   * Validate SMA options
   *
   * @param options - Options to validate
   * @throws Error if options are invalid
   */
  validateOptions(options: CalculatorPeriodOptions): void {
    this.validatePeriod(options.period);
    this.validateDataLength(options.values, options.period);
    this.validateNumericValues(options.values);
  }
}
