import { Injectable } from '@nestjs/common';

import {
  CooldownKey,
  DEFAULT_THROTTLE_CONFIG,
  SIGNAL_TYPE_TO_ACTION,
  SerializableThrottleState,
  SignalThrottleConfig,
  THROTTLE_BYPASS_TYPES,
  ThrottleResult,
  ThrottleState
} from './signal-throttle.interface';

import { SignalType as AlgoSignalType } from '../../../../algorithm/interfaces';
import { TradingSignal as AlgorithmTradingSignal } from '../../../../algorithm/interfaces/algorithm-result.interface';
import { TradingSignal } from '../types';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Stateless signal throttle filter layer.
 *
 * Sits between strategy signal generation and trade execution to:
 * 1. Enforce per-coin+direction cooldowns (prevent continuous-condition re-firing)
 * 2. Cap daily trade frequency (rolling 24h window)
 * 3. Floor sell percentages (prevent micro-sell fragmentation)
 *
 * Risk-control signals (STOP_LOSS, TAKE_PROFIT, SHORT_EXIT) bypass the daily
 * cap and the minimum-sell-percent floor. They check the per-coin+direction
 * cooldown ledger but callers do not invoke `markExecuted` on them, so they
 * do not write to that ledger themselves. In practice the cooldown only
 * blocks a bypass signal if a regular SELL/exit on the same coin+direction
 * was recently executed; when cooldown is enabled, consecutive bypass signals
 * on the same coin are deduplicated within a single batch by the transient
 * `Set`, but not across batches (and when `cooldownMs = 0` the dedup does not
 * run at all — duplicates are accepted by design). Engine-level guards
 * (held-coin / no-position checks) are responsible for preventing cross-batch
 * bypass spam.
 *
 * State is passed explicitly to support checkpoint/resume without service-level mutability.
 *
 * Acceptance vs. execution accounting: `filterSignals` does not write to the
 * persisted ledgers at all. Both the cooldown ledger (`lastSignalTime`) and
 * daily-cap window (`tradeTimestamps`) are deferred to `markExecuted`, which
 * the caller invokes once the trade has actually been placed. Within a single
 * batch, when cooldown is enabled `filterSignals` uses a transient `Set` to
 * dedupe same coin+direction signals so the first-passing one accepts and
 * the rest reject — but that dedup is discarded after the call (and skipped
 * entirely when `cooldownMs = 0`, since there is no cooldown semantic to
 * defend). This prevents downstream rejections (e.g. unresolved symbols,
 * insufficient funds, held-coin silent drops) from burning the daily cap or
 * sliding the cooldown forward.
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
  resolveConfig(
    params?: Record<string, unknown>,
    defaults: SignalThrottleConfig = DEFAULT_THROTTLE_CONFIG
  ): SignalThrottleConfig {
    const clamp = (val: unknown, fallback: number, min: number, max: number): number => {
      const n = typeof val === 'number' && isFinite(val) ? val : fallback;
      return Math.max(min, Math.min(max, n));
    };
    return {
      cooldownMs: clamp(params?.cooldownMs, defaults.cooldownMs, 0, 604_800_000),
      maxTradesPerDay: clamp(params?.maxTradesPerDay, defaults.maxTradesPerDay, 0, 50),
      minSellPercent: clamp(params?.minSellPercent, defaults.minSellPercent, 0, 1)
    };
  }

  /**
   * Filter an array of trading signals through throttle rules.
   * Prunes stale entries from `state`; does NOT stamp the cooldown ledger
   * (`lastSignalTime`) or daily-cap window (`tradeTimestamps`) for accepted
   * signals — callers must invoke `markExecuted` after the trade fills.
   *
   * @returns Accepted signals (possibly with adjusted percentage) and rejected signals (original refs).
   */
  filterSignals(
    signals: TradingSignal[],
    state: ThrottleState,
    config: SignalThrottleConfig,
    currentTimestampMs: number
  ): ThrottleResult {
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
    const rejected: TradingSignal[] = [];

    // When cooldown is enabled, tracks coin+direction keys accepted earlier
    // in this batch so duplicate signals within the same call reject all but
    // the first. When cooldown is 0 the engine accepts duplicates by design
    // (no cooldown semantics to defend). Discarded when filterSignals returns
    // — does NOT touch persistent state. Persistent cooldown stamps come from
    // `markExecuted` once a trade actually fills.
    const batchAccepted = new Set<CooldownKey>();

    for (const signal of signals) {
      if (signal.action === 'HOLD') {
        rejected.push(signal);
        continue;
      }

      // Risk-control signals bypass daily cap & min sell %, but respect cooldown
      if (signal.originalType && THROTTLE_BYPASS_TYPES.has(signal.originalType)) {
        if (config.cooldownMs > 0) {
          const direction = signal.action;
          const key: CooldownKey = `${signal.coinId}:${direction}`;
          const lastTime = state.lastSignalTime[key];
          if (lastTime !== undefined && currentTimestampMs - lastTime < config.cooldownMs) {
            rejected.push(signal);
            continue; // Duplicate risk-control signal — suppress
          }
          if (batchAccepted.has(key)) {
            rejected.push(signal);
            continue; // Duplicate within same batch — suppress
          }
          batchAccepted.add(key);
        }
        accepted.push(signal);
        continue;
      }

      const direction = signal.action;

      // Cooldown check
      if (config.cooldownMs > 0) {
        const key: CooldownKey = `${signal.coinId}:${direction}`;
        const lastTime = state.lastSignalTime[key];
        if (lastTime !== undefined && currentTimestampMs - lastTime < config.cooldownMs) {
          rejected.push(signal);
          continue; // Still in cooldown — suppress
        }
        if (batchAccepted.has(key)) {
          rejected.push(signal);
          continue; // Duplicate within same batch — suppress
        }
      }

      // Daily cap check
      if (config.maxTradesPerDay > 0 && state.tradeTimestamps.length >= config.maxTradesPerDay) {
        rejected.push(signal);
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

      // Track in-batch acceptance so subsequent same-key signals in this batch
      // reject. Persistent cooldown stamping is deferred to markExecuted() so
      // downstream rejections (held-coin drops, insufficient funds, etc.)
      // don't slide the cooldown forward.
      if (config.cooldownMs > 0) {
        const key: CooldownKey = `${signal.coinId}:${direction}`;
        batchAccepted.add(key);
      }

      accepted.push(effectiveSignal);
    }

    return { accepted, rejected };
  }

  /**
   * Mark a signal as actually executed. Stamps the cooldown ledger
   * (`lastSignalTime`) for the signal's coin+direction and appends to the
   * rolling 24h trade window (`tradeTimestamps`) used by the daily cap.
   * Call this only after the trade has been placed — signals that get
   * rejected downstream (unresolved symbol, insufficient funds, held-coin
   * silent drops, etc.) must NOT consume a cooldown slot or daily-cap slot.
   */
  markExecuted(state: ThrottleState, signal: TradingSignal, currentTimestampMs: number): void {
    // HOLD signals never reach execution (filterSignals rejects them) — guard
    // narrows the type so the cooldown key matches CooldownKey's contract.
    if (signal.action === 'HOLD') return;
    const key: CooldownKey = `${signal.coinId}:${signal.action}`;
    state.lastSignalTime[key] = currentTimestampMs;
    state.tradeTimestamps.push(currentTimestampMs);
  }

  /**
   * Higher-level wrapper used by live execution paths after an order is successfully placed.
   * Encapsulates the null-state guard, bypass-type guard, and algorithm→throttle conversion
   * so callers (strategy-executor, trade-signal-generator) don't duplicate the boilerplate.
   *
   * Returns true if the ledger was stamped, false if any guard short-circuited.
   */
  markExecutedFromAlgo(
    state: ThrottleState | undefined,
    signalType: AlgoSignalType | undefined,
    coinId: string | undefined,
    currentTimestampMs: number
  ): boolean {
    if (!state || !signalType || !coinId) return false;
    if (THROTTLE_BYPASS_TYPES.has(signalType)) return false;
    const action = SIGNAL_TYPE_TO_ACTION[signalType];
    if (!action || action === 'HOLD') return false;
    this.markExecuted(state, { action, coinId, reason: '' }, currentTimestampMs);
    return true;
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

  /** Convert an algorithm signal to the backtest TradingSignal format expected by filterSignals() */
  toThrottleSignal(signal: AlgorithmTradingSignal): TradingSignal {
    return {
      action: SIGNAL_TYPE_TO_ACTION[signal.type] ?? 'HOLD',
      coinId: signal.coinId,
      quantity: signal.quantity,
      reason: signal.reason,
      confidence: signal.confidence,
      originalType: signal.type,
      exitConfig: signal.exitConfig
    };
  }
}
