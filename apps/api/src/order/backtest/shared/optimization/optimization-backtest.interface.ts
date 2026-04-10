import { type OHLCCandle, type PriceSummary } from '../../../../ohlc/ohlc-candle.entity';
import { type ExitConfig } from '../../../interfaces/exit-config.interface';
import { type SlippageConfig } from '../slippage';

/**
 * Configuration for running an optimization backtest
 */
export interface OptimizationBacktestConfig {
  algorithmId: string;
  parameters: Record<string, unknown>;
  startDate: Date;
  endDate: Date;
  initialCapital?: number;
  tradingFee?: number;
  coinIds?: string[];
  /** Hard stop-loss threshold as a fraction (0-1). Default: 0.05 (5%) */
  hardStopLossPercent?: number;
  /** Maximum allocation per trade as fraction of portfolio (0-1). Overrides stage/risk defaults. */
  maxAllocation?: number;
  /** Minimum allocation per trade as fraction of portfolio (0-1). Overrides stage/risk defaults. */
  minAllocation?: number;
  /** User risk level (1-5) for allocation limit lookup. Default: 3 */
  riskLevel?: number;
  /** Optional slippage config. Defaults to DEFAULT_SLIPPAGE_CONFIG (fixed 5 bps). */
  slippage?: SlippageConfig;
  /** Exit configuration for SL/TP/trailing stop simulation (overrides legacy hard stop-loss) */
  exitConfig?: ExitConfig;
  /** Enable composite regime gate filtering. Default: derived from riskLevel (ON for risk ≤ 2, OFF for risk ≥ 3). */
  enableRegimeGate?: boolean;
  /** Enable regime-scaled position sizing (default: true) */
  enableRegimeScaledSizing?: boolean;
  /** Market type: 'spot' (default) or 'futures' */
  marketType?: string;
  /** Leverage multiplier for futures trading (default: 1) */
  leverage?: number;
}

/**
 * Result metrics from an optimization backtest
 */
export interface OptimizationBacktestResult {
  sharpeRatio: number;
  totalReturn: number;
  maxDrawdown: number;
  winRate: number;
  volatility: number;
  profitFactor: number;
  tradeCount: number;
  annualizedReturn?: number;
  finalValue?: number;
  /** Downside deviation for Sortino ratio calculation (standard deviation of negative returns only) */
  downsideDeviation?: number;
}

/**
 * Cacheable (immutable) portion of PriceTrackingContext.
 * Safe to share across multiple optimization combo runs hitting the same date window.
 */
export interface ImmutablePriceTrackingData {
  timestampsByCoin: Map<string, Date[]>;
  summariesByCoin: Map<string, PriceSummary[]>;
}

/**
 * Pre-computed data for a single optimization window (date range).
 * Built once per unique date range, reused across all parameter combinations.
 */
export interface PrecomputedWindowData {
  pricesByTimestamp: Record<string, OHLCCandle[]>;
  timestamps: string[];
  immutablePriceData: ImmutablePriceTrackingData;
  volumeMap: Map<string, number>;
  filteredCandles: OHLCCandle[];
  /** Index in timestamps[] where actual trading begins (after warm-up period).
   *  Indicators are computed on the full range including warm-up, but trades
   *  are only executed at and after this index. Defaults to 0 (no warm-up). */
  tradingStartIndex: number;
}
