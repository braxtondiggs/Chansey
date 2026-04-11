import { Injectable, Logger, Optional } from '@nestjs/common';

import { LoopContext } from './backtest-loop-context';
import { mapStrategySignal } from './backtest-loop-runner.types';
import { BacktestSignalTradeService } from './backtest-signal-trade.service';
import { ForcedExitService } from './forced-exit.service';
import { TradeExecutorService } from './trade-executor.service';

import { AlgorithmRegistry } from '../../../../algorithm/registry/algorithm-registry.service';
import { AlgorithmNotRegisteredException } from '../../../../common/exceptions';
import { OHLCCandle, PriceSummaryByPeriod } from '../../../../ohlc/ohlc-candle.entity';
import { toErrorInfo } from '../../../../shared/error.util';
import { BacktestAbortedError } from '../../backtest-aborted.error';
import { BacktestCheckpointState } from '../../backtest-checkpoint.interface';
import { CheckpointResults, LiveReplayExecuteResult, ReplaySpeed } from '../../backtest-pacing.interface';
import { BacktestStreamService } from '../../backtest-stream.service';
import { BacktestTrade } from '../../backtest-trade.entity';
import { CheckpointService } from '../checkpoint';
import { ExitSignalProcessorService } from '../exit-signals';
import { MetricsAccumulatorService } from '../metrics-accumulator';
import { OpportunitySellService } from '../opportunity-selling';
import { PortfolioStateService } from '../portfolio';
import { PriceWindowService } from '../price-window';
import { CompositeRegimeService } from '../regime';
import { SlippageContextService } from '../slippage-context';
import { SignalThrottleService } from '../throttle';
import { MarketData, TradingSignal } from '../types';

/** Per-call timeout for algorithm execution */
const ALGORITHM_CALL_TIMEOUT_MS = 90_000;
/** Max consecutive algorithm failures before aborting */
const MAX_CONSECUTIVE_ERRORS = 10;
/** Heartbeat interval for stale detection (~30s) */
const HEARTBEAT_INTERVAL_MS = 30_000;
/** Max consecutive pause-check failures before forced pause */
const MAX_CONSECUTIVE_PAUSE_FAILURES = 3;

/**
 * Processes a single timestamp bar within the backtest loop.
 *
 * Extracted from BacktestLoopRunner to isolate per-bar logic (warmup,
 * algorithm execution, signal processing, trade execution, checkpointing)
 * from the orchestrator's initialization and cleanup phases.
 */
@Injectable()
export class BacktestBarProcessor {
  private readonly logger = new Logger(BacktestBarProcessor.name);
  private readonly reusablePriceMap = new Map<string, number>();

  constructor(
    @Optional() private readonly backtestStream: BacktestStreamService,
    private readonly algorithmRegistry: AlgorithmRegistry,
    private readonly portfolioState: PortfolioStateService,
    private readonly signalThrottle: SignalThrottleService,
    private readonly priceWindow: PriceWindowService,
    private readonly compositeRegimeSvc: CompositeRegimeService,
    private readonly slippageCtxSvc: SlippageContextService,
    private readonly checkpointSvc: CheckpointService,
    private readonly exitSignalProcessorSvc: ExitSignalProcessorService,
    private readonly forcedExitSvc: ForcedExitService,
    private readonly tradeExecutor: TradeExecutorService,
    private readonly metricsAccSvc: MetricsAccumulatorService,
    private readonly opportunitySellSvc: OpportunitySellService,
    private readonly signalTradeSvc: BacktestSignalTradeService
  ) {}

