/**
 * Optimization metrics utility.
 *
 * Uses native floats intentionally (not Decimal.js) for performance —
 * optimization runs execute thousands of backtests in tight loops.
 * The precision loss is negligible for comparative metric ranking.
 */

import * as dayjs from 'dayjs';

import { OptimizationBacktestResult } from './optimization-backtest.interface';

import { BacktestTrade, TradeType } from '../../backtest-trade.entity';
import { MetricsCalculatorService, TimeframeType } from '../metrics';

/**
 * Calculate final metrics for an optimization backtest run.
 * Pure function — only depends on the passed-in metricsCalculator for Sharpe ratio.
 */
export function calculateOptimizationMetrics(
  trades: Partial<BacktestTrade>[],
  snapshots: { portfolioValue: number; timestamp: Date }[],
  finalPortfolioValue: number,
  maxDrawdown: number,
  initialCapital: number,
  startDate: Date,
  endDate: Date,
  metricsCalculator: MetricsCalculatorService
): OptimizationBacktestResult {
  const finalValue = finalPortfolioValue;
  const totalReturn = (finalValue - initialCapital) / initialCapital;
  const totalTrades = trades.length;

  const sellTrades = trades.filter((t) => t.type === TradeType.SELL);
  const winningTrades = sellTrades.filter((t) => (t.realizedPnL ?? 0) > 0).length;
  const sellTradeCount = sellTrades.length;
  const winRate = sellTradeCount > 0 ? winningTrades / sellTradeCount : 0;

  const durationDays = dayjs(endDate).diff(dayjs(startDate), 'day');
  const annualizedReturn = durationDays > 0 ? Math.pow(1 + totalReturn, 365 / durationDays) - 1 : totalReturn;

  const returns: number[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const previous = snapshots[i - 1].portfolioValue;
    const current = snapshots[i].portfolioValue;
    returns.push(previous === 0 ? 0 : (current - previous) / previous);
  }

  const avgReturn = returns.length > 0 ? returns.reduce((sum, r) => sum + r, 0) / returns.length : 0;
  const variance =
    returns.length > 0 ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length : 0;
  const volatility = Math.sqrt(variance) * Math.sqrt(365);

  const periodRiskFreeRate = 0.02 / 365;
  const downsideReturns = returns.filter((r) => r < periodRiskFreeRate);
  const downsideVariance =
    returns.length > 0
      ? downsideReturns.reduce((sum, r) => sum + Math.pow(r - periodRiskFreeRate, 2), 0) / returns.length
      : 0;
  const downsideDeviation = Math.sqrt(downsideVariance) * Math.sqrt(365);

  const sharpeRatio = metricsCalculator.calculateSharpeRatio(returns, {
    timeframe: TimeframeType.DAILY,
    useCryptoCalendar: true,
    riskFreeRate: 0.02
  });

  const grossProfit = sellTrades
    .filter((t) => (t.realizedPnL ?? 0) > 0)
    .reduce((sum, t) => sum + (t.realizedPnL ?? 0), 0);
  const grossLoss = Math.abs(
    sellTrades.filter((t) => (t.realizedPnL ?? 0) < 0).reduce((sum, t) => sum + (t.realizedPnL ?? 0), 0)
  );
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 1;

  return {
    sharpeRatio,
    totalReturn,
    maxDrawdown,
    winRate,
    volatility,
    profitFactor: Math.min(profitFactor, 10),
    tradeCount: totalTrades,
    annualizedReturn,
    finalValue,
    downsideDeviation
  };
}
