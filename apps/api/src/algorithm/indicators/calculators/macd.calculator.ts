import { MACD } from 'technicalindicators';

import { BaseIndicatorCalculator } from './base-indicator.calculator';

import { CalculatorMACDOptions, MACDDataPoint } from '../indicator.interface';

/**
 * Moving Average Convergence Divergence (MACD) Calculator
 *
 * Calculates the MACD indicator which shows the relationship between
 * two exponential moving averages. MACD consists of three components:
 *
 * - MACD Line: Fast EMA - Slow EMA
 * - Signal Line: EMA of MACD Line
 * - Histogram: MACD Line - Signal Line
 *
 * Common settings: Fast=12, Slow=26, Signal=9
 *
 * Trading signals:
 * - MACD crosses above signal: Bullish
 * - MACD crosses below signal: Bearish
 * - Positive histogram: Bullish momentum
 * - Negative histogram: Bearish momentum
 *
 * @example
 * const calculator = new MACDCalculator();
 * const result = calculator.calculate({
 *   values: prices,
 *   fastPeriod: 12,
 *   slowPeriod: 26,
 *   signalPeriod: 9
 * });
 */
export class MACDCalculator extends BaseIndicatorCalculator<CalculatorMACDOptions, MACDDataPoint[]> {
  readonly id = 'macd';
  readonly name = 'Moving Average Convergence Divergence';

  /**
   * Calculate MACD values for the given price data
   *
   * @param options - Values array and MACD parameters
   * @returns Array of MACD data points with MACD, signal, and histogram values
   */
  calculate(options: CalculatorMACDOptions): MACDDataPoint[] {
    this.validateOptions(options);

    const { values, fastPeriod, slowPeriod, signalPeriod } = options;
    return MACD.calculate({
      values,
      fastPeriod,
      slowPeriod,
      signalPeriod,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });
  }

  /**
   * Get the warmup period for MACD
   * MACD needs slowPeriod + signalPeriod - 1 data points
   *
   * @param options - Options containing period values
   * @returns Number of warmup data points needed
   */
  getWarmupPeriod(options: Partial<CalculatorMACDOptions>): number {
    const slowPeriod = options.slowPeriod ?? 26;
    const signalPeriod = options.signalPeriod ?? 9;
    // Need slow EMA warmup + signal EMA warmup
    return slowPeriod + signalPeriod - 2;
  }

  /**
   * Validate MACD options
   *
   * @param options - Options to validate
   * @throws Error if options are invalid
   */
  validateOptions(options: CalculatorMACDOptions): void {
    this.validatePeriod(options.fastPeriod, 'fastPeriod');
    this.validatePeriod(options.slowPeriod, 'slowPeriod');
    this.validatePeriod(options.signalPeriod, 'signalPeriod');

    if (options.fastPeriod >= options.slowPeriod) {
      throw new Error(`fastPeriod (${options.fastPeriod}) must be less than slowPeriod (${options.slowPeriod})`);
    }

    const minDataPoints = options.slowPeriod + options.signalPeriod;
    this.validateDataLength(options.values, minDataPoints);
    this.validateNumericValues(options.values);
  }
}
