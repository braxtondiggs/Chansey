import { Injectable } from '@nestjs/common';

import {
  CooldownKey,
  DEFAULT_THROTTLE_CONFIG,
  SerializableThrottleState,
  SignalThrottleConfig,
  THROTTLE_BYPASS_TYPES,
  ThrottleState
} from './signal-throttle.interface';

import { TradingSignal } from '../../backtest-engine.service';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Stateless signal throttle filter layer.
 *
 * Sits between strategy signal generation and trade execution to:
 * 1. Enforce per-coin+direction cooldowns (prevent continuous-condition re-firing)
 * 2. Cap daily trade frequency (rolling 24h window)
 * 3. Floor sell percentages (prevent micro-sell fragmentation)
 *
 * Risk-control signals (STOP_LOSS, TAKE_PROFIT) always bypass throttling.
 *
 * State is passed explicitly to support checkpoint/resume without service-level mutability.
 */
@Injectable()
export class SignalThrottleService {
  /** Create a fresh throttle state */
  createState(): ThrottleState {
    return {
      lastSignalTime: {} as Record<CooldownKey, number>,
      tradeTimestamps: []
    };
  }

  /**
   * Resolve throttle config from strategy/algorithm parameters, falling back to defaults.
   * Clamps each value to its valid range.
   */
  resolveConfig(params?: Record<string, unknown>): SignalThrottleConfig {
    const clamp = (val: unknown, fallback: number, min: number, max: number): number => {
      const n = typeof val === 'number' && isFinite(val) ? val : fallback;
      return Math.max(min, Math.min(max, n));
    };
    return {
      cooldownMs: clamp(params?.cooldownMs, DEFAULT_THROTTLE_CONFIG.cooldownMs, 0, 604_800_000),
      maxTradesPerDay: clamp(params?.maxTradesPerDay, DEFAULT_THROTTLE_CONFIG.maxTradesPerDay, 0, 50),
      minSellPercent: clamp(params?.minSellPercent, DEFAULT_THROTTLE_CONFIG.minSellPercent, 0, 1)
    };
  }

  /**
   * Filter an array of trading signals through throttle rules.
   * Mutates `state` in place for accepted signals.
   *
   * @returns Signals that pass all throttle checks (possibly with adjusted percentage).
   */
  filterSignals(
    signals: TradingSignal[],
    state: ThrottleState,
    config: SignalThrottleConfig,
    currentTimestampMs: number
  ): TradingSignal[] {
    // Prune expired entries from rolling 24h window
    const windowStart = currentTimestampMs - TWENTY_FOUR_HOURS_MS;
    state.tradeTimestamps = state.tradeTimestamps.filter((ts) => ts > windowStart);

    // Prune stale cooldown entries to prevent unbounded growth
    if (config.cooldownMs > 0) {
      const cooldownCutoff = currentTimestampMs - config.cooldownMs;
      for (const key of Object.keys(state.lastSignalTime) as CooldownKey[]) {
        if (state.lastSignalTime[key] <= cooldownCutoff) {
          delete state.lastSignalTime[key];
        }
      }
    }

    const accepted: TradingSignal[] = [];

    for (const signal of signals) {
      if (signal.action === 'HOLD') {
        continue;
      }

      // Risk-control signals always pass — don't set cooldown or count against daily limit
      if (signal.originalType && THROTTLE_BYPASS_TYPES.has(signal.originalType)) {
        accepted.push(signal);
        continue;
      }

      const direction = signal.action as 'BUY' | 'SELL';

      // Cooldown check
      if (config.cooldownMs > 0) {
        const key: CooldownKey = `${signal.coinId}:${direction}`;
        const lastTime = state.lastSignalTime[key];
        if (lastTime !== undefined && currentTimestampMs - lastTime < config.cooldownMs) {
          continue; // Still in cooldown — suppress
        }
      }

      // Daily cap check
      if (config.maxTradesPerDay > 0 && state.tradeTimestamps.length >= config.maxTradesPerDay) {
        continue; // Daily limit reached — suppress
      }

      // Min sell % enforcement
      let effectiveSignal: TradingSignal = signal;
      if (signal.action === 'SELL' && signal.quantity == null && config.minSellPercent > 0) {
        const effectivePercent = signal.percentage ?? 0;
        if (effectivePercent < config.minSellPercent) {
          effectiveSignal = { ...signal, percentage: config.minSellPercent };
        }
      }

      // Accept signal — update state (use original `signal` for cooldown key)
      if (config.cooldownMs > 0) {
        const key: CooldownKey = `${signal.coinId}:${direction}`;
        state.lastSignalTime[key] = currentTimestampMs;
      }
      state.tradeTimestamps.push(currentTimestampMs);

      accepted.push(effectiveSignal);
    }

    return accepted;
  }

  /** Serialize throttle state for checkpoint persistence */
  serialize(state: ThrottleState): SerializableThrottleState {
    return {
      lastSignalTime: { ...state.lastSignalTime },
      tradeTimestamps: [...state.tradeTimestamps]
    };
  }

  /** Deserialize throttle state from checkpoint */
  deserialize(serialized: SerializableThrottleState): ThrottleState {
    return {
      lastSignalTime: { ...serialized.lastSignalTime } as Record<CooldownKey, number>,
      tradeTimestamps: [...serialized.tradeTimestamps]
    };
  }
}
