import { Injectable } from '@nestjs/common';

import {
  classifyCompositeRegime,
  CompositeRegimeType,
  MarketRegimeType,
  RegimeGateDecision
} from '@chansey/api-interfaces';

/**
 * Stateless signal filter based on composite regime.
 * Reusable by both live trading and backtest paths.
 *
 * Gate policy:
 *  - BULL / NEUTRAL: all signals allowed
 *  - BEAR / EXTREME: block BUY, allow SELL / STOP_LOSS / TAKE_PROFIT
 */
@Injectable()
export class RegimeGateService {
  /**
   * Filter a single live trading signal.
   * @param signalAction  'buy' | 'sell' | 'hold' (live path uses lowercase)
   * @param compositeRegime current composite regime
   * @param overrideActive  whether admin override is enabled
   * @param volatilityRegime actual volatility regime from composite service
   * @param trendAboveSma actual BTC trend flag from composite service
   */
  filterLiveSignal(
    signalAction: string,
    compositeRegime: CompositeRegimeType,
    overrideActive: boolean,
    volatilityRegime: MarketRegimeType,
    trendAboveSma: boolean
  ): RegimeGateDecision {
    const now = new Date();

    if (overrideActive) {
      return {
        allowed: true,
        compositeRegime,
        volatilityRegime,
        trendAboveSma,
        signalAction,
        reason: 'Manual override active — all signals allowed',
        timestamp: now
      };
    }

    const blocked = this.isBuyBlocked(compositeRegime, signalAction);

    return {
      allowed: !blocked,
      compositeRegime,
      volatilityRegime,
      trendAboveSma,
      signalAction,
      reason: blocked ? `BUY blocked in ${compositeRegime} regime` : `Signal allowed in ${compositeRegime} regime`,
      timestamp: now
    };
  }

  /**
   * Filter an array of backtest signals in-place.
   * Returns only the signals that pass the gate.
   *
   * @param signals Array of backtest trading signals with `action` and optional `originalType`
   * @param compositeRegime current composite regime for this timestamp
   */
  filterBacktestSignals<T extends { action: string; originalType?: string }>(
    signals: T[],
    compositeRegime: CompositeRegimeType
  ): T[] {
    return signals.filter((signal) => !this.isBuyBlocked(compositeRegime, signal.action, signal.originalType));
  }

  /**
   * Pure classification function for use in backtest inline calculations.
   * Delegates to shared utility.
   */
  classifyComposite(volatilityRegime: MarketRegimeType, trendAboveSma: boolean): CompositeRegimeType {
    return classifyCompositeRegime(volatilityRegime, trendAboveSma);
  }

  /**
   * Determines if a BUY signal should be blocked.
   * Risk-control signals (STOP_LOSS, TAKE_PROFIT) always bypass the gate.
   */
  private isBuyBlocked(compositeRegime: CompositeRegimeType, action: string, originalType?: string): boolean {
    // Risk-control signals always pass
    if (originalType === 'STOP_LOSS' || originalType === 'TAKE_PROFIT') {
      return false;
    }

    // Only block BUY in bearish regimes
    const isBuy = action.toUpperCase() === 'BUY';
    if (!isBuy) return false;

    return compositeRegime === CompositeRegimeType.BEAR || compositeRegime === CompositeRegimeType.EXTREME;
  }
}