  /**
   * Process one timestamp bar. Returns a LiveReplayExecuteResult if paused, null to continue.
   */
  async processBar(ctx: LoopContext, i: number): Promise<LiveReplayExecuteResult | null> {
    // Live-replay: check for pause request BEFORE processing this timestamp
    if (ctx.isLiveReplay && ctx.liveReplayOpts?.shouldPause) {
      const pauseResult = await this.checkPauseRequest(ctx, i);
      if (pauseResult && 'paused' in pauseResult) {
        return pauseResult as LiveReplayExecuteResult;
      }
      if (pauseResult) {
        ctx.consecutivePauseFailures = (pauseResult as { consecutivePauseFailures: number }).consecutivePauseFailures;
      }
    }

    const timestamp = new Date(ctx.timestamps[i]);
    const currentPrices = ctx.pricesByTimestamp[ctx.timestamps[i]];
    const isWarmup = i < ctx.effectiveTradingStartIndex;

    this.reusablePriceMap.clear();
    for (const price of currentPrices) {
      this.reusablePriceMap.set(price.coinId, this.priceWindow.getPriceValue(price));
    }
    const marketData: MarketData = {
      timestamp,
      prices: this.reusablePriceMap
    };

    // Always update portfolio values and advance price windows (needed for indicator warmup)
    ctx.portfolio = this.portfolioState.updateValues(ctx.portfolio, marketData.prices);

    // Check for liquidated positions after price update
    const liquidationTrades = this.forcedExitSvc.checkAndApplyLiquidations(
      ctx.portfolio,
      marketData,
      ctx.backtest.tradingFee,
      ctx.coinMap,
      ctx.quoteCoin
    );
    for (const liqTrade of liquidationTrades) {
      liqTrade.executedAt = timestamp;
      ctx.trades.push(liqTrade as Partial<BacktestTrade>);
    }

    // Update last known prices for delisting penalty calculation
    for (const [coinId, price] of marketData.prices) {
      ctx.lastKnownPrices.set(coinId, price);
    }

    // Check for delisting forced exits
    if (ctx.delistingDates.size > 0) {
      const delistingTrades = this.forcedExitSvc.checkAndApplyDelistingExits(
        ctx.portfolio,
        ctx.delistingDates,
        ctx.lastKnownPrices,
        timestamp,
        ctx.options.delistingPenalty ?? 0.9,
        ctx.exitTracker,
        ctx.coinMap,
        ctx.quoteCoin
      );
      for (const dt of delistingTrades) {
        dt.executedAt = timestamp;
        dt.backtest = ctx.backtest;
        ctx.trades.push(dt);
      }
    }

    const priceData = this.priceWindow.advancePriceWindows(ctx.priceCtx, ctx.coins, timestamp);

    if (isWarmup) {
      await this.processWarmupBar(ctx, i, timestamp, priceData, marketData, currentPrices);
      return null;
    }

    await this.processTradingBar(ctx, i, timestamp, currentPrices, marketData, priceData);
    return null;
  }

  /**
   * Handle warmup iteration (algorithm priming only, no trading/recording).
   */
  private async processWarmupBar(
    ctx: LoopContext,
    i: number,
    timestamp: Date,
    priceData: ReturnType<PriceWindowService['advancePriceWindows']>,
    _marketData: MarketData,
    currentPrices: OHLCCandle[]
  ): Promise<void> {
    const warmupRegime = ctx.btcCoin
      ? this.compositeRegimeSvc.computeCompositeRegime(ctx.btcCoin.id, ctx.priceCtx)
      : null;
    const context = this.buildAlgorithmContext(ctx, priceData, timestamp, {
      compositeRegime: ctx.isLiveReplay ? undefined : warmupRegime?.compositeRegime,
      volatilityRegime: ctx.isLiveReplay ? undefined : warmupRegime?.volatilityRegime
    });
    try {
      await this.executeWithTimeout(
        this.algorithmRegistry.executeAlgorithm(ctx.backtest.algorithm.id, context),
        ALGORITHM_CALL_TIMEOUT_MS,
        `Algorithm timed out during warmup at ${timestamp.toISOString()}`
      );
      ctx.watchdog.recordSuccess();
    } catch {
      // Warmup failures are non-fatal — algorithm just won't have primed state
    }

    await this.heartbeatAndYield(ctx, i);

    // Update prevCandleMap during warmup for spread context on first trading bar
    this.slippageCtxSvc.updatePrevCandleMap(ctx.prevCandleMap, currentPrices);
  }

