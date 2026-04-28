/**
 * Declares what technical indicators a strategy needs, enabling
 * the backtest engine to precompute full series before the timestamp loop
 * instead of recalculating per-timestamp via IndicatorService + Redis.
 */
export interface IndicatorRequirement {
  /** Indicator type to compute */
  type: 'EMA' | 'SMA' | 'RSI' | 'MACD' | 'BOLLINGER_BANDS' | 'ATR' | 'ADX';
  /** Config keys to read the period/params from (e.g. ['fastPeriod']) */
  paramKeys: string[];
  /** Fallback values when config keys are missing */
  defaultParams: Record<string, number>;
}
