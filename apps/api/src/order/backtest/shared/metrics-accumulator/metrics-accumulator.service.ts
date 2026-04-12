import { Injectable } from '@nestjs/common';

import * as dayjs from 'dayjs';
import { Decimal } from 'decimal.js';

import { BacktestPerformanceSnapshot } from '../../backtest-performance-snapshot.entity';
import { BacktestFinalMetrics } from '../../backtest-result.service';
import { BacktestTrade } from '../../backtest-trade.entity';
import { CheckpointService } from '../checkpoint';
import { MetricsCalculatorService, TimeframeType } from '../metrics';
import { Portfolio } from '../portfolio';

/**
 * Accumulated metrics state carried across checkpoints.
 *
 * Lightweight counters are harvested from trade/snapshot arrays before
 * each array is cleared, allowing final metrics to be computed without
 * holding every object in memory for the entire run.
 */
export interface MetricsAccumulator {
  totalTradeCount: number;
  totalSellCount: number;
  totalWinningSellCount: number;
  grossProfit: number;
  grossLoss: number;
  skippedBuyCount: number;
  /** Portfolio values collected across all checkpoints for Sharpe calculation.
   *  Not cleared at checkpoints (Sharpe needs the full series).
   *  Bounded: 8 bytes/entry — ~14KB for 5yr daily, ~4MB for 1yr minute-level. */
  snapshotValues: number[];
  callbacks: {
    addTradeCount: (n: number) => void;
    addSellCount: (n: number) => void;
    addWinningSellCount: (n: number) => void;
    addSnapshotValues: (vals: number[]) => void;
    addGrossProfit: (n: number) => void;
    addGrossLoss: (n: number) => void;
  };
}

/**
 * Metrics Accumulator Service
 *
 * Manages lightweight metric counters that survive checkpoint array clears.
 * Provides three capabilities:
 * 1. Creating an accumulator with optional initial state (for checkpoint resume)
 * 2. Harvesting metrics from trade/snapshot arrays before they are cleared
 * 3. Computing final metrics from accumulated counters after all candles are processed
 */
@Injectable()
export class MetricsAccumulatorService {
  constructor(
    private readonly metricsCalculator: MetricsCalculatorService,
    private readonly checkpointSvc: CheckpointService
  ) {}

  /**
   * Create a MetricsAccumulator with optional initial values for checkpoint resume.
   * The returned object has mutable counters and closure-based callbacks that
   * increment those counters in place.
   */
  createMetricsAccumulator(
    initialTradeCount = 0,
    initialSellCount = 0,
    initialWinningSellCount = 0,
    initialGrossProfit = 0,
    initialGrossLoss = 0
  ): MetricsAccumulator {
    const acc: MetricsAccumulator = {
      totalTradeCount: initialTradeCount,
      totalSellCount: initialSellCount,
      totalWinningSellCount: initialWinningSellCount,
      grossProfit: initialGrossProfit,
      grossLoss: initialGrossLoss,
      skippedBuyCount: 0,
      snapshotValues: [],
      callbacks: {} as MetricsAccumulator['callbacks']
    };
    acc.callbacks = {
      addTradeCount: (n) => {
        acc.totalTradeCount += n;
      },
      addSellCount: (n) => {
        acc.totalSellCount += n;
      },
      addWinningSellCount: (n) => {
        acc.totalWinningSellCount += n;
      },
      addSnapshotValues: (vals) => {
        acc.snapshotValues.push(...vals);
      },
      addGrossProfit: (n) => {
        acc.grossProfit += n;
      },
      addGrossLoss: (n) => {
        acc.grossLoss += n;
      }
    };
    return acc;
  }

  /**
   * Extract lightweight metrics from trade/snapshot arrays into accumulator callbacks.
   * Called before clearing arrays after checkpoint persistence.
   */
  harvestMetrics(
    trades: Partial<BacktestTrade>[],
    snapshots: Partial<BacktestPerformanceSnapshot>[],
    acc: MetricsAccumulator['callbacks']
  ): void {
    acc.addTradeCount(trades.length);
    const { sells, winningSells, grossProfit, grossLoss } = this.checkpointSvc.countSells(trades);
    acc.addSellCount(sells);
    acc.addWinningSellCount(winningSells);
    acc.addGrossProfit(grossProfit);
    acc.addGrossLoss(grossLoss);
    acc.addSnapshotValues(snapshots.map((s) => s.portfolioValue ?? 0));
  }

  /**
   * Compute final metrics from lightweight accumulators instead of full arrays.
   * Used after arrays have been cleared across checkpoints to avoid holding all
   * trade/snapshot objects in memory for the entire run.
   */
  calculateFinalMetricsFromAccumulators(
    initialCapital: number,
    startDate: Date,
    endDate: Date,
    portfolio: Portfolio,
    totalTradeCount: number,
    totalSellCount: number,
    totalWinningSellCount: number,
    snapshotValues: number[],
    maxDrawdown: number,
    grossProfit: number,
    grossLoss: number
  ): BacktestFinalMetrics {
    const finalValue = portfolio.totalValue;
    const totalReturn = new Decimal(finalValue).minus(initialCapital).dividedBy(initialCapital).toNumber();

    const durationDays = dayjs(endDate).diff(dayjs(startDate), 'day');
    const annualizedReturn =
      durationDays > 0
        ? new Decimal(1).plus(totalReturn).pow(new Decimal(365).dividedBy(durationDays)).minus(1).toNumber()
        : totalReturn;

    // Calculate Sharpe ratio from lightweight portfolio value array
    const returns: number[] = [];
    for (let i = 1; i < snapshotValues.length; i++) {
      const previous = snapshotValues[i - 1] ?? initialCapital;
      const current = snapshotValues[i] ?? initialCapital;
      returns.push(previous === 0 ? 0 : (current - previous) / previous);
    }

    const sharpeRatio =
      returns.length > 0
        ? this.metricsCalculator.calculateSharpeRatio(returns, {
            timeframe: TimeframeType.DAILY,
            useCryptoCalendar: true,
            riskFreeRate: 0.02
          })
        : 0;

    // Compute profitFactor from accumulated gross profit/loss (capped at 10)
    const rawProfitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 10 : 1;
    const profitFactor = Math.min(rawProfitFactor, 10);

    // Compute annualized volatility from returns series
    let volatility = 0;
    if (returns.length > 0) {
      const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
      volatility = Math.sqrt(variance) * Math.sqrt(365);
    }

    return {
      finalValue,
      totalReturn,
      annualizedReturn,
      sharpeRatio,
      maxDrawdown,
      totalTrades: totalTradeCount,
      winningTrades: totalWinningSellCount,
      losingTrades: totalSellCount - totalWinningSellCount,
      winRate: totalSellCount > 0 ? totalWinningSellCount / totalSellCount : 0,
      profitFactor,
      volatility
    };
  }
}
