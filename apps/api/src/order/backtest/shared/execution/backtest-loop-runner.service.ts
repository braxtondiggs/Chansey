import { Injectable, Logger } from '@nestjs/common';

import { BacktestBarProcessor } from './backtest-bar-processor.service';
import { BacktestContextFactory } from './backtest-context-factory.service';
import { LoopContext } from './backtest-loop-context';
import { LoopRunnerOptions } from './backtest-loop-runner.types';

import { Coin } from '../../../../coin/coin.entity';
import { LiveReplayExecuteResult } from '../../backtest-pacing.interface';
import { BacktestPerformanceSnapshot } from '../../backtest-performance-snapshot.entity';
import { BacktestFinalMetrics } from '../../backtest-result.service';
import { BacktestSignal } from '../../backtest-signal.entity';
import { BacktestStreamService } from '../../backtest-stream.service';
import { BacktestTrade } from '../../backtest-trade.entity';
import { Backtest } from '../../backtest.entity';
import { SimulatedOrderFill } from '../../simulated-order-fill.entity';
import { MetricsAccumulatorService } from '../metrics-accumulator';
import { PriceWindowService } from '../price-window';

// Re-export types and functions for backwards compatibility
export { ExecuteOptions, LoopRunnerOptions, classifySignalType, mapStrategySignal } from './backtest-loop-runner.types';

/**
 * BacktestLoopRunner
 *
 * Orchestrates the main simulation loop for both historical and live-replay
 * backtest modes. Context initialization is delegated to BacktestContextFactory.
 * Per-bar iteration is delegated to BacktestBarProcessor.
 */
@Injectable()
export class BacktestLoopRunner {
  private readonly logger = new Logger(BacktestLoopRunner.name);

  constructor(
    private readonly backtestStream: BacktestStreamService,
    private readonly priceWindow: PriceWindowService,
    private readonly metricsAccSvc: MetricsAccumulatorService,
    private readonly barProcessor: BacktestBarProcessor,
    private readonly contextFactory: BacktestContextFactory
  ) {}

  /**
   * Execute the main backtest loop for either historical or live-replay mode.
   *
   * For historical mode, returns the standard result shape.
   * For live-replay mode, returns a LiveReplayExecuteResult which may include
   * a paused state with checkpoint.
   */
  async execute(
    backtest: Backtest,
    coins: Coin[],
    options: LoopRunnerOptions
  ): Promise<
    | {
        trades: Partial<BacktestTrade>[];
        signals: Partial<BacktestSignal>[];
        simulatedFills: Partial<SimulatedOrderFill>[];
        snapshots: Partial<BacktestPerformanceSnapshot>[];
        finalMetrics: BacktestFinalMetrics;
      }
    | LiveReplayExecuteResult
  > {
    if (!backtest.algorithm) {
      throw new Error('Backtest algorithm relation not loaded');
    }

    // ---- Phase 1: Initialization ----
    const ctx = await this.contextFactory.create(backtest, coins, options);

    // ---- Phase 2: Main loop ----
    const startIndex = options.resumeFrom ? options.resumeFrom.lastProcessedIndex + 1 : 0;

    for (let i = startIndex; i < ctx.effectiveTimestampCount; i++) {
      const pauseResult = await this.barProcessor.processBar(ctx, i);
      if (pauseResult) return pauseResult;
    }

    // ---- Phase 3: Post-loop cleanup ----
    return this.finalizeResults(ctx);
  }

  /**
   * Post-loop: release data, calculate final metrics, publish telemetry.
   */
  private async finalizeResults(ctx: LoopContext): Promise<
    | {
        trades: Partial<BacktestTrade>[];
        signals: Partial<BacktestSignal>[];
        simulatedFills: Partial<SimulatedOrderFill>[];
        snapshots: Partial<BacktestPerformanceSnapshot>[];
        finalMetrics: BacktestFinalMetrics;
      }
    | LiveReplayExecuteResult
  > {
    // Release large data structures
    this.priceWindow.clearPriceData(ctx.pricesByTimestamp, ctx.priceCtx);

    // Harvest remaining items from final (post-last-checkpoint) arrays
    this.metricsAccSvc.harvestMetrics(ctx.trades, ctx.snapshots, ctx.metricsAcc.callbacks);

    const finalMetrics = this.metricsAccSvc.calculateFinalMetricsFromAccumulators(
      ctx.backtest.initialCapital,
      ctx.backtest.startDate,
      ctx.backtest.endDate,
      ctx.portfolio,
      ctx.metricsAcc.totalTradeCount,
      ctx.metricsAcc.totalSellCount,
      ctx.metricsAcc.totalWinningSellCount,
      ctx.metricsAcc.snapshotValues,
      ctx.maxDrawdown,
      ctx.metricsAcc.grossProfit,
      ctx.metricsAcc.grossLoss
    );

    if (ctx.options.telemetryEnabled) {
      const telMeta = ctx.isLiveReplay ? { isLiveReplay: 1 } : undefined;
      await this.backtestStream.publishMetric(
        ctx.backtest.id,
        'final_value',
        finalMetrics.finalValue ?? ctx.portfolio.totalValue,
        'USD',
        telMeta
      );
      await this.backtestStream.publishMetric(
        ctx.backtest.id,
        'total_return',
        finalMetrics.totalReturn ?? 0,
        'pct',
        telMeta
      );
      if (ctx.isLiveReplay) {
        await this.backtestStream.publishStatus(ctx.backtest.id, 'completed', undefined, { isLiveReplay: true });
      } else {
        await this.backtestStream.publishStatus(ctx.backtest.id, 'completed');
      }
    }

    this.logger.log(
      `${ctx.isLiveReplay ? 'Live replay b' : 'B'}acktest completed: ${ctx.metricsAcc.totalTradeCount} trades, final value: $${ctx.portfolio.totalValue.toFixed(2)}` +
        (ctx.metricsAcc.skippedBuyCount > 0
          ? `, ${ctx.metricsAcc.skippedBuyCount} buy signals skipped (insufficient cash)`
          : '')
    );

    if (ctx.isLiveReplay) {
      return {
        trades: ctx.trades,
        signals: ctx.signals,
        simulatedFills: ctx.simulatedFills,
        snapshots: ctx.snapshots,
        finalMetrics,
        paused: false
      } as LiveReplayExecuteResult;
    }

    return {
      trades: ctx.trades,
      signals: ctx.signals,
      simulatedFills: ctx.simulatedFills,
      snapshots: ctx.snapshots,
      finalMetrics
    };
  }
}
