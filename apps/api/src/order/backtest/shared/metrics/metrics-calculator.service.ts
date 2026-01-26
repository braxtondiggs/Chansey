import { Injectable } from '@nestjs/common';

import {
  DEFAULT_METRICS_CONFIG,
  getPeriodsPerYear,
  IMetricsCalculator,
  MetricsConfig,
  MetricsInput,
  MetricsResult,
  TradeMetrics
} from './metrics-calculator.interface';

import { DrawdownCalculator } from '../../../../common/metrics/drawdown.calculator';
import { SharpeRatioCalculator } from '../../../../common/metrics/sharpe-ratio.calculator';

/**
 * Metrics Calculator Service
 *
 * Provides comprehensive performance metrics calculation for backtesting.
 * Integrates with existing SharpeRatioCalculator and DrawdownCalculator
 * while adding proper timeframe awareness for annualization.
 *
 * Key improvements over inline calculations:
 * - Proper timeframe awareness (hourly vs daily vs weekly)
 * - Consistent annualization across all metrics
 * - Correct downside deviation calculation for Sortino
 *
 * @example
 * ```typescript
 * const metrics = metricsCalculator.calculateMetrics({
 *   portfolioValues: [10000, 10500, 10200, 11000],
 *   initialCapital: 10000,
 *   trades: sellTrades
 * }, {
 *   timeframe: TimeframeType.DAILY,
 *   useCryptoCalendar: true
 * });
 * ```
 */
@Injectable()
export class MetricsCalculatorService implements IMetricsCalculator {
  constructor(
    private readonly sharpeCalculator: SharpeRatioCalculator,
    private readonly drawdownCalculator: DrawdownCalculator
  ) {}

  /**
   * Calculate all performance metrics from portfolio values and trades
   */
  calculateMetrics(input: MetricsInput, config: MetricsConfig = DEFAULT_METRICS_CONFIG): MetricsResult {
    const { portfolioValues, initialCapital, trades = [] } = input;

    if (portfolioValues.length === 0) {
      return this.getEmptyMetrics(initialCapital);
    }

    // Calculate returns from portfolio values
    const returns = this.calculateReturns(portfolioValues);

    // Get annualization factor
    const periodsPerYear = getPeriodsPerYear(config.timeframe, config.useCryptoCalendar);

    // Calculate individual metrics
    const sharpeRatio = this.calculateSharpeRatio(returns, config);
    const sortinoRatio = this.calculateSortinoRatio(returns, config);
    const maxDrawdown = this.calculateMaxDrawdown(portfolioValues);
    const volatility = this.calculateVolatility(returns, config);
    const downsideDeviation = this.calculateDownsideDeviation(returns, config);

    // Trade-based metrics (methods handle SELL filtering internally)
    const winRate = this.calculateWinRate(trades);
    const profitFactor = this.calculateProfitFactor(trades);
    const sellTrades = trades.filter((t) => t.type === 'SELL');

    // Return metrics
    const finalValue = portfolioValues[portfolioValues.length - 1];
    const totalReturn = (finalValue - initialCapital) / initialCapital;

    // Annualized return
    const durationPeriods = portfolioValues.length - 1;
    const annualizedReturn =
      durationPeriods > 0 ? Math.pow(1 + totalReturn, periodsPerYear / durationPeriods) - 1 : totalReturn;

    return {
      sharpeRatio,
      sortinoRatio,
      maxDrawdown,
      winRate,
      profitFactor,
      volatility,
      downsideDeviation,
      totalReturn,
      annualizedReturn,
      totalTrades: trades.length,
      winningTrades: sellTrades.filter((t) => t.realizedPnL > 0).length,
      finalValue
    };
  }

  /**
   * Calculate Sharpe ratio using centralized calculator
   */
  calculateSharpeRatio(returns: number[], config: MetricsConfig = DEFAULT_METRICS_CONFIG): number {
    if (returns.length === 0) return 0;

    const periodsPerYear = getPeriodsPerYear(config.timeframe, config.useCryptoCalendar);
    const riskFreeRate = config.riskFreeRate ?? DEFAULT_METRICS_CONFIG.riskFreeRate ?? 0.02;

    return this.sharpeCalculator.calculate(returns, riskFreeRate, periodsPerYear);
  }

