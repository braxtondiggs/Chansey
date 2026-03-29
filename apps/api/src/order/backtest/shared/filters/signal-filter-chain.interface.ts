import { CompositeRegimeType } from '@chansey/api-interfaces';

export type TradingContext = 'paper' | 'backtest' | 'live';

/**
 * Minimal signal shape satisfied by both backtest and paper trading engines.
 */
export interface FilterableSignal {
  action: string;
  originalType?: string;
  coinId?: string;
}

/**
 * Per-bar/tick context passed to the filter chain.
 * Engine-agnostic — regime is pre-computed by the caller.
 */
export interface SignalFilterContext {
  compositeRegime: CompositeRegimeType;
  riskLevel: number;
  regimeGateEnabled: boolean;
  regimeScaledSizingEnabled: boolean;
  tradingContext?: TradingContext;
  overrideActive?: boolean;
  concentrationContext?: {
    portfolioPositions: Map<string, { quantity: number; averagePrice: number }>;
    portfolioTotalValue: number;
    currentPrices?: Map<string, number>;
  };
}

/**
 * Output of the filter chain.
 */
export interface SignalFilterResult<T extends FilterableSignal> {
  signals: T[];
  maxAllocation: number;
  minAllocation: number;
  regimeGateBlockedCount: number;
  regimeMultiplier: number;
}

/**
 * Composable filter step interface.
 * Each filter receives the current signal list, context, and allocation limits,
 * and returns a potentially reduced signal list with adjusted allocations.
 */
export interface SignalFilter {
  apply<T extends FilterableSignal>(
    signals: T[],
    context: SignalFilterContext,
    allocation: { maxAllocation: number; minAllocation: number }
  ): SignalFilterResult<T>;
}
