import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import { getAllocationLimits, PipelineStage } from '@chansey/api-interfaces';

import { BacktestBarProcessor } from './backtest-bar-processor.service';
import { LoopContext } from './backtest-loop-context';
import { ExecuteOptions, LoopRunnerOptions } from './backtest-loop-runner.types';
import { ForcedExitService } from './forced-exit.service';
import { TradeExecutorService } from './trade-executor.service';

import { AlgorithmRegistry } from '../../../../algorithm/registry/algorithm-registry.service';
import { CoinListingEventService } from '../../../../coin/coin-listing-event.service';
import { Coin } from '../../../../coin/coin.entity';
import { DEFAULT_QUOTE_CURRENCY } from '../../../../exchange/constants';
import { OHLCCandle } from '../../../../ohlc/ohlc-candle.entity';
import { OHLCService } from '../../../../ohlc/ohlc.service';
import { DEFAULT_OPPORTUNITY_SELLING_CONFIG } from '../../../interfaces/opportunity-selling.interface';
import { AlgorithmWatchdog } from '../../algorithm-watchdog';
import { DEFAULT_CHECKPOINT_CONFIG } from '../../backtest-checkpoint.interface';
import {
  calculateReplayDelay,
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_LIVE_REPLAY_CHECKPOINT_INTERVAL,
  LiveReplayExecuteOptions,
  LiveReplayExecuteResult,
  ReplaySpeed
} from '../../backtest-pacing.interface';
import { BacktestPerformanceSnapshot } from '../../backtest-performance-snapshot.entity';
import { BacktestFinalMetrics } from '../../backtest-result.service';
import { BacktestSignal } from '../../backtest-signal.entity';
import { BacktestStreamService } from '../../backtest-stream.service';
import { BacktestTrade } from '../../backtest-trade.entity';
import { Backtest } from '../../backtest.entity';
import { IncrementalSma } from '../../incremental-sma';
import { MarketDataReaderService, OHLCVData } from '../../market-data-reader.service';
import { QuoteCurrencyResolverService } from '../../quote-currency-resolver.service';
import { SeededRandom } from '../../seeded-random';
import { SimulatedOrderFill } from '../../simulated-order-fill.entity';
import { CheckpointService } from '../checkpoint';
import { ExitSignalProcessorService } from '../exit-signals';
import { MetricsAccumulatorService } from '../metrics-accumulator';
import { OpportunitySellService } from '../opportunity-selling';
import { Portfolio, PortfolioStateService } from '../portfolio';
import { PriceWindowService } from '../price-window';
import { CompositeRegimeService } from '../regime';
import { DEFAULT_SLIPPAGE_CONFIG, SlippageModelType, SlippageService } from '../slippage';
import { SlippageContextService } from '../slippage-context';
import { SignalThrottleService } from '../throttle';

// Re-export types and functions for backwards compatibility
export { ExecuteOptions, LoopRunnerOptions, classifySignalType, mapStrategySignal } from './backtest-loop-runner.types';

/**
 * BacktestLoopRunner
 *
 * Orchestrates the main simulation loop for both historical and live-replay
 * backtest modes. Handles initialization (config, data loading, portfolio setup)
 * and post-loop cleanup (metrics, telemetry). Per-bar iteration is delegated
 * to BacktestBarProcessor.
 */
@Injectable()
export class BacktestLoopRunner {
  private readonly logger = new Logger(BacktestLoopRunner.name);

  /** Default minimum hold period before allowing SELL (24 hours in ms) */
  private static readonly DEFAULT_MIN_HOLD_MS = 24 * 60 * 60 * 1000;
  /** Wall-clock algorithm stall timeout (ms) */
  private static readonly ALGORITHM_STALL_TIMEOUT_MS = 300_000;
  /** BTC SMA period for regime detection */
  private static readonly REGIME_SMA_PERIOD = 200;