  /**
   * Calculate Sortino ratio using centralized calculator
   */
  calculateSortinoRatio(returns: number[], config: MetricsConfig = DEFAULT_METRICS_CONFIG): number {
    if (returns.length === 0) return 0;

    const periodsPerYear = getPeriodsPerYear(config.timeframe, config.useCryptoCalendar);
    const riskFreeRate = config.riskFreeRate ?? DEFAULT_METRICS_CONFIG.riskFreeRate ?? 0.02;

    return this.sharpeCalculator.calculateSortino(returns, riskFreeRate, periodsPerYear);
  }

  /**
   * Calculate maximum drawdown using centralized calculator
   */
  calculateMaxDrawdown(portfolioValues: number[]): number {
    if (portfolioValues.length === 0) return 0;

    const result = this.drawdownCalculator.calculateMaxDrawdown(portfolioValues);
    return result.maxDrawdownPercentage / 100; // Convert from percentage to decimal
  }

  /**
   * Calculate win rate from trades
   * Win rate = winning SELL trades / total SELL trades
   * Automatically filters for SELL trades (only SELL trades have realized P&L)
   */
  calculateWinRate(trades: TradeMetrics[]): number {
    const sellTrades = trades.filter((t) => t.type === 'SELL');
    if (sellTrades.length === 0) return 0;

    const winningTrades = sellTrades.filter((t) => t.realizedPnL > 0).length;
    return winningTrades / sellTrades.length;
  }

  /**
   * Calculate profit factor from trades
   * Profit Factor = Gross Profit / Gross Loss
   * Automatically filters for SELL trades (only SELL trades have realized P&L)
   */
  calculateProfitFactor(trades: TradeMetrics[]): number {
    const sellTrades = trades.filter((t) => t.type === 'SELL');

    const grossProfit = sellTrades.filter((t) => t.realizedPnL > 0).reduce((sum, t) => sum + t.realizedPnL, 0);

    const grossLoss = Math.abs(sellTrades.filter((t) => t.realizedPnL < 0).reduce((sum, t) => sum + t.realizedPnL, 0));

    if (grossLoss === 0) {
      return grossProfit > 0 ? Infinity : 1;
    }

    return grossProfit / grossLoss;
  }

  /**
   * Calculate annualized volatility
   */
  calculateVolatility(returns: number[], config: MetricsConfig = DEFAULT_METRICS_CONFIG): number {
    if (returns.length === 0) return 0;

    const periodsPerYear = getPeriodsPerYear(config.timeframe, config.useCryptoCalendar);

    // Calculate mean return
    const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

    // Calculate variance
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;

    // Return annualized volatility
    return Math.sqrt(variance) * Math.sqrt(periodsPerYear);
  }

  /**
   * Calculate annualized downside deviation
   * Uses same formula as SharpeRatioCalculator.calculateSortino for consistency
   */
  calculateDownsideDeviation(returns: number[], config: MetricsConfig = DEFAULT_METRICS_CONFIG): number {
    if (returns.length === 0) return 0;

    const periodsPerYear = getPeriodsPerYear(config.timeframe, config.useCryptoCalendar);
    const riskFreeRate = config.riskFreeRate ?? DEFAULT_METRICS_CONFIG.riskFreeRate ?? 0.02;
    const periodRiskFreeRate = riskFreeRate / periodsPerYear;

    // Filter to downside returns (below risk-free rate)
    const downsideReturns = returns.filter((r) => r < periodRiskFreeRate);

    if (downsideReturns.length === 0) return 0;

    // Calculate downside variance using full sample size (consistent with SharpeRatioCalculator)
    const downsideVariance =
      downsideReturns.reduce((sum, r) => sum + Math.pow(r - periodRiskFreeRate, 2), 0) / returns.length;

    // Return annualized downside deviation
    return Math.sqrt(downsideVariance) * Math.sqrt(periodsPerYear);
  }

  /**
   * Convert portfolio values to period returns
   */
  calculateReturns(portfolioValues: number[]): number[] {
    if (portfolioValues.length < 2) return [];

    const returns: number[] = [];
    for (let i = 1; i < portfolioValues.length; i++) {
      const previous = portfolioValues[i - 1];
      const current = portfolioValues[i];
      returns.push(previous === 0 ? 0 : (current - previous) / previous);
    }

    return returns;
  }

  /**
   * Return empty metrics when no data available
   */
  private getEmptyMetrics(initialCapital: number): MetricsResult {
    return {
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdown: 0,
      winRate: 0,
      profitFactor: 1,
      volatility: 0,
      downsideDeviation: 0,
      totalReturn: 0,
      annualizedReturn: 0,
      totalTrades: 0,
      winningTrades: 0,
      finalValue: initialCapital
    };
  }
}
