import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import { DEFAULT_RISK_LEVEL, getAllocationLimits, PipelineStage } from '@chansey/api-interfaces';

import { LoopContext } from './backtest-loop-context';
import { ExecuteOptions, LoopRunnerOptions } from './backtest-loop-runner.types';
import { getMinHoldMs } from './trade-executor.helpers';

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
  ReplaySpeed
} from '../../backtest-pacing.interface';
import { Backtest } from '../../backtest.entity';
import { IncrementalSma } from '../../incremental-sma';
import { MarketDataReaderService, OHLCVData } from '../../market-data-reader.service';
import { QuoteCurrencyResolverService } from '../../quote-currency-resolver.service';
import { SeededRandom } from '../../seeded-random';
import { ExitSignalProcessorService } from '../exit-signals';
import { MetricsAccumulatorService } from '../metrics-accumulator';
import { Portfolio, PortfolioStateService } from '../portfolio';
import { PriceWindowService } from '../price-window';
import { CompositeRegimeService } from '../regime';
import { DEFAULT_SLIPPAGE_CONFIG, mapSlippageModelType, SlippageModelType, SlippageService } from '../slippage';
import { SlippageContextService } from '../slippage-context';
import { SignalThrottleService } from '../throttle';

/** Wall-clock algorithm stall timeout (ms) */
const ALGORITHM_STALL_TIMEOUT_MS = 300_000;
/** BTC SMA period for regime detection */
const REGIME_SMA_PERIOD = 200;

/**
 * BacktestContextFactory
 *
 * Owns all context initialization for backtest runs: config resolution,
 * data loading, portfolio restoration, and checkpoint fast-forwarding.
 * Produces a fully-initialized LoopContext ready for the simulation loop.
 */
@Injectable()
export class BacktestContextFactory {
  private readonly logger = new Logger(BacktestContextFactory.name);

  constructor(
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
    private readonly exitSignalProcessorSvc: ExitSignalProcessorService,
    private readonly metricsAccSvc: MetricsAccumulatorService
  ) {}

