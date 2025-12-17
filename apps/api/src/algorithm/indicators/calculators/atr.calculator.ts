import { ATR } from 'technicalindicators';

import { BaseIndicatorCalculator } from './base-indicator.calculator';

import { CalculatorATROptions } from '../indicator.interface';

/**
 * Average True Range (ATR) Calculator
 *
 * Calculates the Average True Range, a volatility indicator that measures
 * the degree of price movement. ATR is based on the "True Range" which is
 * the greatest of:
 * - Current High - Current Low
 * - |Current High - Previous Close|
 * - |Current Low - Previous Close|
 *
 * ATR is then calculated as an exponential moving average of True Range.
 *
 * Common setting: Period=14
 *
 * Uses:
 * - Setting stop-loss levels (e.g., 2x ATR below entry)
 * - Position sizing based on volatility
 * - Identifying volatility expansions/contractions
 *
 * Note: ATR does not indicate price direction, only volatility magnitude.
 *
 * @example
 * const calculator = new ATRCalculator();
 * const result = calculator.calculate({
 *   high: highPrices,
 *   low: lowPrices,
 *   close: closePrices,
 *   period: 14
 * });
 */
export class ATRCalculator extends BaseIndicatorCalculator<CalculatorATROptions, number[]> {
  readonly id = 'atr';
  readonly name = 'Average True Range';

  /**
   * Calculate ATR values for the given OHLC data
   *
   * @param options - High, Low, Close arrays and period
   * @returns Array of ATR values
   */
  calculate(options: CalculatorATROptions): number[] {
    this.validateOptions(options);

    const { high, low, close, period } = options;
    return ATR.calculate({ high, low, close, period });
  }

  /**
   * Get the warmup period for ATR
   * ATR needs (period) data points before first valid value
   *
   * @param options - Options containing period
   * @returns Number of warmup data points needed
   */
  getWarmupPeriod(options: Partial<CalculatorATROptions>): number {
    const period = options.period ?? 14;
    return period;
  }

  /**
   * Validate ATR options
   *
   * @param options - Options to validate
   * @throws Error if options are invalid
   */
  validateOptions(options: CalculatorATROptions): void {
    this.validatePeriod(options.period);

    // Check all arrays exist
    if (!options.high || !options.low || !options.close) {
      throw new Error('ATR requires high, low, and close price arrays');
    }

    // Check arrays have same length
    if (options.high.length !== options.low.length || options.low.length !== options.close.length) {
      throw new Error(
        `Array lengths must match: high=${options.high.length}, low=${options.low.length}, close=${options.close.length}`
      );
    }

    // ATR needs period + 1 values (first TR needs previous close)
    this.validateDataLength(options.high, options.period + 1);
    this.validateNumericValues(options.high);
    this.validateNumericValues(options.low);
    this.validateNumericValues(options.close);
  }
}
