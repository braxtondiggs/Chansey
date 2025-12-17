import { EMA } from 'technicalindicators';

import { BaseIndicatorCalculator } from './base-indicator.calculator';

import { CalculatorPeriodOptions } from '../indicator.interface';

/**
 * Exponential Moving Average (EMA) Calculator
 *
 * Calculates a weighted moving average that gives more weight to recent prices.
 * The EMA reacts more quickly to price changes than the SMA, making it
 * popular for identifying trend direction and potential reversal points.
 *
 * The weighting multiplier is: 2 / (period + 1)
 *
 * @example
 * const calculator = new EMACalculator();
 * const result = calculator.calculate({ values: [22, 24, 23, 25, 26], period: 3 });
 * // Returns EMA values with exponential weighting
 */
export class EMACalculator extends BaseIndicatorCalculator<CalculatorPeriodOptions, number[]> {
  readonly id = 'ema';
  readonly name = 'Exponential Moving Average';

  /**
   * Calculate EMA values for the given price data
   *
   * @param options - Values array and period
   * @returns Array of EMA values
   */
  calculate(options: CalculatorPeriodOptions): number[] {
    this.validateOptions(options);

    const { values, period } = options;
    return EMA.calculate({ values, period });
  }

  /**
   * Get the warmup period for EMA
   * EMA technically uses all prior data, but typically needs about
   * (period - 1) data points to stabilize
   *
   * @param options - Options containing period
   * @returns Number of warmup data points needed
   */
  getWarmupPeriod(options: Partial<CalculatorPeriodOptions>): number {
    const period = options.period ?? 1;
    return period - 1;
  }

  /**
   * Validate EMA options
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
