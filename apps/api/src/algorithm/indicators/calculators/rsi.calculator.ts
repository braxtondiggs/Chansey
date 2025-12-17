import { RSI } from 'technicalindicators';

import { BaseIndicatorCalculator } from './base-indicator.calculator';

import { CalculatorPeriodOptions } from '../indicator.interface';

/**
 * Relative Strength Index (RSI) Calculator
 *
 * Calculates a momentum oscillator that measures the speed and magnitude
 * of price movements. RSI oscillates between 0 and 100.
 *
 * Traditional interpretation:
 * - RSI > 70: Overbought condition (potential sell signal)
 * - RSI < 30: Oversold condition (potential buy signal)
 *
 * Formula: RSI = 100 - (100 / (1 + RS))
 * where RS = Average Gain / Average Loss
 *
 * @example
 * const calculator = new RSICalculator();
 * const result = calculator.calculate({ values: prices, period: 14 });
 * // Returns RSI values between 0-100
 */
export class RSICalculator extends BaseIndicatorCalculator<CalculatorPeriodOptions, number[]> {
  readonly id = 'rsi';
  readonly name = 'Relative Strength Index';

  /**
   * Calculate RSI values for the given price data
   *
   * @param options - Values array and period
   * @returns Array of RSI values (0-100 range)
   */
  calculate(options: CalculatorPeriodOptions): number[] {
    this.validateOptions(options);

    const { values, period } = options;
    return RSI.calculate({ values, period });
  }

  /**
   * Get the warmup period for RSI
   * RSI needs (period) data points before the first valid value
   *
   * @param options - Options containing period
   * @returns Number of warmup data points needed
   */
  getWarmupPeriod(options: Partial<CalculatorPeriodOptions>): number {
    const period = options.period ?? 14;
    // RSI needs period + 1 values to produce first result (needs period changes)
    return period;
  }

  /**
   * Validate RSI options
   *
   * @param options - Options to validate
   * @throws Error if options are invalid
   */
  validateOptions(options: CalculatorPeriodOptions): void {
    this.validatePeriod(options.period);
    // RSI needs period + 1 values minimum (to calculate period price changes)
    this.validateDataLength(options.values, options.period + 1);
    this.validateNumericValues(options.values);
  }
}
