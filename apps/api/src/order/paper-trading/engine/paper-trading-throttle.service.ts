import { Injectable } from '@nestjs/common';

import { TradingSignal } from './paper-trading-engine.utils';

import {
  SerializableThrottleState,
  SignalThrottleConfig,
  SignalThrottleService,
  ThrottleState
} from '../../backtest/shared';

/**
 * Owns per-session throttle state for the paper trading engine.
 *
 * Wraps the shared `SignalThrottleService` with a session-keyed `Map` so the
 * engine does not need to track throttle lifecycles directly.
 */
@Injectable()
export class PaperTradingThrottleService {
  private readonly throttleStates = new Map<string, ThrottleState>();

  constructor(private readonly signalThrottle: SignalThrottleService) {}

  /** Get-or-create throttle state for a session. */
  getOrCreate(sessionId: string): ThrottleState {
    let state = this.throttleStates.get(sessionId);
    if (!state) {
      state = this.signalThrottle.createState();
      this.throttleStates.set(sessionId, state);
    }
    return state;
  }

  /** Clean up throttle state when a session ends. */
  clear(sessionId: string): void {
    this.throttleStates.delete(sessionId);
  }

  /** Check if in-memory throttle state exists for a session. */
  has(sessionId: string): boolean {
    return this.throttleStates.has(sessionId);
  }

  /** Restore throttle state from a previously serialized form (e.g. from DB). */
  restore(sessionId: string, serialized: SerializableThrottleState): void {
    if (this.throttleStates.has(sessionId)) return;
    const state = this.signalThrottle.deserialize(serialized);
    this.throttleStates.set(sessionId, state);
  }

  /** Serialize current throttle state for DB persistence. */
  getSerialized(sessionId: string): SerializableThrottleState | undefined {
    const state = this.throttleStates.get(sessionId);
    if (!state) return undefined;
    return this.signalThrottle.serialize(state);
  }

  /**
   * Filter signals through the throttle for the given session, get-or-creating
   * its state as needed. Mirrors `SignalThrottleService.filterSignals`.
   */
  filter(
    sessionId: string,
    signals: TradingSignal[],
    config: SignalThrottleConfig,
    now: number
  ): { accepted: TradingSignal[]; rejected: TradingSignal[] } {
    const state = this.getOrCreate(sessionId);
    return this.signalThrottle.filterSignals(signals, state, config, now) as {
      accepted: TradingSignal[];
      rejected: TradingSignal[];
    };
  }

  /**
   * Sweep state for sessions no longer in the active set. Returns number of
   * entries removed. Used by the engine's orphaned-state sweeper.
   */
  sweepOrphaned(activeSessionIds: Set<string>): number {
    let swept = 0;
    for (const sessionId of this.throttleStates.keys()) {
      if (!activeSessionIds.has(sessionId)) {
        this.throttleStates.delete(sessionId);
        swept++;
      }
    }
    return swept;
  }
}
