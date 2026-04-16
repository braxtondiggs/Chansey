/**
 * Timeframe identifiers for multi-timeframe aggregation (Phase 1).
 *
 * Decoupled from `TimeframeType` in metrics-calculator.interface.ts — that enum
 * is used for annualization factors (12/52/365/8760) and does not map cleanly
 * to 4h. Keep them separate so aggregation boundaries stay explicit.
 */
export enum PriceTimeframe {
  HOURLY = 'hourly',
  FOUR_HOUR = 'four_hour',
  DAILY = 'daily',
  WEEKLY = 'weekly'
}

/**
 * Per-timeframe sliding window sizes used by the backtest loop.
 * Chosen so that strategies can compute realistic long-horizon indicators
 * (e.g. 200-day SMA on the daily feed needs ~400 bars of history).
 */
export const PRICE_TIMEFRAME_WINDOW_SIZES: Record<PriceTimeframe, number> = {
  [PriceTimeframe.HOURLY]: 500,
  [PriceTimeframe.FOUR_HOUR]: 500,
  [PriceTimeframe.DAILY]: 400,
  [PriceTimeframe.WEEKLY]: 150
};

/**
 * Timeframes derived by aggregation from 1h candles.
 * Excludes `HOURLY` since that is the source feed.
 */
export const HIGHER_TIMEFRAMES = [PriceTimeframe.FOUR_HOUR, PriceTimeframe.DAILY, PriceTimeframe.WEEKLY] as const;

export type HigherTimeframe = (typeof HIGHER_TIMEFRAMES)[number];
