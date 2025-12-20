/**
 * Multi-Indicator Confluence Strategy Interfaces
 *
 * Defines configuration and scoring structures for combining multiple
 * indicator families (Trend, Momentum, Oscillator, Volatility, Mean Reversion)
 * to generate high-confidence trading signals through confluence.
 */

/**
 * Base configuration for an individual indicator with enable/disable toggle
 */
export interface IndicatorConfig {
  enabled: boolean;
}

/**
 * EMA (Exponential Moving Average) Trend indicator configuration
 */
export interface EMAIndicatorConfig extends IndicatorConfig {
  fastPeriod: number; // Default: 12
  slowPeriod: number; // Default: 26
}

/**
 * RSI (Relative Strength Index) Momentum indicator configuration
 */
export interface RSIIndicatorConfig extends IndicatorConfig {
  period: number; // Default: 14
  buyThreshold: number; // Default: 40 (RSI < 40 = room to run up)
  sellThreshold: number; // Default: 60 (RSI > 60 = room to fall)
}

/**
 * MACD (Moving Average Convergence Divergence) Oscillator indicator configuration
 */
export interface MACDIndicatorConfig extends IndicatorConfig {
  fastPeriod: number; // Default: 12
  slowPeriod: number; // Default: 26
  signalPeriod: number; // Default: 9
}

/**
 * ATR (Average True Range) Volatility filter indicator configuration
 */
export interface ATRIndicatorConfig extends IndicatorConfig {
  period: number; // Default: 14
  volatilityThresholdMultiplier: number; // Default: 1.5 (filter when ATR > avg * multiplier)
}

/**
 * Bollinger Bands Mean Reversion indicator configuration
 */
export interface BollingerBandsIndicatorConfig extends IndicatorConfig {
  period: number; // Default: 20
  stdDev: number; // Default: 2
  buyThreshold: number; // Default: 0.2 (%B < 0.2 = near lower band = bullish)
  sellThreshold: number; // Default: 0.8 (%B > 0.8 = near upper band = bearish)
}

/**
 * Main Confluence Strategy configuration
 */
export interface ConfluenceConfig {
  // Core confluence settings
  minConfluence: number; // 2-5, number of indicators that must agree
  minConfidence: number; // 0-1, minimum confidence to generate signal

  // Individual indicator configurations
  ema: EMAIndicatorConfig;
  rsi: RSIIndicatorConfig;
  macd: MACDIndicatorConfig;
  atr: ATRIndicatorConfig;
  bollingerBands: BollingerBandsIndicatorConfig;
}

/**
 * Signal type for individual indicator evaluation
 */
export type IndicatorSignalType = 'bullish' | 'bearish' | 'neutral' | 'filtered';

/**
 * Signal contribution from a single indicator
 */
export interface IndicatorSignal {
  name: 'EMA' | 'RSI' | 'MACD' | 'ATR' | 'BB';
  signal: IndicatorSignalType;
  strength: number; // 0-1, contribution to overall strength
  reason: string; // Human-readable explanation
  values: Record<string, number>; // Indicator-specific values for metadata
}

/**
 * Confluence score combining all indicator signals
 */
export interface ConfluenceScore {
  direction: 'buy' | 'sell' | 'hold';
  confluenceCount: number; // How many indicators agree (0-5)
  totalEnabled: number; // How many indicators are enabled
  signals: IndicatorSignal[]; // Individual indicator contributions
  averageStrength: number; // Average strength of agreeing signals
  isVolatilityFiltered: boolean; // True if ATR filtered the signal
}
