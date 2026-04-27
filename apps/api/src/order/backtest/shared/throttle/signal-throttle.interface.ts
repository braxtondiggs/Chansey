import { SignalType as AlgoSignalType } from '../../../../algorithm/interfaces';
import type { TradingSignal } from '../types';

/**
 * Configuration for signal throttling.
 * All fields are optional at construction — defaults are provided via DEFAULT_THROTTLE_CONFIG.
 */
export interface SignalThrottleConfig {
  /** After a signal fires for a coin+direction, suppress same-direction signals for that coin during this window (ms).
   *  Set to 0 to disable cooldown. Default: 86400000 (24h). */
  cooldownMs: number;

  /** Cap total trades per strategy in a rolling 24h window.
   *  Set to 0 to disable the daily cap. Default: 6. */
  maxTradesPerDay: number;

  /** Floor on sell percentage — prevents micro-sells.
   *  SELL signals with percentage below this floor are raised to this value.
   *  Explicit quantity sells are NOT modified. Default: 0.50 (50%). */
  minSellPercent: number;
}

export const DEFAULT_THROTTLE_CONFIG: Readonly<SignalThrottleConfig> = {
  cooldownMs: 86_400_000, // 24 hours
  maxTradesPerDay: 6,
  minSellPercent: 0.5
};

export const PAPER_TRADING_DEFAULT_THROTTLE_CONFIG: Readonly<SignalThrottleConfig> = {
  ...DEFAULT_THROTTLE_CONFIG,
  // Matches the candle timeframe strategies evaluate against (1h). Per-bar dedup in the engine
  // is the primary guard; this cooldown is a safety net that caps same-direction signals per
  // coin at 1/hour if dedup misses a quirk in a new strategy.
  cooldownMs: 60 * 60 * 1000
};

/** Key for per-coin per-direction cooldown tracking */
export type CooldownKey = `${string}:${Exclude<TradingSignal['action'], 'HOLD'>}`;

/**
 * Mutable state tracked across iterations during a backtest or live trading session.
 */
export interface ThrottleState {
  /** Per coin+direction last signal timestamp (ms) */
  lastSignalTime: Record<CooldownKey, number>;

  /** Rolling 24h trade timestamp buffer (ms) */
  tradeTimestamps: number[];
}

/**
 * JSON-safe version of ThrottleState for checkpoint serialization.
 */
export interface SerializableThrottleState {
  lastSignalTime: Record<string, number>;
  tradeTimestamps: number[];
}

/** Result of signal throttle filtering, separating accepted from rejected signals. */
export interface ThrottleResult {
  accepted: TradingSignal[];
  rejected: TradingSignal[];
}

/** Algorithm signal types that bypass throttling (risk-control signals). */
export const THROTTLE_BYPASS_TYPES: ReadonlySet<AlgoSignalType> = new Set([
  AlgoSignalType.STOP_LOSS,
  AlgoSignalType.TAKE_PROFIT,
  AlgoSignalType.SHORT_EXIT
]);

/** Maps each algorithm signal type to the backtest TradingSignal action. */
export const SIGNAL_TYPE_TO_ACTION: Record<AlgoSignalType, TradingSignal['action']> = {
  [AlgoSignalType.BUY]: 'BUY',
  [AlgoSignalType.SELL]: 'SELL',
  [AlgoSignalType.STOP_LOSS]: 'SELL',
  [AlgoSignalType.TAKE_PROFIT]: 'SELL',
  [AlgoSignalType.SHORT_ENTRY]: 'OPEN_SHORT',
  [AlgoSignalType.SHORT_EXIT]: 'CLOSE_SHORT',
  [AlgoSignalType.HOLD]: 'HOLD'
};
