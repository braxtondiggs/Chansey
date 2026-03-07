import {
  FilterableSignal,
  SignalFilter,
  SignalFilterContext,
  SignalFilterResult
} from './signal-filter-chain.interface';

import { CONCENTRATION_LIMITS } from '../../../../strategy/risk/concentration.constants';

/**
 * Pure stateless concentration filter for backtests.
 *
 * Blocks BUY signals when an asset's current concentration >= hard limit.
 * Adjusts maxAllocation downward when any position exceeds the soft limit.
 *
 * No-op passthrough if concentrationContext is absent.
 */
export class ConcentrationFilter implements SignalFilter {
  apply<T extends FilterableSignal>(
    signals: T[],
    context: SignalFilterContext,
    allocation: { maxAllocation: number; minAllocation: number }
  ): SignalFilterResult<T> {
    let { maxAllocation } = allocation;
    const { minAllocation } = allocation;

    if (!context.concentrationContext || signals.length === 0) {
      return {
        signals,
        maxAllocation,
        minAllocation,
        regimeGateBlockedCount: 0,
        regimeMultiplier: 1
      };
    }

    const { portfolioPositions, portfolioTotalValue, currentPrices } = context.concentrationContext;
    const limits = CONCENTRATION_LIMITS[context.riskLevel] ?? CONCENTRATION_LIMITS[3];

    if (portfolioTotalValue <= 0) {
      return {
        signals,
        maxAllocation,
        minAllocation,
        regimeGateBlockedCount: 0,
        regimeMultiplier: 1
      };
    }

    // Calculate position values and check for soft limit exceedances
    let adjustedMax = maxAllocation;

    for (const [coinId, position] of portfolioPositions) {
      const price = currentPrices?.get(coinId) ?? position.averagePrice;
      const positionValue = position.quantity * price;
      const concentration = positionValue / portfolioTotalValue;

      if (concentration > limits.soft) {
        const cap = limits.hard - concentration;
        if (cap > 0) {
          adjustedMax = Math.min(adjustedMax, cap);
        }
      }
    }

    maxAllocation = adjustedMax;

    // Filter BUY signals for assets already at hard limit
    const filtered = signals.filter((signal) => {
      const action = signal.action.toUpperCase();
      if (action !== 'BUY') return true;

      const coinId = signal.coinId;
      if (!coinId) return true;

      const position = portfolioPositions.get(coinId);
      if (!position) return true;

      const price = currentPrices?.get(coinId) ?? position.averagePrice;
      const positionValue = position.quantity * price;
      const concentration = positionValue / portfolioTotalValue;

      return concentration < limits.hard;
    });

    return {
      signals: filtered,
      maxAllocation,
      minAllocation,
      regimeGateBlockedCount: 0,
      regimeMultiplier: 1
    };
  }
}
