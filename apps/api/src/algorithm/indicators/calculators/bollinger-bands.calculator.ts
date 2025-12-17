import { BollingerBands } from 'technicalindicators';

import { BaseIndicatorCalculator } from './base-indicator.calculator';

import { BollingerBandsDataPoint, CalculatorBollingerBandsOptions } from '../indicator.interface';

/**
 * Bollinger Bands Calculator
 *
 * Calculates Bollinger Bands which consist of:
 * - Middle Band: N-period Simple Moving Average
 * - Upper Band: Middle Band + (K × Standard Deviation)
 * - Lower Band: Middle Band - (K × Standard Deviation)
 *
 * Also calculates:
 * - %B (Percent B): Position of price relative to bands
 * - Bandwidth: Width of bands relative to middle band
 *
 * Common settings: Period=20, StdDev=2
 *
 * Trading interpretations:
 * - Price near upper band: Potentially overbought
 * - Price near lower band: Potentially oversold
 * - Bandwidth squeeze: Low volatility, potential breakout
 * - Bandwidth expansion: Increasing volatility
 *
 * @example
 * const calculator = new BollingerBandsCalculator();
 * const result = calculator.calculate({
 *   values: prices,
 *   period: 20,
 *   stdDev: 2
 * });
 */
export class BollingerBandsCalculator extends BaseIndicatorCalculator<
  CalculatorBollingerBandsOptions,
  BollingerBandsDataPoint[]
> {
  readonly id = 'bollingerBands';
  readonly name = 'Bollinger Bands';

  /**
   * Calculate Bollinger Bands for the given price data
   *
   * @param options - Values array, period, and standard deviation multiplier
   * @returns Array of Bollinger Bands data points
   */
  calculate(options: CalculatorBollingerBandsOptions): BollingerBandsDataPoint[] {
    this.validateOptions(options);

    const { values, period, stdDev } = options;
    return BollingerBands.calculate({ values, period, stdDev });
  }

  /**
   * Get the warmup period for Bollinger Bands
   * Requires (period - 1) data points before first valid value
   *
   * @param options - Options containing period
   * @returns Number of warmup data points needed
   */
  getWarmupPeriod(options: Partial<CalculatorBollingerBandsOptions>): number {
    const period = options.period ?? 20;
    return period - 1;
  }

  /**
   * Validate Bollinger Bands options
   *
   * @param options - Options to validate
   * @throws Error if options are invalid
   */
  validateOptions(options: CalculatorBollingerBandsOptions): void {
    this.validatePeriod(options.period);

    if (typeof options.stdDev !== 'number' || options.stdDev <= 0) {
      throw new Error(`stdDev must be a positive number, got ${options.stdDev}`);
    }

    this.validateDataLength(options.values, options.period);
    this.validateNumericValues(options.values);
  }
}
