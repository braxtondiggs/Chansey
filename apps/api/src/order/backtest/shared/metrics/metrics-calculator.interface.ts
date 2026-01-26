/**
 * Metrics Calculator Interfaces
 *
 * Provides comprehensive performance metrics calculation for backtesting
 * with proper timeframe awareness for annualization.
 */

/**
 * Timeframe type for return calculations
 * Determines the annualization factor for metrics
 */
export enum TimeframeType {
  /** Hourly data: 8760 periods/year (24 * 365 for crypto 24/7 markets) */
  HOURLY = 'hourly',
  /** Daily data: 365 for crypto (24/7), 252 for traditional markets */
  DAILY = 'daily',
  /** Weekly data: 52 periods/year */
  WEEKLY = 'weekly',
  /** Monthly data: 12 periods/year */
  MONTHLY = 'monthly'
}

/**
 * Configuration for metrics calculation
 */
export interface MetricsConfig {
  /** Timeframe of the return data */
  timeframe: TimeframeType;
  /** Annual risk-free rate as decimal (default: 0.02 = 2%) */
  riskFreeRate?: number;
  /** Whether to use 365 days (crypto) or 252 days (traditional) for daily data */
  useCryptoCalendar?: boolean;
}

/**
 * Input data for metrics calculation
 */
export interface MetricsInput {
  /** Array of portfolio values over time */
  portfolioValues: number[];
  /** Initial capital (for total return calculation) */
  initialCapital: number;
  /** Array of completed trades for win rate and profit factor */
  trades?: TradeMetrics[];
  /** Peak portfolio value (for drawdown verification) */
  peakValue?: number;
}

/**
 * Trade data needed for metrics calculation
 */
export interface TradeMetrics {
  /** Realized P&L for the trade */
  realizedPnL: number;
  /** Trade type: 'BUY' or 'SELL' */
  type: 'BUY' | 'SELL';
}

/**
 * Complete metrics result
 */
export interface MetricsResult {
  /** Sharpe ratio (risk-adjusted return) */
  sharpeRatio: number;
  /** Sortino ratio (downside risk-adjusted return) */
  sortinoRatio: number;
  /** Maximum drawdown as decimal (e.g., 0.15 = 15%) */
  maxDrawdown: number;
  /** Win rate as decimal (e.g., 0.6 = 60%) */
  winRate: number;
  /** Profit factor (gross profit / gross loss) */
  profitFactor: number;
  /** Annualized volatility as decimal */
  volatility: number;
  /** Downside deviation (for Sortino ratio) */
  downsideDeviation: number;
  /** Total return as decimal (e.g., 0.25 = 25%) */
  totalReturn: number;
  /** Annualized return as decimal */
  annualizedReturn: number;
  /** Total number of trades */
  totalTrades: number;
  /** Number of winning trades */
  winningTrades: number;
  /** Final portfolio value */
  finalValue: number;
}

/**
 * Default metrics configuration
 */
export const DEFAULT_METRICS_CONFIG: MetricsConfig = {
  timeframe: TimeframeType.DAILY,
  riskFreeRate: 0.02,
  useCryptoCalendar: true
};

/**
 * Get periods per year based on timeframe and calendar type
 */
export function getPeriodsPerYear(timeframe: TimeframeType, useCryptoCalendar = true): number {
  switch (timeframe) {
    case TimeframeType.HOURLY:
      return useCryptoCalendar ? 8760 : 6552; // 24*365 or 24*252+24*21 (approx)
    case TimeframeType.DAILY:
      return useCryptoCalendar ? 365 : 252;
    case TimeframeType.WEEKLY:
      return 52;
    case TimeframeType.MONTHLY:
      return 12;
    default:
      return 252;
  }
}

/**
 * Metrics calculator service interface
 */
export interface IMetricsCalculator {
  /**
   * Calculate all performance metrics from portfolio values and trades
   * @param input Portfolio values and trade data
   * @param config Metrics configuration
   * @returns Complete MetricsResult
   */
  calculateMetrics(input: MetricsInput, config?: MetricsConfig): MetricsResult;

  /**
   * Calculate Sharpe ratio from returns
   * @param returns Array of period returns
   * @param config Metrics configuration
   * @returns Sharpe ratio
   */
  calculateSharpeRatio(returns: number[], config?: MetricsConfig): number;

  /**
   * Calculate Sortino ratio from returns
   * @param returns Array of period returns
   * @param config Metrics configuration
   * @returns Sortino ratio
   */
  calculateSortinoRatio(returns: number[], config?: MetricsConfig): number;

  /**
   * Calculate maximum drawdown from portfolio values
   * @param portfolioValues Array of portfolio values
   * @returns Maximum drawdown as decimal
   */
  calculateMaxDrawdown(portfolioValues: number[]): number;

  /**
   * Calculate win rate from trades
   * @param trades Array of trades with P&L
   * @returns Win rate as decimal
   */
  calculateWinRate(trades: TradeMetrics[]): number;

  /**
   * Calculate profit factor from trades
   * @param trades Array of trades with P&L
   * @returns Profit factor (gross profit / gross loss)
   */
  calculateProfitFactor(trades: TradeMetrics[]): number;

  /**
   * Calculate volatility (standard deviation of returns)
   * @param returns Array of period returns
   * @param config Metrics configuration
   * @returns Annualized volatility
   */
  calculateVolatility(returns: number[], config?: MetricsConfig): number;

  /**
   * Calculate downside deviation (standard deviation of negative returns)
   * @param returns Array of period returns
   * @param config Metrics configuration
   * @returns Annualized downside deviation
   */
  calculateDownsideDeviation(returns: number[], config?: MetricsConfig): number;

  /**
   * Convert portfolio values to period returns
   * @param portfolioValues Array of portfolio values
   * @returns Array of period returns
   */
  calculateReturns(portfolioValues: number[]): number[];
}
