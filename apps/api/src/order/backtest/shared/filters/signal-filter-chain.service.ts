import { Injectable } from '@nestjs/common';

import { ConcentrationFilter } from './concentration-filter';
import { RegimeFilter } from './regime-filter';
import {
  FilterableSignal,
  SignalFilter,
  SignalFilterContext,
  SignalFilterResult
} from './signal-filter-chain.interface';

/**
 * Runs an ordered array of SignalFilter steps.
 *
 * Default chain: [RegimeFilter].
 * Future filters (drawdown circuit breaker, correlation, etc.) can be appended.
 *
 * No async, no allocations beyond Array.filter() — safe for hot-path.
 */
@Injectable()
export class SignalFilterChainService {
  private readonly filters: SignalFilter[];

  constructor() {
    this.filters = [new RegimeFilter(), new ConcentrationFilter()];
  }

  apply<T extends FilterableSignal>(
    signals: T[],
    context: SignalFilterContext,
    allocation: { maxAllocation: number; minAllocation: number }
  ): SignalFilterResult<T> {
    let current: SignalFilterResult<T> = {
      signals,
      maxAllocation: allocation.maxAllocation,
      minAllocation: allocation.minAllocation,
      regimeGateBlockedCount: 0,
      regimeMultiplier: 1
    };

    for (const filter of this.filters) {
      const result = filter.apply(current.signals, context, {
        maxAllocation: current.maxAllocation,
        minAllocation: current.minAllocation
      });

      current = {
        signals: result.signals,
        maxAllocation: result.maxAllocation,
        minAllocation: result.minAllocation,
        regimeGateBlockedCount: current.regimeGateBlockedCount + result.regimeGateBlockedCount,
        regimeMultiplier: result.regimeMultiplier !== 1 ? result.regimeMultiplier : current.regimeMultiplier
      };
    }

    return current;
  }
}
