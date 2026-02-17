import { SignalType as AlgoSignalType } from '../../../../algorithm/interfaces';

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

/** Key for per-coin per-direction cooldown tracking */
export type CooldownKey = `${string}:${'BUY' | 'SELL'}`;

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

/** Algorithm signal types that bypass throttling (risk-control signals). */
export const THROTTLE_BYPASS_TYPES: ReadonlySet<AlgoSignalType> = new Set([
  AlgoSignalType.STOP_LOSS,
  AlgoSignalType.TAKE_PROFIT
]);