  /**
   * Execute algorithm + process signals for a trading bar.
   */
  private async processTradingBar(
    ctx: LoopContext,
    i: number,
    timestamp: Date,
    currentPrices: OHLCCandle[],
    marketData: MarketData,
    priceData: ReturnType<PriceWindowService['advancePriceWindows']>
  ): Promise<void> {
    const iterStart = Date.now();

    // Exit tracker: check SL/TP/trailing exits BEFORE algorithm runs new decisions
    if (ctx.exitTracker) {
      await this.exitSignalProcessorSvc.processExitSignals(
        {
          exitTracker: ctx.exitTracker,
          currentPrices,
          marketData,
          portfolio: ctx.portfolio,
          tradingFee: ctx.backtest.tradingFee,
          timestamp,
          trades: ctx.trades,
          slippageConfig: ctx.slippageConfig,
          maxAllocation: ctx.maxAllocation,
          minAllocation: ctx.minAllocation,
          signals: ctx.signals,
          simulatedFills: ctx.simulatedFills,
          backtest: ctx.backtest,
          coinMap: ctx.coinMap,
          quoteCoin: ctx.quoteCoin,
          prevCandleMap: ctx.prevCandleMap
        },
        {
          executeTradeFn: this.tradeExecutor.executeTrade.bind(this.tradeExecutor),
          extractDailyVolumeFn: this.slippageCtxSvc.extractDailyVolume.bind(this.slippageCtxSvc),
          buildSpreadContextFn: this.slippageCtxSvc.buildSpreadContext.bind(this.slippageCtxSvc)
        }
      );
    }

    // Live-replay: apply pacing delay (except for the first trading timestamp and MAX_SPEED)
    if (
      ctx.isLiveReplay &&
      ctx.delayMs > 0 &&
      i >
        Math.max(
          ctx.options.resumeFrom ? ctx.options.resumeFrom.lastProcessedIndex + 1 : 0,
          ctx.effectiveTradingStartIndex
        )
    ) {
      await this.delay(ctx.delayMs);
    }

    // Compute regime once per bar for context + filtering
    const barRegimeResult = ctx.btcCoin
      ? this.compositeRegimeSvc.computeCompositeRegime(ctx.btcCoin.id, ctx.priceCtx)
      : null;

    const context = this.buildAlgorithmContext(ctx, priceData, timestamp, {
      compositeRegime: barRegimeResult?.compositeRegime,
      volatilityRegime: barRegimeResult?.volatilityRegime
    });

    let strategySignals: TradingSignal[] = [];
    try {
      const algoExecStart = Date.now();
      const result = await this.executeWithTimeout(
        this.algorithmRegistry.executeAlgorithm(ctx.backtest.algorithm.id, context),
        ALGORITHM_CALL_TIMEOUT_MS,
        `Algorithm timed out at iteration ${i}/${ctx.effectiveTimestampCount} (${timestamp.toISOString()})`
      );

      // Historical mode: log slow executions
      if (!ctx.isLiveReplay) {
        const algoExecDuration = Date.now() - algoExecStart;
        if (algoExecDuration > 5000) {
          this.logger.warn(
            `Slow algorithm execution at iteration ${i}/${ctx.effectiveTimestampCount}: ${algoExecDuration}ms ` +
              `(${ctx.backtest.algorithm.id}, ${timestamp.toISOString()})`
          );
        }
      }

      if (result.success && result.signals?.length) {
        strategySignals = result.signals
          .map((s) => mapStrategySignal(s, result.exitConfig))
          .filter((signal) => signal.action !== 'HOLD');
      }
      ctx.watchdog.recordSuccess();
      ctx.consecutiveErrors = 0;
    } catch (error: unknown) {
      if (error instanceof AlgorithmNotRegisteredException) {
        throw error;
      }
      ctx.watchdog.checkStall(`${i}/${ctx.effectiveTimestampCount} (${timestamp.toISOString()})`);
      const err = toErrorInfo(error);
      ctx.consecutiveErrors++;
      this.logger.warn(
        `Algorithm execution failed at ${timestamp.toISOString()} ` +
          `(${ctx.consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${err.message}`
      );
      if (ctx.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        throw new Error(`Algorithm failed ${MAX_CONSECUTIVE_ERRORS} consecutive times. Last error: ${err.message}`);
      }
    }

    // Apply signal throttle: cooldowns, daily cap, min sell %
    strategySignals = this.signalThrottle.filterSignals(
      strategySignals,
      ctx.throttleState,
      ctx.throttleConfig,
      timestamp.getTime()
    ).accepted;

    // Regime gate + regime-scaled position sizing + concentration filter
    const concentrationCtx = this.compositeRegimeSvc.buildConcentrationContext(ctx.portfolio, marketData);

    const { filteredSignals, barMaxAllocation, barMinAllocation } = this.compositeRegimeSvc.applyBarRegime(
      strategySignals,
      ctx.priceCtx,
      {
        btcCoin: ctx.btcCoin,
        regimeGateEnabled: ctx.regimeGateEnabled,
        enableRegimeScaledSizing: ctx.enableRegimeScaledSizing,
        riskLevel: ctx.riskLevel,
        concentrationContext: concentrationCtx
      },
      { maxAllocation: ctx.maxAllocation, minAllocation: ctx.minAllocation },
      barRegimeResult
    );
    strategySignals = filteredSignals;

    for (const strategySignal of strategySignals) {
      await this.signalTradeSvc.processSignalTrade(
        ctx,
        strategySignal,
        timestamp,
        marketData,
        currentPrices,
        barMaxAllocation,
        barMinAllocation
      );
    }

    // Update peak/drawdown
    if (ctx.portfolio.totalValue > ctx.peakValue) {
      ctx.peakValue = ctx.portfolio.totalValue;
    }
    const currentDrawdown =
      ctx.peakValue === 0 ? 0 : Math.max(0, (ctx.peakValue - ctx.portfolio.totalValue) / ctx.peakValue);
    if (currentDrawdown > ctx.maxDrawdown) {
      ctx.maxDrawdown = currentDrawdown;
    }

    // Periodic snapshots (every 24h relative index or last bar)
    const tradingRelativeIdx = i - ctx.effectiveTradingStartIndex;
    if (tradingRelativeIdx % 24 === 0 || i === ctx.effectiveTimestampCount - 1) {
      ctx.snapshots.push({
        timestamp,
        portfolioValue: ctx.portfolio.totalValue,
        cashBalance: ctx.portfolio.cashBalance,
        holdings: this.exitSignalProcessorSvc.portfolioToHoldings(ctx.portfolio, marketData.prices),
        cumulativeReturn: (ctx.portfolio.totalValue - ctx.backtest.initialCapital) / ctx.backtest.initialCapital,
        drawdown: currentDrawdown,
        backtest: ctx.backtest
      });

      if (ctx.options.telemetryEnabled && this.backtestStream) {
        await this.backtestStream.publishMetric(ctx.backtest.id, 'portfolio_value', ctx.portfolio.totalValue, 'USD', {
          timestamp: timestamp.toISOString(),
          ...(ctx.isLiveReplay ? { isLiveReplay: 1, replaySpeed: ReplaySpeed[ctx.replaySpeed] } : {})
        });
      }
    }

    // Update previous candle map for spread estimation
    this.slippageCtxSvc.updatePrevCandleMap(ctx.prevCandleMap, currentPrices);

    // Iteration timing telemetry (historical only — live-replay has intentional delays)
    if (!ctx.isLiveReplay) {
      const iterDuration = Date.now() - iterStart;
      if (iterDuration > 5000) {
        this.logger.warn(
          `Slow iteration ${i}/${ctx.effectiveTimestampCount} took ${iterDuration}ms at ${timestamp.toISOString()}`
        );
      }
    }

    await this.heartbeatAndYield(ctx, i);

    // Emergency checkpoint on SIGTERM
    if (ctx.options.abortSignal?.aborted) {
      await this.writeEmergencyCheckpointAndAbort(ctx, i, timestamp);
    }

    // Checkpoint callback: save state periodically for resume capability
    const timeSinceLastCheckpoint = i - ctx.lastCheckpointIndex;
    if (ctx.options.onCheckpoint && timeSinceLastCheckpoint >= ctx.checkpointInterval) {
      await this.persistCheckpoint(ctx, i, timestamp, tradingRelativeIdx);
    }
  }

