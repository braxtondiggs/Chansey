import { Injectable, Logger, Optional } from '@nestjs/common';

import { LoopContext } from './backtest-loop-context';
import { mapStrategySignal } from './backtest-loop-runner.types';
import { BacktestSignalTradeService } from './backtest-signal-trade.service';
import { BarCheckpointCoordinator } from './bar-checkpoint-coordinator.service';
import { ForcedExitService } from './forced-exit.service';
import { TradeExecutorService } from './trade-executor.service';

import { AlgorithmContext } from '../../../../algorithm/interfaces';
import { AlgorithmRegistry } from '../../../../algorithm/registry/algorithm-registry.service';
import { AlgorithmNotRegisteredException } from '../../../../common/exceptions';
import { OHLCCandle, PriceSummaryByPeriod } from '../../../../ohlc/ohlc-candle.entity';
import { toErrorInfo } from '../../../../shared/error.util';
import { LiveReplayExecuteResult, ReplaySpeed } from '../../backtest-pacing.interface';
import { BacktestStreamService } from '../../backtest-stream.service';
import { BacktestTrade } from '../../backtest-trade.entity';
import { ExitSignalProcessorService } from '../exit-signals';
import { PortfolioStateService } from '../portfolio';
import { PriceWindowService } from '../price-window';
import { PriceTimeframe } from '../price-window/price-timeframe';
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

/**
 * Processes a single timestamp bar within the backtest loop.
 * Checkpoint/pause bookkeeping is delegated to BarCheckpointCoordinator.
 */
@Injectable()
export class BacktestBarProcessor {
  private readonly logger = new Logger(BacktestBarProcessor.name);

  constructor(
    @Optional() private readonly backtestStream: BacktestStreamService,
    private readonly algorithmRegistry: AlgorithmRegistry,
    private readonly portfolioState: PortfolioStateService,
    private readonly signalThrottle: SignalThrottleService,
    private readonly priceWindow: PriceWindowService,
    private readonly compositeRegimeSvc: CompositeRegimeService,
    private readonly slippageCtxSvc: SlippageContextService,
    private readonly exitSignalProcessorSvc: ExitSignalProcessorService,
    private readonly forcedExitSvc: ForcedExitService,
    private readonly tradeExecutor: TradeExecutorService,
    private readonly signalTradeSvc: BacktestSignalTradeService,
    private readonly checkpointCoordinator: BarCheckpointCoordinator
  ) {}

