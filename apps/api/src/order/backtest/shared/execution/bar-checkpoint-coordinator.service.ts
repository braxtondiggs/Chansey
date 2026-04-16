import { Injectable, Logger } from '@nestjs/common';

import { LoopContext } from './backtest-loop-context';

import { toErrorInfo } from '../../../../shared/error.util';
import { BacktestAbortedError } from '../../backtest-aborted.error';
import { BacktestCheckpointState } from '../../backtest-checkpoint.interface';
import { CheckpointResults, LiveReplayExecuteResult } from '../../backtest-pacing.interface';
import { CheckpointService } from '../checkpoint';
import { MetricsAccumulatorService } from '../metrics-accumulator';
import { SignalThrottleService } from '../throttle';

/** Max consecutive pause-check failures before forcing a precautionary pause. */
const MAX_CONSECUTIVE_PAUSE_FAILURES = 3;

/**
 * Either a pending pause result to surface up the stack, or just an updated
 * consecutive-failure counter. `null` means the caller should continue.
 */
export type PauseCheckOutcome = LiveReplayExecuteResult | { consecutivePauseFailures: number } | null;

/**
 * Coordinates all checkpoint/pause work for a single backtest bar.
 *
 * Extracted from BacktestBarProcessor to keep both files under the 500-line
 * limit. Owns snapshot construction, normal persistence, emergency writes,
 * and live-replay pause handshakes.
 */
@Injectable()
export class BarCheckpointCoordinator {
  private readonly logger = new Logger(BarCheckpointCoordinator.name);

  constructor(
    private readonly checkpointSvc: CheckpointService,
    private readonly metricsAccSvc: MetricsAccumulatorService,
    private readonly signalThrottle: SignalThrottleService
  ) {}

  /**
   * Build checkpoint state — shared by regular checkpoints, pause, and emergency.
   */
  buildSnapshot(ctx: LoopContext, index: number, timestampStr: string): BacktestCheckpointState {
    const currentSells = this.checkpointSvc.countSells(ctx.trades);
    return this.checkpointSvc.buildCheckpointState({
      lastProcessedIndex: index,
      lastProcessedTimestamp: timestampStr,
      portfolio: ctx.portfolio,
      peakValue: ctx.peakValue,
      maxDrawdown: ctx.maxDrawdown,
      rngState: ctx.rng.getState(),
      tradesCount: ctx.totalPersistedCounts.trades + ctx.trades.length,
      signalsCount: ctx.totalPersistedCounts.signals + ctx.signals.length,
      fillsCount: ctx.totalPersistedCounts.fills + ctx.simulatedFills.length,
      snapshotsCount: ctx.totalPersistedCounts.snapshots + ctx.snapshots.length,
      sellsCount: ctx.metricsAcc.totalSellCount + currentSells.sells,
      winningSellsCount: ctx.metricsAcc.totalWinningSellCount + currentSells.winningSells,
      serializedThrottleState: this.signalThrottle.serialize(ctx.throttleState),
      grossProfit: ctx.metricsAcc.grossProfit + currentSells.grossProfit,
      grossLoss: ctx.metricsAcc.grossLoss + currentSells.grossLoss,
      exitTrackerState: ctx.exitTracker?.serialize(),
      pendingSignals: ctx.pendingSignals.length > 0 ? ctx.pendingSignals.slice() : undefined
    });
  }

  /**
   * Persist a checkpoint: build state, call onCheckpoint, harvest metrics, clear arrays.
   */
  async persist(ctx: LoopContext, i: number, timestamp: Date, tradingRelativeIdx: number): Promise<void> {
    const checkpointState = this.buildSnapshot(ctx, i, timestamp.toISOString());

    const checkpointResults: CheckpointResults = {
      trades: ctx.trades.slice(ctx.lastCheckpointCounts.trades),
      signals: ctx.signals.slice(ctx.lastCheckpointCounts.signals),
      simulatedFills: ctx.simulatedFills.slice(ctx.lastCheckpointCounts.fills),
      snapshots: ctx.snapshots.slice(ctx.lastCheckpointCounts.snapshots)
    };

    await ctx.options.onCheckpoint?.(checkpointState, checkpointResults, ctx.tradingTimestampCount);

    // Harvest metrics from current arrays into accumulators before clearing
    this.metricsAccSvc.harvestMetrics(ctx.trades, ctx.snapshots, ctx.metricsAcc.callbacks);

    // Update cumulative persisted counts and clear arrays to free memory
    ctx.totalPersistedCounts.trades += ctx.trades.length;
    ctx.totalPersistedCounts.signals += ctx.signals.length;
    ctx.totalPersistedCounts.fills += ctx.simulatedFills.length;
    ctx.totalPersistedCounts.snapshots += ctx.snapshots.length;
    ctx.trades.length = 0;
    ctx.signals.length = 0;
    ctx.simulatedFills.length = 0;
    ctx.snapshots.length = 0;
    ctx.lastCheckpointCounts = { trades: 0, signals: 0, fills: 0, snapshots: 0 };
    ctx.lastCheckpointIndex = i;

    this.logger.debug(
      `${ctx.isLiveReplay ? 'Live replay c' : 'C'}heckpoint saved at index ${i}/${ctx.effectiveTimestampCount} (${((tradingRelativeIdx / ctx.tradingTimestampCount) * 100).toFixed(1)}%)`
    );
  }

