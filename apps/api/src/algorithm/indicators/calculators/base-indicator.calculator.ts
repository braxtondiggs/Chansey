import { IIndicatorCalculator } from '../indicator.interface';

/**
 * Abstract base class for all indicator calculators
 * Provides common utilities and enforces consistent structure
 *
 * @template TOptions - The options type for this calculator
 * @template TResult - The result type from calculate()
 */
export abstract class BaseIndicatorCalculator<TOptions, TResult> implements IIndicatorCalculator<TOptions, TResult> {
  abstract readonly id: string;
  abstract readonly name: string;

  /**
   * Calculate the indicator values
   * @param options - Calculator-specific options
   * @returns The calculated indicator result
   */
  abstract calculate(options: TOptions): TResult;

  /**
   * Get the minimum number of data points needed before valid results
   * @param options - Partial options that may contain period info
   * @returns The warmup period (number of data points to skip)
   */
  abstract getWarmupPeriod(options: Partial<TOptions>): number;

  /**
   * Validate that the options are correctly formed
   * @param options - Options to validate
   * @throws Error if options are invalid
   */
  abstract validateOptions(options: TOptions): void;

  /**
   * Pad an array of indicator results with NaN values to match original data length
   * Useful for aligning indicator output with price data array
   *
   * @param results - The calculated indicator values
   * @param originalLength - The length of the original input data
   * @returns Array padded with NaN at the beginning
   */
  protected padResults(results: number[], originalLength: number): number[] {
    const paddingLength = originalLength - results.length;
    if (paddingLength <= 0) {
      return results;
    }
    const padding = new Array<number>(paddingLength).fill(NaN);
    return [...padding, ...results];
  }

  /**
   * Count the number of valid (non-NaN) values in an array
   *
   * @param values - Array of numbers that may contain NaN
   * @returns Count of non-NaN values
   */
  protected countValidValues(values: number[]): number {
    return values.filter((v) => !isNaN(v)).length;
  }

  /**
   * Ensure a period value is valid (positive integer)
   *
   * @param period - The period to validate
   * @param name - Name of the period parameter for error messages
   * @throws Error if period is invalid
   */
  protected validatePeriod(period: number, name = 'period'): void {
    if (!Number.isInteger(period) || period < 1) {
      throw new Error(`${name} must be a positive integer, got ${period}`);
    }
  }

  /**
   * Ensure values array has sufficient data for calculation
   *
   * @param values - The input data array
   * @param minLength - Minimum required length
   * @throws Error if insufficient data
   */
  protected validateDataLength(values: number[], minLength: number): void {
    if (!values || values.length < minLength) {
      throw new Error(`Insufficient data: need at least ${minLength} data points, got ${values?.length ?? 0}`);
    }
  }

  /**
   * Ensure all values in array are valid numbers
   *
   * @param values - The input data array
   * @throws Error if array contains non-numeric values
   */
  protected validateNumericValues(values: number[]): void {
    if (!values || !Array.isArray(values)) {
      throw new Error('Values must be an array of numbers');
    }
    for (let i = 0; i < values.length; i++) {
      if (typeof values[i] !== 'number' || isNaN(values[i])) {
        throw new Error(`Invalid value at index ${i}: ${values[i]}`);
      }
    }
  }
}
