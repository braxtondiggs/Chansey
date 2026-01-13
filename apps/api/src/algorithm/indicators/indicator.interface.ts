import { PriceSummary } from '../../ohlc/ohlc-candle.entity';

/**
 * Base indicator calculator interface
 * Each calculator wraps a specific technical indicator from the technicalindicators library
 */
export interface IIndicatorCalculator<TOptions, TResult> {
  /** Unique identifier for this calculator type */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Calculate the indicator given the options */
  calculate(options: TOptions): TResult;
  /** Get the minimum warmup period needed for valid results */
  getWarmupPeriod(options: Partial<TOptions>): number;
  /** Validate that options are correctly formed */
  validateOptions(options: TOptions): void;
}

/**
 * Provider interface for strategies to supply custom calculator implementations
 * Strategies implementing this can override default calculators for specific indicators
 */
export interface IIndicatorProvider {
  /**
   * Returns a custom calculator for the given indicator type, or undefined to use default
   * @param indicatorType - The type of indicator to get custom calculator for
   */
  getCustomCalculator?<T extends keyof IndicatorCalculatorMap>(indicatorType: T): IndicatorCalculatorMap[T] | undefined;
}

/**
 * Base options for price-based indicators
 */
export interface BaseIndicatorOptions {
  /** Unique identifier for the coin (used in cache key) */
  coinId: string;
  /** Price history data */
  prices: PriceSummary[];
  /** Skip cache and force fresh calculation */
  skipCache?: boolean;
}

/**
 * Options for indicators that use a single period parameter
 */
export interface PeriodIndicatorOptions extends BaseIndicatorOptions {
  /** The lookback period for the indicator */
  period: number;
}

/**
 * Options for MACD calculation
 */
export interface MACDOptions extends BaseIndicatorOptions {
  /** Fast EMA period (typically 12) */
  fastPeriod: number;
  /** Slow EMA period (typically 26) */
  slowPeriod: number;
  /** Signal line EMA period (typically 9) */
  signalPeriod: number;
}

/**
 * Options for Bollinger Bands calculation
 */
export interface BollingerBandsOptions extends BaseIndicatorOptions {
  /** The lookback period (typically 20) */
  period: number;
  /** Standard deviation multiplier (typically 2) */
  stdDev: number;
}

/**
 * Options for ATR (Average True Range) calculation
 */
export interface ATROptions extends BaseIndicatorOptions {
  /** The lookback period (typically 14) */
  period: number;
}

/**
 * Result from single-value indicator calculations (SMA, EMA, RSI, SD)
 */
export interface IndicatorResult {
  /** Calculated values, padded with NaN for warmup period */
  values: number[];
  /** Number of non-NaN values */
  validCount: number;
  /** The period used in calculation */
  period: number;
  /** Whether result was retrieved from cache */
  fromCache: boolean;
}

/**
 * Single MACD data point
 */
export interface MACDDataPoint {
  MACD?: number;
  signal?: number;
  histogram?: number;
}

/**
 * Result from MACD calculation
 */
export interface MACDResult {
  /** MACD line values (fast EMA - slow EMA) */
  macd: number[];
  /** Signal line values (EMA of MACD) */
  signal: number[];
  /** Histogram values (MACD - signal) */
  histogram: number[];
  /** Number of valid data points */
  validCount: number;
  /** Fast period used */
  fastPeriod: number;
  /** Slow period used */
  slowPeriod: number;
  /** Signal period used */
  signalPeriod: number;
  /** Whether result was retrieved from cache */
  fromCache: boolean;
}

/**
 * Single Bollinger Bands data point
 */
export interface BollingerBandsDataPoint {
  upper: number;
  middle: number;
  lower: number;
  pb?: number;
  bandwidth?: number;
}

/**
 * Result from Bollinger Bands calculation
 */
export interface BollingerBandsResult {
  /** Upper band values */
  upper: number[];
  /** Middle band values (SMA) */
  middle: number[];
  /** Lower band values */
  lower: number[];
  /** Percent B values (position within bands) */
  pb: number[];
  /** Bandwidth values (band width relative to middle) */
  bandwidth: number[];
  /** Number of valid data points */
  validCount: number;
  /** Period used */
  period: number;
  /** Standard deviation multiplier used */
  stdDev: number;
  /** Whether result was retrieved from cache */
  fromCache: boolean;
}

/**
 * Result from ATR (Average True Range) calculation
 */
export interface ATRResult {
  /** ATR values */
  values: number[];
  /** Number of valid data points */
  validCount: number;
  /** Period used */
  period: number;
  /** Whether result was retrieved from cache */
  fromCache: boolean;
}

/**
 * Internal options used by calculators (extracted price values)
 */
export interface CalculatorPeriodOptions {
  values: number[];
  period: number;
}

export interface CalculatorMACDOptions {
  values: number[];
  fastPeriod: number;
  slowPeriod: number;
  signalPeriod: number;
}

export interface CalculatorBollingerBandsOptions {
  values: number[];
  period: number;
  stdDev: number;
}

export interface CalculatorATROptions {
  high: number[];
  low: number[];
  close: number[];
  period: number;
}

/**
 * Map of indicator types to their calculator interfaces
 * Used for type-safe custom calculator overrides
 */
export interface IndicatorCalculatorMap {
  sma: IIndicatorCalculator<CalculatorPeriodOptions, number[]>;
  ema: IIndicatorCalculator<CalculatorPeriodOptions, number[]>;
  rsi: IIndicatorCalculator<CalculatorPeriodOptions, number[]>;
  sd: IIndicatorCalculator<CalculatorPeriodOptions, number[]>;
  macd: IIndicatorCalculator<CalculatorMACDOptions, MACDDataPoint[]>;
  bollingerBands: IIndicatorCalculator<CalculatorBollingerBandsOptions, BollingerBandsDataPoint[]>;
  atr: IIndicatorCalculator<CalculatorATROptions, number[]>;
}
