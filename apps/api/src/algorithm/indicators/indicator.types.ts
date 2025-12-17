/**
 * Enum of all supported indicator types
 */
export enum IndicatorType {
  SMA = 'sma',
  EMA = 'ema',
  RSI = 'rsi',
  SD = 'sd',
  MACD = 'macd',
  BOLLINGER_BANDS = 'bollingerBands',
  ATR = 'atr'
}

/**
 * Options for generating cache keys
 */
export interface CacheKeyOptions {
  /** Indicator type */
  type: IndicatorType;
  /** Coin identifier */
  coinId: string;
  /** Additional parameters to include in key */
  params: Record<string, unknown>;
  /** Price data hash for change detection */
  dataHash: string;
}

/**
 * Metadata about an indicator type
 */
export interface IndicatorMetadata {
  /** Indicator type enum value */
  type: IndicatorType;
  /** Human-readable name */
  name: string;
  /** Brief description */
  description: string;
  /** Default parameters */
  defaults: Record<string, unknown>;
  /** Category of indicator */
  category: IndicatorCategory;
}

/**
 * Categories of technical indicators
 */
export enum IndicatorCategory {
  TREND = 'trend',
  MOMENTUM = 'momentum',
  VOLATILITY = 'volatility',
  VOLUME = 'volume'
}

/**
 * Registry of indicator metadata
 */
export const INDICATOR_METADATA: Record<IndicatorType, IndicatorMetadata> = {
  [IndicatorType.SMA]: {
    type: IndicatorType.SMA,
    name: 'Simple Moving Average',
    description: 'Arithmetic mean of prices over a specified period',
    defaults: { period: 20 },
    category: IndicatorCategory.TREND
  },
  [IndicatorType.EMA]: {
    type: IndicatorType.EMA,
    name: 'Exponential Moving Average',
    description: 'Weighted moving average giving more weight to recent prices',
    defaults: { period: 12 },
    category: IndicatorCategory.TREND
  },
  [IndicatorType.RSI]: {
    type: IndicatorType.RSI,
    name: 'Relative Strength Index',
    description: 'Momentum oscillator measuring speed and magnitude of price changes',
    defaults: { period: 14 },
    category: IndicatorCategory.MOMENTUM
  },
  [IndicatorType.SD]: {
    type: IndicatorType.SD,
    name: 'Standard Deviation',
    description: 'Statistical measure of price volatility',
    defaults: { period: 20 },
    category: IndicatorCategory.VOLATILITY
  },
  [IndicatorType.MACD]: {
    type: IndicatorType.MACD,
    name: 'Moving Average Convergence Divergence',
    description: 'Trend-following momentum indicator showing relationship between two EMAs',
    defaults: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
    category: IndicatorCategory.MOMENTUM
  },
  [IndicatorType.BOLLINGER_BANDS]: {
    type: IndicatorType.BOLLINGER_BANDS,
    name: 'Bollinger Bands',
    description: 'Volatility bands placed above and below a moving average',
    defaults: { period: 20, stdDev: 2 },
    category: IndicatorCategory.VOLATILITY
  },
  [IndicatorType.ATR]: {
    type: IndicatorType.ATR,
    name: 'Average True Range',
    description: 'Volatility indicator measuring the degree of price movement',
    defaults: { period: 14 },
    category: IndicatorCategory.VOLATILITY
  }
};

/**
 * Cache configuration constants
 */
export const INDICATOR_CACHE_CONFIG = {
  /** Default TTL for cached results in seconds */
  DEFAULT_TTL: 300, // 5 minutes
  /** Number of recent prices to use in data hash */
  HASH_SAMPLE_SIZE: 5,
  /** Cache key prefix */
  KEY_PREFIX: 'indicator'
} as const;