  /**
   * Write an emergency checkpoint and throw BacktestAbortedError.
   */
  async writeEmergencyAndAbort(ctx: LoopContext, i: number, timestamp: Date): Promise<never> {
    if (ctx.options.onCheckpoint) {
      const emergencyState = this.buildSnapshot(ctx, i, timestamp.toISOString());
      const emergencyResults: CheckpointResults = {
        trades: ctx.trades.slice(ctx.lastCheckpointCounts.trades),
        signals: ctx.signals.slice(ctx.lastCheckpointCounts.signals),
        simulatedFills: ctx.simulatedFills.slice(ctx.lastCheckpointCounts.fills),
        snapshots: ctx.snapshots.slice(ctx.lastCheckpointCounts.snapshots)
      };
      await ctx.options.onCheckpoint(emergencyState, emergencyResults, ctx.tradingTimestampCount);
    } else {
      this.logger.warn(
        `Backtest ${ctx.backtest.id} aborted but no checkpoint callback available — state may not be recoverable`
      );
    }
    throw new BacktestAbortedError(ctx.backtest.id);
  }

  /**
   * Build a pause result with checkpoint state and partial final metrics.
   */
  async buildPauseResult(
    ctx: LoopContext,
    i: number,
    onPaused?: (state: BacktestCheckpointState) => Promise<void>
  ): Promise<LiveReplayExecuteResult> {
    const checkpointState = this.buildSnapshot(ctx, i - 1, ctx.timestamps[Math.max(0, i - 1)]);

    this.logger.log(`Live replay paused at index ${i - 1}/${ctx.timestamps.length}`);

    if (onPaused) {
      await onPaused(checkpointState);
    }

    // Calculate partial final metrics using accumulators for correctness across checkpoints
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

    return {
      trades: ctx.trades,
      signals: ctx.signals,
      simulatedFills: ctx.simulatedFills,
      snapshots: ctx.snapshots,
      finalMetrics,
      paused: true,
      pausedCheckpoint: checkpointState
    };
  }

  /**
   * Check for pause request in live-replay mode. Returns null when caller
   * should continue, a result object when pausing, or a failure counter update
   * when the pause check threw transiently.
   */
  async checkPauseRequest(ctx: LoopContext, i: number): Promise<PauseCheckOutcome> {
    const liveOpts = ctx.liveReplayOpts;
    if (!liveOpts) return null;

    try {
      const shouldPauseNow = await (liveOpts.shouldPause as () => Promise<boolean>)();

      if (!shouldPauseNow) {
        return { consecutivePauseFailures: 0 };
      }

      return this.buildPauseResult(ctx, i, liveOpts.onPaused);
    } catch (pauseError: unknown) {
      const err = toErrorInfo(pauseError);
      const newFailures = ctx.consecutivePauseFailures + 1;
      this.logger.warn(
        `Pause check failed at index ${i} (attempt ${newFailures}/${MAX_CONSECUTIVE_PAUSE_FAILURES}): ${err.message}`
      );

      if (newFailures >= MAX_CONSECUTIVE_PAUSE_FAILURES) {
        this.logger.error(
          `Pause check failed ${MAX_CONSECUTIVE_PAUSE_FAILURES} times consecutively, forcing precautionary pause`
        );
        return this.buildPauseResult(ctx, i, liveOpts.onPaused);
      }

      return { consecutivePauseFailures: newFailures };
    }
  }
}
