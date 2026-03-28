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
 * Gate policy (context-aware):
 *  - PAPER: never gate — multiplier matrix handles position sizing
 *  - BACKTEST: caller-controlled via `regimeGateEnabled`
 *  - LIVE risk 1-2: gate in BEAR + EXTREME
 *  - LIVE risk 3+: gate only in EXTREME
 *  - BULL / NEUTRAL: always allow (regardless of context)
 *  - No tradingContext: falls back to legacy `regimeGateEnabled` boolean
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

    // Gate: block BUY in bearish regimes (context-aware policy)
    if (this.shouldApplyGate(context)) {
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
   * Determines whether the regime gate should apply based on trading context and risk level.
   */
  private shouldApplyGate(context: SignalFilterContext): boolean {
    const { tradingContext, regimeGateEnabled, riskLevel, compositeRegime, overrideActive } = context;

    // Admin override bypasses gate entirely
    if (overrideActive) return false;

    // No tradingContext → fall back to legacy boolean (checkpoint compat)
    if (!tradingContext) return regimeGateEnabled;

    // Paper: never gate — multiplier matrix handles sizing
    if (tradingContext === 'paper') return false;

    // Backtest: caller controls via regimeGateEnabled
    if (tradingContext === 'backtest') return regimeGateEnabled;

    // Live: risk-level dependent
    // Risk 1-2: gate in BEAR and EXTREME
    if (riskLevel <= 2) {
      return compositeRegime === CompositeRegimeType.BEAR || compositeRegime === CompositeRegimeType.EXTREME;
    }
    // Risk 3+: gate only in EXTREME
    return compositeRegime === CompositeRegimeType.EXTREME;
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
