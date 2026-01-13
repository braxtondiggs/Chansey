import { PriceSummary } from '../../ohlc/ohlc-candle.entity';

/**
 * Utility class for transforming data for use with the technicalindicators library
 *
 * The technicalindicators library expects specific input formats:
 * - Simple arrays of numbers for basic indicators (SMA, EMA, etc.)
 * - Objects with specific keys for complex indicators (Bollinger Bands, MACD, etc.)
 *
 * This utility provides transformation methods to convert our PriceSummary data
 * to the expected formats.
 */
export class IndicatorDataTransformer {
  /**
   * Extract average prices from PriceSummary array
   * Used for: SMA, EMA, WMA, StandardDeviation, etc.
   *
   * @param prices - Array of PriceSummary objects
   * @returns Array of average prices
   */
  static extractAveragePrices(prices: PriceSummary[]): number[] {
    return prices.map((price) => price.avg);
  }

  /**
   * Extract closing prices from PriceSummary array
   * Note: PriceSummary doesn't have close/open, uses avg instead
   *
   * @param prices - Array of PriceSummary objects
   * @returns Array of average prices (used as closing prices)
   */
  static extractClosePrices(prices: PriceSummary[]): number[] {
    return prices.map((price) => price.avg);
  }

  /**
   * Extract opening prices from PriceSummary array
   * Note: PriceSummary doesn't have open, uses avg instead
   *
   * @param prices - Array of PriceSummary objects
   * @returns Array of average prices (used as opening prices)
   */
  static extractOpenPrices(prices: PriceSummary[]): number[] {
    return prices.map((price) => price.avg);
  }

  /**
   * Extract high prices from PriceSummary array
   * Used for: ATR, Stochastic, and other high/low indicators
   *
   * @param prices - Array of PriceSummary objects
   * @returns Array of high prices
   */
  static extractHighPrices(prices: PriceSummary[]): number[] {
    return prices.map((price) => price.high);
  }

  /**
   * Extract low prices from PriceSummary array
   * Used for: ATR, Stochastic, and other high/low indicators
   *
   * @param prices - Array of PriceSummary objects
   * @returns Array of low prices
   */
  static extractLowPrices(prices: PriceSummary[]): number[] {
    return prices.map((price) => price.low);
  }

  /**
   * Transform PriceSummary array to OHLC format for candlestick indicators
   * Used for: Complex indicators that need full candlestick data
   * Note: PriceSummary uses avg for both open and close
   *
   * @param prices - Array of PriceSummary objects
   * @returns Array of objects with open, high, low, close properties
   */
  static toOHLC(prices: PriceSummary[]): Array<{ open: number; high: number; low: number; close: number }> {
    return prices.map((price) => ({
      open: price.avg,
      high: price.high,
      low: price.low,
      close: price.avg
    }));
  }

  /**
   * Transform PriceSummary array to HLC format
   * Used for: Indicators that don't need open price
   * Note: PriceSummary uses avg as close
   *
   * @param prices - Array of PriceSummary objects
   * @returns Array of objects with high, low, close properties
   */
  static toHLC(prices: PriceSummary[]): Array<{ high: number; low: number; close: number }> {
    return prices.map((price) => ({
      high: price.high,
      low: price.low,
      close: price.avg
    }));
  }

  /**
   * Pad indicator results to match original price array length
   *
   * Many indicators return arrays shorter than the input (due to warmup periods).
   * This method pads the beginning with NaN values to align with the original data.
   *
   * @param indicatorResults - Array of indicator values
   * @param originalLength - Length of the original price array
   * @returns Padded array with NaN values at the beginning
   */
  static padResults(indicatorResults: number[], originalLength: number): number[] {
    const paddingLength = originalLength - indicatorResults.length;
    if (paddingLength <= 0) {
      return indicatorResults;
    }

    const padding = new Array(paddingLength).fill(NaN);
    return [...padding, ...indicatorResults];
  }

  /**
   * Calculate the number of data points needed for a given indicator period
   * Useful for validation before running indicators
   *
   * @param period - The indicator period
   * @param multiplier - Some indicators need more data points (e.g., EMA needs initial SMA)
   * @returns Minimum number of data points required
   */
  static getRequiredDataPoints(period: number, multiplier = 1): number {
    return Math.ceil(period * multiplier);
  }

  /**
   * Validate that we have sufficient data points for an indicator
   *
   * @param prices - Array of PriceSummary objects
   * @param requiredPeriod - Required period for the indicator
   * @param multiplier - Data point multiplier (default 1)
   * @returns true if sufficient data, false otherwise
   */
  static hasMinimumDataPoints(prices: PriceSummary[], requiredPeriod: number, multiplier = 1): boolean {
    return prices.length >= this.getRequiredDataPoints(requiredPeriod, multiplier);
  }

  /**
   * Extract the most recent indicator value (non-NaN)
   * Useful for getting the current indicator state
   *
   * @param indicatorValues - Array of indicator values
   * @returns Most recent non-NaN value or null if none found
   */
  static getLatestValue(indicatorValues: number[]): number | null {
    for (let i = indicatorValues.length - 1; i >= 0; i--) {
      if (!isNaN(indicatorValues[i])) {
        return indicatorValues[i];
      }
    }
    return null;
  }

  /**
   * Get the previous value before the latest (useful for crossover detection)
   *
   * @param indicatorValues - Array of indicator values
   * @returns Previous non-NaN value or null if none found
   */
  static getPreviousValue(indicatorValues: number[]): number | null {
    let foundLatest = false;
    for (let i = indicatorValues.length - 1; i >= 0; i--) {
      if (!isNaN(indicatorValues[i])) {
        if (foundLatest) {
          return indicatorValues[i];
        }
        foundLatest = true;
      }
    }
    return null;
  }

  /**
   * Check if two indicator lines have crossed
   * Returns 'golden' for upward cross, 'death' for downward cross, null for no cross
   *
   * @param line1Current - Current value of first line
   * @param line1Previous - Previous value of first line
   * @param line2Current - Current value of second line
   * @param line2Previous - Previous value of second line
   * @returns 'golden' | 'death' | null
   */
  static detectCrossover(
    line1Current: number,
    line1Previous: number,
    line2Current: number,
    line2Previous: number
  ): 'golden' | 'death' | null {
    // Golden cross: line1 crosses above line2
    if (line1Previous <= line2Previous && line1Current > line2Current) {
      return 'golden';
    }

    // Death cross: line1 crosses below line2
    if (line1Previous >= line2Previous && line1Current < line2Current) {
      return 'death';
    }

    return null;
  }
}