  constructor(
    private readonly backtestStream: BacktestStreamService,
    private readonly algorithmRegistry: AlgorithmRegistry,
    @Inject(forwardRef(() => OHLCService))
    private readonly ohlcService: OHLCService,
    private readonly marketDataReader: MarketDataReaderService,
    private readonly quoteCurrencyResolver: QuoteCurrencyResolverService,
    private readonly slippageService: SlippageService,
    private readonly portfolioState: PortfolioStateService,
    private readonly signalThrottle: SignalThrottleService,
    private readonly coinListingEventService: CoinListingEventService,
    private readonly priceWindow: PriceWindowService,
    private readonly compositeRegimeSvc: CompositeRegimeService,
    private readonly slippageCtxSvc: SlippageContextService,
    private readonly checkpointSvc: CheckpointService,
    private readonly exitSignalProcessorSvc: ExitSignalProcessorService,
    private readonly forcedExitSvc: ForcedExitService,
    private readonly tradeExecutor: TradeExecutorService,
    private readonly metricsAccSvc: MetricsAccumulatorService,
    private readonly opportunitySellSvc: OpportunitySellService,
    private readonly barProcessor: BacktestBarProcessor
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
    const ctx = await this.initializeContext(backtest, coins, options);

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
   * Initialize all context state: config resolution, data loading, portfolio setup.
   */
  private async initializeContext(backtest: Backtest, coins: Coin[], options: LoopRunnerOptions): Promise<LoopContext> {
    const isLiveReplay = options.mode === 'live-replay';
    const liveReplayOpts = isLiveReplay ? (options as LiveReplayExecuteOptions & { mode: 'live-replay' }) : null;

    const isResuming = !!options.resumeFrom;
    const checkpointInterval = isLiveReplay
      ? (options.checkpointInterval ?? DEFAULT_LIVE_REPLAY_CHECKPOINT_INTERVAL)
      : (options.checkpointInterval ?? DEFAULT_CHECKPOINT_CONFIG.checkpointInterval);

    // Live-replay pacing
    const replaySpeed = liveReplayOpts?.replaySpeed ?? ReplaySpeed.FAST_5X;
    const baseIntervalMs = liveReplayOpts?.baseIntervalMs ?? DEFAULT_BASE_INTERVAL_MS;
    const delayMs = isLiveReplay ? calculateReplayDelay(replaySpeed, baseIntervalMs) : 0;

    const modeLabel = isLiveReplay ? 'live replay' : 'historical';
    this.logger.log(
      `Starting ${modeLabel} backtest: ${backtest.name} (dataset=${options.dataset.id}, seed=${options.deterministicSeed}, resuming=${isResuming}` +
        (isLiveReplay ? `, speed=${ReplaySpeed[replaySpeed]}, delay=${delayMs}ms` : '') +
        ')'
    );

    // Initialize or restore RNG
    let rng: SeededRandom;
    if (isResuming && options.resumeFrom) {
      rng = SeededRandom.fromState(options.resumeFrom.rngState);
      this.logger.log(`Restored RNG state from checkpoint at index ${options.resumeFrom.lastProcessedIndex}`);
    } else {
      rng = new SeededRandom(options.deterministicSeed);
    }

    // Initialize or restore portfolio
    let portfolio: Portfolio;
    let peakValue: number;
    let maxDrawdown: number;
    if (isResuming && options.resumeFrom) {
      portfolio = this.portfolioState.deserialize(options.resumeFrom.portfolio);
      peakValue = options.resumeFrom.peakValue;
      maxDrawdown = options.resumeFrom.maxDrawdown;
      this.logger.log(
        `Restored portfolio: cash=${portfolio.cashBalance.toFixed(2)}, positions=${portfolio.positions.size}, peak=${peakValue.toFixed(2)}`
      );
    } else {
      portfolio = {
        cashBalance: backtest.initialCapital,
        positions: new Map(),
        totalValue: backtest.initialCapital
      };
      peakValue = backtest.initialCapital;
      maxDrawdown = 0;
    }

    // Cumulative persisted counts
    const totalPersistedCounts =
      isResuming && options.resumeFrom
        ? { ...options.resumeFrom.persistedCounts }
        : { trades: 0, signals: 0, fills: 0, snapshots: 0, sells: 0, winningSells: 0, grossProfit: 0, grossLoss: 0 };

    // Lightweight metrics accumulators
    const metricsAcc = this.metricsAccSvc.createMetricsAccumulator(
      totalPersistedCounts.trades,
      totalPersistedCounts.sells ?? 0,
      totalPersistedCounts.winningSells ?? 0,
      totalPersistedCounts.grossProfit ?? 0,
      totalPersistedCounts.grossLoss ?? 0
    );

    const coinMap = new Map<string, Coin>(coins.map((coin) => [coin.id, coin]));

    // Resolve quote currency
    const preferredQuoteCurrency = (backtest.configSnapshot?.run?.quoteCurrency as string) ?? DEFAULT_QUOTE_CURRENCY;
    const quoteCoin = await this.quoteCurrencyResolver.resolveQuoteCurrency(preferredQuoteCurrency);

    // Load data from full dataset range for indicator warmup
    const dataLoadStartDate = options.dataset.startAt ?? backtest.startDate;
    const dataLoadEndDate = options.dataset.endAt ?? backtest.endDate;
    const tradingStartDate = backtest.startDate;
    const tradingEndDate = backtest.endDate;

    let historicalPrices: OHLCCandle[];
    if (this.marketDataReader.hasStorageLocation(options.dataset)) {
      this.logger.log(`Reading market data from storage: ${options.dataset.storageLocation}`);
      const marketDataResult = await this.marketDataReader.readMarketData(
        options.dataset,
        dataLoadStartDate,
        dataLoadEndDate
      );
      historicalPrices = this.convertOHLCVToCandles(marketDataResult.data);
      this.logger.log(
        `Loaded ${historicalPrices.length} candle records from storage (${marketDataResult.dateRange.start.toISOString()} to ${marketDataResult.dateRange.end.toISOString()})`
      );
    } else {
      historicalPrices = await this.getHistoricalPrices(
        coins.map((c) => c.id),
        dataLoadStartDate,
        dataLoadEndDate
      );
    }

    if (historicalPrices.length === 0) {
      throw new Error('No historical price data available for the specified date range');
    }

    const pricesByTimestamp = this.priceWindow.groupPricesByTimestamp(historicalPrices);
    const timestamps = Object.keys(pricesByTimestamp).sort();
    const priceCtx = this.priceWindow.initPriceTracking(
      historicalPrices,
      coins.map((c) => c.id)
    );

    // Drop reference to the full candles array
    historicalPrices = [];

    // Pre-load delisting dates for survivorship bias correction
    const delistingDates =
      options.enableDelistingExit !== false
        ? await this.coinListingEventService.getActiveDelistingsAsOf(
            coins.map((c) => c.id),
            tradingEndDate
          )
        : new Map<string, Date>();

    if (delistingDates.size > 0) {
      this.logger.log(
        `Loaded ${delistingDates.size} delisting events for forced-exit simulation` +
          (isLiveReplay ? ' (live-replay)' : '')
      );
    }

    // Calculate warmup vs trading boundaries
    const tradingStartIndex = timestamps.findIndex((ts) => new Date(ts) >= tradingStartDate);
    const tradingEndIdx = (() => {
      let lastIdx = timestamps.length - 1;
      while (lastIdx >= 0 && new Date(timestamps[lastIdx]) > tradingEndDate) lastIdx--;
      return lastIdx;
    })();
    const effectiveTradingStartIndex = tradingStartIndex >= 0 ? tradingStartIndex : 0;
    const effectiveTimestampCount = tradingEndIdx + 1;
    const tradingTimestampCount = effectiveTimestampCount - effectiveTradingStartIndex;

    this.logger.log(
      `Processing ${timestamps.length} time periods` +
        (isLiveReplay ? ` with ${delayMs}ms delay` : '') +
        ` (warmup: ${effectiveTradingStartIndex}, trading: ${tradingTimestampCount})`
    );

    // Build slippage config from backtest configSnapshot
    const slippageSnapshot = backtest.configSnapshot?.slippage;
    const slippageModel = slippageSnapshot
      ? this.compositeRegimeSvc.mapSlippageModelType(slippageSnapshot.model as string)
      : SlippageModelType.FIXED;
    const riskDefaults =
      slippageModel === SlippageModelType.VOLUME_BASED
        ? this.slippageCtxSvc.getParticipationDefaults(backtest.configSnapshot?.regime?.riskLevel ?? 3)
        : undefined;
    const slippageConfig = slippageSnapshot
      ? this.slippageService.buildConfig({
          type: slippageModel,
          fixedBps: slippageSnapshot.fixedBps ?? 5,
          baseSlippageBps: slippageSnapshot.baseSlippageBps ?? 5,
          participationRateLimit: slippageSnapshot.participationRateLimit ?? riskDefaults?.participationRateLimit,
          rejectParticipationRate: slippageSnapshot.rejectParticipationRate ?? riskDefaults?.rejectParticipationRate,
          volatilityFactor: slippageSnapshot.volatilityFactor,
          spreadCalibrationFactor: slippageSnapshot.spreadCalibrationFactor ?? 1.0,
          minSpreadBps: slippageSnapshot.minSpreadBps ?? 2
        })
      : DEFAULT_SLIPPAGE_CONFIG;

    // Minimum hold period
    const minHoldMs = options.minHoldMs ?? BacktestLoopRunner.DEFAULT_MIN_HOLD_MS;

    // Position sizing
    const defaultStage = isLiveReplay ? PipelineStage.LIVE_REPLAY : PipelineStage.HISTORICAL;
    const allocLimits = getAllocationLimits(options.pipelineStage ?? defaultStage, options.riskLevel, {
      maxAllocation: options.maxAllocation,
      minAllocation: options.minAllocation
    });

    // Exit tracker
    const enableHardStopLoss = options.enableHardStopLoss !== false;
    const hardStopLossPercent = options.hardStopLossPercent ?? 0.05;
    const exitTracker = this.exitSignalProcessorSvc.resolveExitTracker({
      exitConfig: options.exitConfig,
      enableHardStopLoss,
      hardStopLossPercent,
      resumeExitTrackerState: isResuming ? options.resumeFrom?.exitTrackerState : undefined
    });

    // Opportunity selling config (historical only)
    const oppSellingEnabled = !isLiveReplay && ((options as ExecuteOptions).enableOpportunitySelling ?? false);
    const oppSellingConfig = (options as ExecuteOptions).opportunitySellingConfig ?? DEFAULT_OPPORTUNITY_SELLING_CONFIG;

    // Regime config
    const regimeConfig = this.compositeRegimeSvc.resolveRegimeConfig(options, coins);

    // Signal throttle
    const throttleConfig = this.signalThrottle.resolveConfig(
      backtest.configSnapshot?.parameters as Record<string, unknown> | undefined
    );
    const throttleState =
      isResuming && options.resumeFrom?.throttleState
        ? this.signalThrottle.deserialize(options.resumeFrom.throttleState)
        : this.signalThrottle.createState();

    // Determine starting index
    const startIndex = isResuming && options.resumeFrom ? options.resumeFrom.lastProcessedIndex + 1 : 0;

    // Algorithm context metadata
    const algoMetadata = isLiveReplay
      ? {
          datasetId: options.dataset.id,
          deterministicSeed: options.deterministicSeed,
          backtestId: backtest.id,
          isLiveReplay: true,
          replaySpeed
        }
      : {
          datasetId: options.dataset.id,
          deterministicSeed: options.deterministicSeed,
          backtestId: backtest.id
        };

    // Build context via factory
    const ctx = LoopContext.create({
      isLiveReplay,
      liveReplayOpts,
      checkpointInterval,
      delayMs,
      slippageConfig,
      minHoldMs,
      maxAllocation: allocLimits.maxAllocation,
      minAllocation: allocLimits.minAllocation,
      oppSellingEnabled,
      oppSellingConfig,
      algoMetadata,
      replaySpeed,
      enableRegimeScaledSizing: regimeConfig.enableRegimeScaledSizing,
      riskLevel: regimeConfig.riskLevel,
      regimeGateEnabled: regimeConfig.regimeGateEnabled,
      btcCoin: regimeConfig.btcCoin,
      rng,
      portfolio,
      peakValue,
      maxDrawdown,
      exitTracker,
      throttleState,
      throttleConfig,
      totalPersistedCounts,
      metricsAcc,
      lastCheckpointCounts:
        isResuming && options.resumeFrom
          ? { ...options.resumeFrom.persistedCounts }
          : { trades: 0, signals: 0, fills: 0, snapshots: 0, sells: 0, winningSells: 0, grossProfit: 0, grossLoss: 0 },
      lastCheckpointIndex: startIndex - 1,
      watchdog: new AlgorithmWatchdog(BacktestLoopRunner.ALGORITHM_STALL_TIMEOUT_MS),
      backtest,
      coins,
      coinMap,
      quoteCoin,
      priceCtx,
      pricesByTimestamp,
      timestamps,
      delistingDates,
      effectiveTradingStartIndex,
      effectiveTimestampCount,
      tradingTimestampCount,
      options
    });

    // Initialize incremental SMA for BTC regime detection
    if (ctx.btcCoin) {
      ctx.priceCtx.btcRegimeSma = new IncrementalSma(BacktestLoopRunner.REGIME_SMA_PERIOD);
      ctx.priceCtx.btcCoinId = ctx.btcCoin.id;
    }

    if (isResuming) {
      this.logger.log(
        `Resuming from index ${startIndex} of ${effectiveTimestampCount} (${((startIndex / effectiveTimestampCount) * 100).toFixed(1)}% complete)`
      );

      // Fast-forward price windows to the resume point
      if (startIndex > 0) {
        for (let j = 0; j < startIndex; j++) {
          this.priceWindow.advancePriceWindows(ctx.priceCtx, coins, new Date(timestamps[j]));
        }
        this.logger.log(`Fast-forwarded price windows through ${startIndex} timestamps for resume`);
      }
    }

    return ctx;
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

  // ---- Private utility methods ----

  private async getHistoricalPrices(coinIds: string[], startDate: Date, endDate: Date): Promise<OHLCCandle[]> {
    return this.ohlcService.getCandlesByDateRange(coinIds, startDate, endDate);
  }

  private convertOHLCVToCandles(ohlcvData: OHLCVData[]): OHLCCandle[] {
    return ohlcvData.map(
      (data) =>
        new OHLCCandle({
          coinId: data.coinId,
          timestamp: data.timestamp,
          open: data.open,
          high: data.high,
          low: data.low,
          close: data.close,
          volume: data.volume
        })
    );
  }
}
