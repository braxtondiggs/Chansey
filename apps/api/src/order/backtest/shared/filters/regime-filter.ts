import { CompositeRegimeType, getRegimeMultiplier } from '@chansey/api-interfaces';

import {
  FilterableSignal,
  SignalFilter,
  SignalFilterContext,
  SignalFilterResult
} from './signal-filter-chain.interface';

/**
 * Pure stateless regime filter.
 *
 * Gate policy:
 *  - BULL / NEUTRAL: all signals allowed
 *  - BEAR / EXTREME: block BUY, allow SELL / STOP_LOSS / TAKE_PROFIT
 *
 * Sizing policy:
 *  - Applies regime multiplier to allocation limits based on risk level
 */
export class RegimeFilter implements SignalFilter {
  apply<T extends FilterableSignal>(
    signals: T[],
    context: SignalFilterContext,
    allocation: { maxAllocation: number; minAllocation: number }
  ): SignalFilterResult<T> {
    let filtered = signals;
    let blockedCount = 0;
    let regimeMultiplier = 1;

    // Gate: block BUY in bearish regimes
    if (context.regimeGateEnabled) {
      const before = filtered.length;
      filtered = filtered.filter((s) => !this.isBuyBlocked(context.compositeRegime, s.action, s.originalType));
      blockedCount = before - filtered.length;
    }

    // Sizing: apply regime multiplier to allocation limits
    let { maxAllocation, minAllocation } = allocation;
    if (context.regimeScaledSizingEnabled) {
      regimeMultiplier = getRegimeMultiplier(context.riskLevel, context.compositeRegime);
      maxAllocation *= regimeMultiplier;
      minAllocation *= regimeMultiplier;
    }

    return {
      signals: filtered,
      maxAllocation,
      minAllocation,
      regimeGateBlockedCount: blockedCount,
      regimeMultiplier
    };
  }

  /**
   * Determines if a BUY signal should be blocked.
   * Risk-control signals (STOP_LOSS, TAKE_PROFIT) always bypass the gate.
   */
  private isBuyBlocked(compositeRegime: CompositeRegimeType, action: string, originalType?: string): boolean {
    if (originalType === 'STOP_LOSS' || originalType === 'TAKE_PROFIT') {
      return false;
    }

    const isBuy = action.toUpperCase() === 'BUY';
    if (!isBuy) return false;

    return compositeRegime === CompositeRegimeType.BEAR || compositeRegime === CompositeRegimeType.EXTREME;
  }
}
