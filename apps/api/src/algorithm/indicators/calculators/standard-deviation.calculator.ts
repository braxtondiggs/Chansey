import { SD } from 'technicalindicators';

import { BaseIndicatorCalculator } from './base-indicator.calculator';

import { CalculatorPeriodOptions } from '../indicator.interface';

/**
 * Standard Deviation (SD) Calculator
 *
 * Calculates the standard deviation of prices over a specified period.
 * Standard deviation measures the dispersion of price values from their mean,
 * providing insight into market volatility.
 *
 * Higher SD = Higher volatility
 * Lower SD = Lower volatility (consolidation)
 *
 * Formula: SD = sqrt(sum((x - mean)²) / n)
 *
 * @example
 * const calculator = new StandardDeviationCalculator();
 * const result = calculator.calculate({ values: prices, period: 20 });
 * // Returns standard deviation values for each rolling window
 */
export class StandardDeviationCalculator extends BaseIndicatorCalculator<CalculatorPeriodOptions, number[]> {
  readonly id = 'sd';
  readonly name = 'Standard Deviation';

  /**
   * Calculate Standard Deviation values for the given price data
   *
   * @param options - Values array and period
   * @returns Array of SD values
   */
  calculate(options: CalculatorPeriodOptions): number[] {
    this.validateOptions(options);

    const { values, period } = options;
    return SD.calculate({ values, period });
  }

  /**
   * Get the warmup period for Standard Deviation
   * SD requires (period - 1) data points before first valid value
   *
   * @param options - Options containing period
   * @returns Number of warmup data points needed
   */
  getWarmupPeriod(options: Partial<CalculatorPeriodOptions>): number {
    const period = options.period ?? 20;
    return period - 1;
  }

  /**
   * Validate Standard Deviation options
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