  /** Process one timestamp bar. Returns a LiveReplayExecuteResult if paused, null to continue. */
  async processBar(ctx: LoopContext, i: number): Promise<LiveReplayExecuteResult | null> {
    // Live-replay: check for pause request BEFORE processing this timestamp
    if (ctx.isLiveReplay && ctx.liveReplayOpts?.shouldPause) {
      const pauseResult = await this.checkpointCoordinator.checkPauseRequest(ctx, i);
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

    const priceMap = new Map<string, number>();
    for (const price of currentPrices) {
      priceMap.set(price.coinId, this.priceWindow.getPriceValue(price));
    }
    const marketData: MarketData = { timestamp, prices: priceMap };

    // Always update portfolio values and advance price windows (needed for indicator warmup)
    ctx.portfolio = this.portfolioState.updateValues(ctx.portfolio, marketData.prices);

    this.applyForcedExits(ctx, timestamp, marketData);

    const priceData = this.priceWindow.advancePriceWindows(ctx.priceCtx, ctx.coins, timestamp);
    const priceDataByTimeframe = this.priceWindow.advanceMultiTimeframeWindows(ctx.priceCtx, ctx.coins, timestamp);

    if (isWarmup) {
      await this.processWarmupBar(ctx, i, timestamp, priceData, currentPrices, priceDataByTimeframe);
      return null;
    }

    await this.processTradingBar(ctx, i, timestamp, currentPrices, marketData, priceData, priceDataByTimeframe);
    return null;
  }

  /** Warmup iteration: algorithm priming only, no trading/recording. */
  private async processWarmupBar(
    ctx: LoopContext,
    i: number,
    timestamp: Date,
    priceData: PriceSummaryByPeriod,
    currentPrices: OHLCCandle[],
    priceDataByTimeframe: Partial<Record<PriceTimeframe, PriceSummaryByPeriod>>
  ): Promise<void> {
    const warmupRegime = ctx.btcCoin
      ? this.compositeRegimeSvc.computeCompositeRegime(ctx.btcCoin.id, ctx.priceCtx)
      : null;
    const context = this.buildAlgorithmContext(ctx, priceData, timestamp, priceDataByTimeframe, {
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

  /** Execute algorithm + process signals for a trading bar. */
  private async processTradingBar(
    ctx: LoopContext,
    i: number,
    timestamp: Date,
    currentPrices: OHLCCandle[],
    marketData: MarketData,
    priceData: PriceSummaryByPeriod,
    priceDataByTimeframe: Partial<Record<PriceTimeframe, PriceSummaryByPeriod>>
  ): Promise<void> {
    const iterStart = Date.now();

    // Flush signals queued on bar i-1 at this bar's open (next-bar execution).
    await this.flushPendingSignals(ctx, timestamp, currentPrices);

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

    const context = this.buildAlgorithmContext(ctx, priceData, timestamp, priceDataByTimeframe, {
      compositeRegime: barRegimeResult?.compositeRegime,
      volatilityRegime: barRegimeResult?.volatilityRegime
    });

    const strategySignals = await this.executeAlgorithmWithRetry(ctx, i, timestamp, context);

    // Apply signal throttle: cooldowns, daily cap, min sell %
    const throttled = this.signalThrottle.filterSignals(
      strategySignals,
      ctx.throttleState,
      ctx.throttleConfig,
      timestamp.getTime()
    ).accepted;

    // Regime gate + regime-scaled position sizing + concentration filter
    const concentrationCtx = this.compositeRegimeSvc.buildConcentrationContext(ctx.portfolio, marketData);
    const { filteredSignals, barMaxAllocation, barMinAllocation } = this.compositeRegimeSvc.applyBarRegime(
      throttled,
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

    await this.dispatchFilteredSignals(ctx, filteredSignals, timestamp, marketData, currentPrices, {
      barMaxAllocation,
      barMinAllocation
    });

    // Update peak/drawdown
    if (ctx.portfolio.totalValue > ctx.peakValue) ctx.peakValue = ctx.portfolio.totalValue;
    const currentDrawdown =
      ctx.peakValue === 0 ? 0 : Math.max(0, (ctx.peakValue - ctx.portfolio.totalValue) / ctx.peakValue);
    if (currentDrawdown > ctx.maxDrawdown) ctx.maxDrawdown = currentDrawdown;

    const tradingRelativeIdx = i - ctx.effectiveTradingStartIndex;
    await this.recordPeriodicSnapshot(ctx, i, timestamp, marketData, tradingRelativeIdx, currentDrawdown);

    this.slippageCtxSvc.updatePrevCandleMap(ctx.prevCandleMap, currentPrices);

    if (!ctx.isLiveReplay && Date.now() - iterStart > 5000) {
      this.logger.warn(
        `Slow iteration ${i}/${ctx.effectiveTimestampCount} took ${Date.now() - iterStart}ms at ${timestamp.toISOString()}`
      );
    }

    await this.heartbeatAndYield(ctx, i);

    if (ctx.options.abortSignal?.aborted) {
      await this.checkpointCoordinator.writeEmergencyAndAbort(ctx, i, timestamp);
    }

    if (ctx.options.onCheckpoint && i - ctx.lastCheckpointIndex >= ctx.checkpointInterval) {
      await this.checkpointCoordinator.persist(ctx, i, timestamp, tradingRelativeIdx);
    }
  }

  /** Apply liquidation + delisting forced exits to the portfolio for this bar. */
  private applyForcedExits(ctx: LoopContext, timestamp: Date, marketData: MarketData): void {
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

    for (const [coinId, price] of marketData.prices) {
      ctx.lastKnownPrices.set(coinId, price);
    }

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
  }

  /** Run the algorithm with timeout + consecutive-error tracking; returns non-HOLD signals. */
  private async executeAlgorithmWithRetry(
    ctx: LoopContext,
    i: number,
    timestamp: Date,
    context: AlgorithmContext
  ): Promise<TradingSignal[]> {
    try {
      const algoExecStart = Date.now();
      const result = await this.executeWithTimeout(
        this.algorithmRegistry.executeAlgorithm(ctx.backtest.algorithm.id, context),
        ALGORITHM_CALL_TIMEOUT_MS,
        `Algorithm timed out at iteration ${i}/${ctx.effectiveTimestampCount} (${timestamp.toISOString()})`
      );

      if (!ctx.isLiveReplay) {
        const algoExecDuration = Date.now() - algoExecStart;
        if (algoExecDuration > 5000) {
          this.logger.warn(
            `Slow algorithm execution at iteration ${i}/${ctx.effectiveTimestampCount}: ${algoExecDuration}ms ` +
              `(${ctx.backtest.algorithm.id}, ${timestamp.toISOString()})`
          );
        }
      }

      ctx.watchdog.recordSuccess();
      ctx.consecutiveErrors = 0;

      if (!result.success || !result.signals?.length) return [];
      return result.signals
        .map((s) => mapStrategySignal(s, result.exitConfig))
        .filter((signal) => signal.action !== 'HOLD');
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
      return [];
    }
  }

  /** Hard-SL fills in-bar; every other signal queues for next-bar open. */
  private async dispatchFilteredSignals(
    ctx: LoopContext,
    signals: TradingSignal[],
    timestamp: Date,
    marketData: MarketData,
    currentPrices: OHLCCandle[],
    allocationLimits: { barMaxAllocation: number; barMinAllocation: number }
  ): Promise<void> {
    for (const strategySignal of signals) {
      if (strategySignal.metadata?.hardStopLoss === true) {
        await this.signalTradeSvc.processSignalTrade(
          ctx,
          strategySignal,
          timestamp,
          marketData,
          currentPrices,
          allocationLimits.barMaxAllocation,
          allocationLimits.barMinAllocation
        );
      } else {
        ctx.pendingSignals.push(strategySignal);
      }
    }
  }

  /** Push a snapshot every 24 trading bars or at the final bar + optional telemetry. */
  private async recordPeriodicSnapshot(
    ctx: LoopContext,
    i: number,
    timestamp: Date,
    marketData: MarketData,
    tradingRelativeIdx: number,
    currentDrawdown: number
  ): Promise<void> {
    if (tradingRelativeIdx % 24 !== 0 && i !== ctx.effectiveTimestampCount - 1) return;

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

  /** Periodic heartbeat + yield to event loop. */
  private async heartbeatAndYield(ctx: LoopContext, i: number): Promise<void> {
    if (ctx.options.onHeartbeat && Date.now() - ctx.lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
      await ctx.options.onHeartbeat(i, ctx.effectiveTimestampCount);
      ctx.lastHeartbeatTime = Date.now();
    }
    if (i % 100 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
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
    priceDataByTimeframe: Partial<Record<PriceTimeframe, PriceSummaryByPeriod>>,
    regime: Record<string, unknown>
  ) {
    const hasHigherTimeframes = Object.keys(priceDataByTimeframe).length > 0;
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
      ...(hasHigherTimeframes
        ? {
            priceDataByTimeframe: {
              [PriceTimeframe.HOURLY]: priceData,
              ...priceDataByTimeframe
            }
          }
        : {}),
      ...regime
    };
  }

  /**
   * Flush signals queued on bar i-1. They fill at the current bar's open —
   * the next-bar-execution fix for same-bar close lookahead bias. Signals
   * for coins that have since delisted are dropped rather than filled at a
   * stale level. Allocation limits stay at ctx-level (bar-regime adjustment
   * applies to new decisions on this bar, not prior-bar orders).
   */
  private async flushPendingSignals(ctx: LoopContext, timestamp: Date, currentPrices: OHLCCandle[]): Promise<void> {
    if (ctx.pendingSignals.length === 0) return;

    const openPriceMap = new Map<string, number>();
    for (const candle of currentPrices) {
      openPriceMap.set(candle.coinId, this.priceWindow.getOpenPriceValue(candle));
    }
    const openMarketData: MarketData = { timestamp, prices: openPriceMap };

    const queued = ctx.pendingSignals;
    ctx.pendingSignals = [];

    for (const pending of queued) {
      if (!openPriceMap.has(pending.coinId)) {
        this.logger.debug(
          `Dropping pending ${pending.action} signal for coin ${pending.coinId} — no price on bar ${timestamp.toISOString()}`
        );
        continue;
      }
      await this.signalTradeSvc.processSignalTrade(
        ctx,
        pending,
        timestamp,
        openMarketData,
        currentPrices,
        ctx.maxAllocation,
        ctx.minAllocation
      );
    }
  }
}