  /**
   * Create a fully-initialized LoopContext for a backtest run.
   */
  async create(backtest: Backtest, coins: Coin[], options: LoopRunnerOptions): Promise<LoopContext> {
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

    // Phase 1: Restore state + load data
    const { rng, portfolio, peakValue, maxDrawdown } = this.restoreState(backtest, options, isResuming);
    const { coinMap, quoteCoin, pricesByTimestamp, timestamps, priceCtx, delistingDates, boundaries } =
      await this.loadAndPrepareData(backtest, coins, options, isLiveReplay);

    this.logger.log(
      `Processing ${timestamps.length} time periods` +
        (isLiveReplay ? ` with ${delayMs}ms delay` : '') +
        ` (warmup: ${boundaries.effectiveTradingStartIndex}, trading: ${boundaries.tradingTimestampCount})`
    );

    // Phase 2: Trade config
    const { slippageConfig, minHoldMs, allocLimits, exitTracker, oppSellingEnabled, oppSellingConfig } =
      this.resolveTradeConfig(backtest, options, isLiveReplay, isResuming);

    // Phase 3: Signal config
    const { regimeConfig, throttleConfig, throttleState } = this.resolveSignalConfig(
      backtest,
      options,
      coins,
      isResuming
    );

    // Phase 4: Accumulators + metadata
    const totalPersistedCounts =
      isResuming && options.resumeFrom
        ? { ...options.resumeFrom.persistedCounts }
        : { trades: 0, signals: 0, fills: 0, snapshots: 0, sells: 0, winningSells: 0, grossProfit: 0, grossLoss: 0 };

    const metricsAcc = this.metricsAccSvc.createMetricsAccumulator(
      totalPersistedCounts.trades,
      totalPersistedCounts.sells ?? 0,
      totalPersistedCounts.winningSells ?? 0,
      totalPersistedCounts.grossProfit ?? 0,
      totalPersistedCounts.grossLoss ?? 0
    );

    const startIndex = isResuming && options.resumeFrom ? options.resumeFrom.lastProcessedIndex + 1 : 0;

    const algoMetadata = isLiveReplay
      ? {
          datasetId: options.dataset.id,
          deterministicSeed: options.deterministicSeed,
          backtestId: backtest.id,
          isLiveReplay: true,
          replaySpeed
        }
      : { datasetId: options.dataset.id, deterministicSeed: options.deterministicSeed, backtestId: backtest.id };

    // Assemble context
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
      lastCheckpointCounts: {
        trades: 0,
        signals: 0,
        fills: 0,
        snapshots: 0,
        sells: 0,
        winningSells: 0,
        grossProfit: 0,
        grossLoss: 0
      },
      lastCheckpointIndex: startIndex - 1,
      watchdog: new AlgorithmWatchdog(ALGORITHM_STALL_TIMEOUT_MS),
      backtest,
      coins,
      coinMap,
      quoteCoin,
      priceCtx,
      pricesByTimestamp,
      timestamps,
      delistingDates,
      ...boundaries,
      options
    });

    // Initialize incremental SMA for BTC regime detection
    if (ctx.btcCoin) {
      ctx.priceCtx.btcRegimeSma = new IncrementalSma(REGIME_SMA_PERIOD);
      ctx.priceCtx.btcCoinId = ctx.btcCoin.id;
    }

    // Fast-forward price windows on resume
    if (isResuming) {
      this.fastForwardForResume(ctx, startIndex, boundaries.effectiveTimestampCount, coins, timestamps);
    }

    return ctx;
  }

  // ---- Private helpers ----

  private async loadAndPrepareData(
    backtest: Backtest,
    coins: Coin[],
    options: LoopRunnerOptions,
    isLiveReplay: boolean
  ) {
    const coinMap = new Map<string, Coin>(coins.map((coin) => [coin.id, coin]));

    const preferredQuoteCurrency = (backtest.configSnapshot?.run?.quoteCurrency as string) ?? DEFAULT_QUOTE_CURRENCY;
    const quoteCoin = await this.quoteCurrencyResolver.resolveQuoteCurrency(preferredQuoteCurrency);

    const dataLoadStartDate = options.dataset.startAt ?? backtest.startDate;
    const dataLoadEndDate = options.dataset.endAt ?? backtest.endDate;
    const tradingStartDate = backtest.startDate;
    const tradingEndDate = backtest.endDate;

    let historicalPrices = await this.loadPriceData(options, coins, dataLoadStartDate, dataLoadEndDate);
    if (historicalPrices.length === 0) {
      throw new Error('No historical price data available for the specified date range');
    }

    const pricesByTimestamp = this.priceWindow.groupPricesByTimestamp(historicalPrices);
    const timestamps = Object.keys(pricesByTimestamp).sort();
    const priceCtx = this.priceWindow.initPriceTracking(
      historicalPrices,
      coins.map((c) => c.id)
    );
    historicalPrices = [];

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

    const boundaries = this.calculateBoundaries(timestamps, tradingStartDate, tradingEndDate);

    return { coinMap, quoteCoin, pricesByTimestamp, timestamps, priceCtx, delistingDates, boundaries };
  }

  private resolveTradeConfig(
    backtest: Backtest,
    options: LoopRunnerOptions,
    isLiveReplay: boolean,
    isResuming: boolean
  ) {
    const slippageConfig = this.buildSlippageConfig(backtest);
    const minHoldMs = options.minHoldMs ?? getMinHoldMs(options.riskLevel ?? DEFAULT_RISK_LEVEL);

    const defaultStage = isLiveReplay ? PipelineStage.LIVE_REPLAY : PipelineStage.HISTORICAL;
    const allocLimits = getAllocationLimits(options.pipelineStage ?? defaultStage, options.riskLevel, {
      maxAllocation: options.maxAllocation,
      minAllocation: options.minAllocation
    });

    const exitTracker = this.exitSignalProcessorSvc.resolveExitTracker({
      exitConfig: options.exitConfig,
      enableHardStopLoss: options.enableHardStopLoss !== false,
      hardStopLossPercent: options.hardStopLossPercent ?? 0.05,
      resumeExitTrackerState: isResuming ? options.resumeFrom?.exitTrackerState : undefined
    });

    const oppSellingEnabled = !isLiveReplay && ((options as ExecuteOptions).enableOpportunitySelling ?? false);
    const oppSellingConfig = (options as ExecuteOptions).opportunitySellingConfig ?? DEFAULT_OPPORTUNITY_SELLING_CONFIG;

    return { slippageConfig, minHoldMs, allocLimits, exitTracker, oppSellingEnabled, oppSellingConfig };
  }

  private resolveSignalConfig(backtest: Backtest, options: LoopRunnerOptions, coins: Coin[], isResuming: boolean) {
    const regimeConfig = this.compositeRegimeSvc.resolveRegimeConfig(options, coins);
    const throttleConfig = this.signalThrottle.resolveConfig(
      backtest.configSnapshot?.parameters as Record<string, unknown> | undefined
    );
    const throttleState =
      isResuming && options.resumeFrom?.throttleState
        ? this.signalThrottle.deserialize(options.resumeFrom.throttleState)
        : this.signalThrottle.createState();

    return { regimeConfig, throttleConfig, throttleState };
  }

  private restoreState(
    backtest: Backtest,
    options: LoopRunnerOptions,
    isResuming: boolean
  ): { rng: SeededRandom; portfolio: Portfolio; peakValue: number; maxDrawdown: number } {
    if (isResuming && options.resumeFrom) {
      const rng = SeededRandom.fromState(options.resumeFrom.rngState);
      this.logger.log(`Restored RNG state from checkpoint at index ${options.resumeFrom.lastProcessedIndex}`);
      const portfolio = this.portfolioState.deserialize(options.resumeFrom.portfolio);
      const peakValue = options.resumeFrom.peakValue;
      const maxDrawdown = options.resumeFrom.maxDrawdown;
      this.logger.log(
        `Restored portfolio: cash=${portfolio.cashBalance.toFixed(2)}, positions=${portfolio.positions.size}, peak=${peakValue.toFixed(2)}`
      );
      return { rng, portfolio, peakValue, maxDrawdown };
    }

    return {
      rng: new SeededRandom(options.deterministicSeed),
      portfolio: {
        cashBalance: backtest.initialCapital,
        positions: new Map(),
        totalValue: backtest.initialCapital
      },
      peakValue: backtest.initialCapital,
      maxDrawdown: 0
    };
  }

  private async loadPriceData(
    options: LoopRunnerOptions,
    coins: Coin[],
    startDate: Date,
    endDate: Date
  ): Promise<OHLCCandle[]> {
    if (this.marketDataReader.hasStorageLocation(options.dataset)) {
      this.logger.log(`Reading market data from storage: ${options.dataset.storageLocation}`);
      const marketDataResult = await this.marketDataReader.readMarketData(options.dataset, startDate, endDate);
      const candles = this.convertOHLCVToCandles(marketDataResult.data);
      this.logger.log(
        `Loaded ${candles.length} candle records from storage (${marketDataResult.dateRange.start.toISOString()} to ${marketDataResult.dateRange.end.toISOString()})`
      );
      return candles;
    }

    return this.ohlcService.getCandlesByDateRange(
      coins.map((c) => c.id),
      startDate,
      endDate
    );
  }

  private calculateBoundaries(
    timestamps: string[],
    tradingStartDate: Date,
    tradingEndDate: Date
  ): { effectiveTradingStartIndex: number; effectiveTimestampCount: number; tradingTimestampCount: number } {
    const tradingStartIndex = timestamps.findIndex((ts) => new Date(ts) >= tradingStartDate);
    const tradingEndIdx = (() => {
      let lastIdx = timestamps.length - 1;
      while (lastIdx >= 0 && new Date(timestamps[lastIdx]) > tradingEndDate) lastIdx--;
      return lastIdx;
    })();
    const effectiveTradingStartIndex = tradingStartIndex >= 0 ? tradingStartIndex : 0;
    const effectiveTimestampCount = tradingEndIdx + 1;
    const tradingTimestampCount = effectiveTimestampCount - effectiveTradingStartIndex;

    return { effectiveTradingStartIndex, effectiveTimestampCount, tradingTimestampCount };
  }

  private buildSlippageConfig(backtest: Backtest) {
    const slippageSnapshot = backtest.configSnapshot?.slippage;
    const slippageModel = slippageSnapshot
      ? mapSlippageModelType(slippageSnapshot.model as string)
      : SlippageModelType.FIXED;
    const riskDefaults =
      slippageModel === SlippageModelType.VOLUME_BASED
        ? this.slippageCtxSvc.getParticipationDefaults(backtest.configSnapshot?.regime?.riskLevel ?? DEFAULT_RISK_LEVEL)
        : undefined;
    return slippageSnapshot
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
  }

  private fastForwardForResume(
    ctx: LoopContext,
    startIndex: number,
    effectiveTimestampCount: number,
    coins: Coin[],
    timestamps: string[]
  ): void {
    this.logger.log(
      `Resuming from index ${startIndex} of ${effectiveTimestampCount} (${((startIndex / effectiveTimestampCount) * 100).toFixed(1)}% complete)`
    );

    if (startIndex > 0) {
      for (let j = 0; j < startIndex; j++) {
        this.priceWindow.advancePriceWindows(ctx.priceCtx, coins, new Date(timestamps[j]));
      }
      this.logger.log(`Fast-forwarded price windows through ${startIndex} timestamps for resume`);
    }
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