  /**
   * Periodic heartbeat + yield to event loop.
   */
  private async heartbeatAndYield(ctx: LoopContext, i: number): Promise<void> {
    if (ctx.options.onHeartbeat && Date.now() - ctx.lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
      await ctx.options.onHeartbeat(i, ctx.effectiveTimestampCount);
      ctx.lastHeartbeatTime = Date.now();
    }

    // Yield to the event loop periodically
    if (i % 100 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  /**
   * Check for pause request in live-replay mode.
   */
  private async checkPauseRequest(
    ctx: LoopContext,
    i: number
  ): Promise<LiveReplayExecuteResult | { consecutivePauseFailures: number } | null> {
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

  /**
   * Build a pause result with checkpoint state and partial final metrics.
   */
  private async buildPauseResult(
    ctx: LoopContext,
    i: number,
    onPaused?: (state: BacktestCheckpointState) => Promise<void>
  ): Promise<LiveReplayExecuteResult> {
    const checkpointState = this.buildCheckpointSnapshot(ctx, i - 1, ctx.timestamps[Math.max(0, i - 1)]);

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
   * Build checkpoint state — shared by regular checkpoints, pause, and emergency.
   */
  private buildCheckpointSnapshot(ctx: LoopContext, index: number, timestampStr: string): BacktestCheckpointState {
    const currentSells = this.checkpointSvc.countSells(ctx.trades);
    return this.checkpointSvc.buildCheckpointState(
      index,
      timestampStr,
      ctx.portfolio,
      ctx.peakValue,
      ctx.maxDrawdown,
      ctx.rng.getState(),
      ctx.totalPersistedCounts.trades + ctx.trades.length,
      ctx.totalPersistedCounts.signals + ctx.signals.length,
      ctx.totalPersistedCounts.fills + ctx.simulatedFills.length,
      ctx.totalPersistedCounts.snapshots + ctx.snapshots.length,
      ctx.metricsAcc.totalSellCount + currentSells.sells,
      ctx.metricsAcc.totalWinningSellCount + currentSells.winningSells,
      this.signalThrottle.serialize(ctx.throttleState),
      ctx.metricsAcc.grossProfit + currentSells.grossProfit,
      ctx.metricsAcc.grossLoss + currentSells.grossLoss,
      ctx.exitTracker?.serialize()
    );
  }

  /**
   * Persist a checkpoint: build state, call onCheckpoint, harvest metrics, clear arrays.
   */
  private async persistCheckpoint(
    ctx: LoopContext,
    i: number,
    timestamp: Date,
    tradingRelativeIdx: number
  ): Promise<void> {
    const checkpointState = this.buildCheckpointSnapshot(ctx, i, timestamp.toISOString());

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
  async writeEmergencyCheckpointAndAbort(ctx: LoopContext, i: number, timestamp: Date): Promise<never> {
    if (ctx.options.onCheckpoint) {
      const emergencyState = this.buildCheckpointSnapshot(ctx, i, timestamp.toISOString());
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

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
  }

  private buildAlgorithmContext(
    ctx: LoopContext,
    priceData: PriceSummaryByPeriod,
    timestamp: Date,
    regime: Record<string, unknown>
  ) {
    return {
      coins: ctx.coins,
      priceData,
      timestamp,
      config: ctx.backtest.configSnapshot?.parameters ?? {},
      positions: (() => {
        const pos: Record<string, number> = {};
        for (const [id, p] of ctx.portfolio.positions) pos[id] = p.quantity;
        return pos;
      })(),
      availableBalance: ctx.portfolio.cashBalance,
      metadata: ctx.algoMetadata,
      ...regime
    };
  }
}
