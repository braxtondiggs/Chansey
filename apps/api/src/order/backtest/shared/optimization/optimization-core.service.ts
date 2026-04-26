import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import { DEFAULT_RISK_LEVEL, getAllocationLimits, PipelineStage } from '@chansey/api-interfaces';

import {
  OptimizationBacktestConfig,
  OptimizationBacktestResult,
  PrecomputedWindowData
} from './optimization-backtest.interface';
import { calculateOptimizationMetrics } from './optimization-metrics.util';

import { AlgorithmRegistry } from '../../../../algorithm/registry/algorithm-registry.service';
import { Coin } from '../../../../coin/coin.entity';
import { AlgorithmNotRegisteredException } from '../../../../common/exceptions';
import { OHLCCandle } from '../../../../ohlc/ohlc-candle.entity';
import { OHLCService } from '../../../../ohlc/ohlc.service';
import { toErrorInfo } from '../../../../shared/error.util';
import { BacktestTrade } from '../../backtest-trade.entity';
import { SimulatedOrderStatus } from '../../simulated-order-fill.entity';
import { mapStrategySignal } from '../execution/backtest-loop-runner.types';
import { getMinHoldMs } from '../execution/trade-executor.helpers';
import { TradeExecutorService } from '../execution/trade-executor.service';
import { ExitSignalProcessorService, ProcessExitSignalsCallbacks } from '../exit-signals/exit-signal-processor.service';
import { IndicatorPrecomputeService } from '../indicator-precompute.service';
import { MetricsCalculatorService } from '../metrics';
import { Portfolio, PortfolioStateService } from '../portfolio';
import { PriceTrackingContext, PriceWindowService } from '../price-window';
import { PriceTimeframe } from '../price-window/price-timeframe';
import { CompositeRegimeService } from '../regime/composite-regime.service';
import { DEFAULT_SLIPPAGE_CONFIG } from '../slippage';
import { SlippageContextService } from '../slippage-context/slippage-context.service';
import { SignalThrottleService } from '../throttle';
import { ExecuteTradeFn, MarketData, TradingSignal } from '../types';

/**
 * Options for running the core optimization backtest.
 * Contains the trade execution callback that the caller (engine) must supply.
 */
export interface RunOptimizationCoreOptions {
  config: OptimizationBacktestConfig;
  coins: Coin[];
  historicalPrices: OHLCCandle[];
  executeTradeFn: ExecuteTradeFn;
}

/** Parameters for the unified simulation loop. */
interface SimulationLoopParams {
  config: OptimizationBacktestConfig;
  /** Coins used for loop iteration and algorithm context. */
  coins: Coin[];
  /** Full coin list for regime config resolution (may include coins excluded from trading). */
  allCoins: Coin[];
  pricesByTimestamp: Record<string, OHLCCandle[]>;
  timestamps: string[];
  priceCtx: PriceTrackingContext;
  precomputedIndicators: Record<string, Record<string, Float64Array>> | undefined;
  volumeMap: Map<string, number>;
  executeTradeFn: ExecuteTradeFn;
  tradingStartIndex: number;
}

/** Neutral result returned when there is no price data. */
const EMPTY_RESULT: OptimizationBacktestResult = {
  sharpeRatio: 0,
  totalReturn: 0,
  maxDrawdown: 0,
  winRate: 0,
  volatility: 0,
  profitFactor: 1,
  tradeCount: 0
};

@Injectable()
export class OptimizationCoreService {
  private readonly logger = new Logger('OptimizationCoreService');

  constructor(
    private readonly portfolioState: PortfolioStateService,
    private readonly metricsCalculator: MetricsCalculatorService,
    private readonly algorithmRegistry: AlgorithmRegistry,
    private readonly priceWindowService: PriceWindowService,
    private readonly exitSignalProcessor: ExitSignalProcessorService,
    private readonly compositeRegimeService: CompositeRegimeService,
    private readonly slippageContextService: SlippageContextService,
    private readonly signalThrottle: SignalThrottleService,
    private readonly indicatorPrecompute: IndicatorPrecomputeService,
    private readonly tradeExecutor: TradeExecutorService,
    @Inject(forwardRef(() => OHLCService))
    private readonly ohlcService: OHLCService
  ) {}

  /**
   * Execute a lightweight backtest for parameter optimization.
   * Fetches candle data from the database, then runs the core optimization loop.
   */
  async executeOptimizationBacktest(
    config: OptimizationBacktestConfig,
    coins: Coin[]
  ): Promise<OptimizationBacktestResult> {
    const coinIds = coins.map((coin) => coin.id);
    const historicalPrices = await this.ohlcService.getCandlesByDateRange(coinIds, config.startDate, config.endDate);
    return this.runOptimizationBacktestCore({
      config,
      coins,
      historicalPrices,
      executeTradeFn: this.tradeExecutor.executeTrade.bind(this.tradeExecutor)
    });
  }

  /**
   * Execute an optimization backtest using pre-loaded candle data indexed by coin.
   * Uses binary search for O(log N) range extraction instead of linear filter.
   * Used by the optimization orchestrator to avoid redundant DB queries across windows.
   */
  async executeOptimizationBacktestWithData(
    config: OptimizationBacktestConfig,
    coins: Coin[],
    preloadedCandlesByCoin: Map<string, OHLCCandle[]>
  ): Promise<OptimizationBacktestResult> {
    const filtered = this.priceWindowService.extractCandleSegments(
      coins,
      preloadedCandlesByCoin,
      config.startDate.getTime(),
      config.endDate.getTime()
    );

    return this.runOptimizationBacktestCore({
      config,
      coins,
      historicalPrices: filtered,
      executeTradeFn: this.tradeExecutor.executeTrade.bind(this.tradeExecutor)
    });
  }

  /**
   * Pre-compute all expensive per-window data once for a single date range.
   * Delegates to PriceWindowService which owns all price data preparation logic.
   */
  precomputeWindowData(
    coins: Coin[],
    preloadedCandlesByCoin: Map<string, OHLCCandle[]>,
    startDate: Date,
    endDate: Date
  ): PrecomputedWindowData {
    return this.priceWindowService.precomputeWindowData(coins, preloadedCandlesByCoin, startDate, endDate);
  }

  /**
   * Fast-path optimization backtest using pre-computed window data.
   * Creates only fresh mutable state + indicators (which depend on per-combo config.parameters).
   * Reuses pricesByTimestamp, timestamps, immutablePriceData, and volumeMap from PrecomputedWindowData.
   */
  async runOptimizationBacktestWithPrecomputed(
    config: OptimizationBacktestConfig,
    coins: Coin[],
    precomputed: PrecomputedWindowData
  ): Promise<OptimizationBacktestResult> {
    if (precomputed.filteredCandles.length === 0) {
      return EMPTY_RESULT;
    }

    const { pricesByTimestamp, timestamps, immutablePriceData, volumeMap, tradingStartIndex, aggregatedTimeframes } =
      precomputed;

    // Create fresh mutable state from cached immutable data, optionally
    // reusing pre-aggregated higher-TF summaries for multi-timeframe strategies.
    const priceCtx = this.priceWindowService.initPriceTrackingFromPrecomputed(immutablePriceData, aggregatedTimeframes);

    // Pre-filter coins whose total bar count is below the strategy's minimum requirement
    const {
      filtered: loopCoins,
      excludedCount,
      excludedDetails
    } = await this.priceWindowService.filterCoinsWithSufficientData(
      config.algorithmId,
      coins,
      config.parameters,
      priceCtx.summariesByCoin,
      this.algorithmRegistry
    );
    if (excludedCount > 0) {
      this.logger.debug(`Excluded ${excludedCount} coin(s) with insufficient data: ${excludedDetails.join(', ')}`);
    }

    // Precompute indicators only for coins that passed the filter
    const precomputedIndicators = await this.indicatorPrecompute.precomputeIndicators(
      config.algorithmId,
      config.parameters,
      loopCoins,
      priceCtx
    );

    const executeTradeFn = this.tradeExecutor.executeTrade.bind(this.tradeExecutor);

    const result = await this.runSimulationLoop({
      config,
      coins: loopCoins,
      allCoins: coins,
      pricesByTimestamp,
      timestamps,
      priceCtx,
      precomputedIndicators,
      volumeMap,
      executeTradeFn,
      tradingStartIndex
    });

    // Only clear mutable state -- immutable data is shared across combos
    priceCtx.indexByCoin.clear();
    priceCtx.windowsByCoin.clear();
    priceCtx.btcRegimeSma = undefined;
    priceCtx.btcCoinId = undefined;

    return result;
  }

  /**
   * Core optimization backtest logic shared by both public entry points.
   */
  async runOptimizationBacktestCore(opts: RunOptimizationCoreOptions): Promise<OptimizationBacktestResult> {
    const { config, coins, historicalPrices, executeTradeFn } = opts;

    if (historicalPrices.length === 0) {
      return EMPTY_RESULT;
    }

    const coinIds = coins.map((coin) => coin.id);
    const pricesByTimestamp = this.priceWindowService.groupPricesByTimestamp(historicalPrices);
    const timestamps = Object.keys(pricesByTimestamp).sort();
    const priceCtx = this.priceWindowService.initPriceTracking(historicalPrices, coinIds);

    // Precompute indicators once for the full price series (bypass Redis)
    const precomputedIndicators = await this.indicatorPrecompute.precomputeIndicators(
      config.algorithmId,
      config.parameters,
      coins,
      priceCtx
    );

    // Precompute volume lookup: timestamp+coinId -> volume (avoids .find() per signal)
    const volumeMap = new Map<string, number>();
    for (const tsKey of timestamps) {
      for (const candle of pricesByTimestamp[tsKey]) {
        if (candle.volume != null) {
          const quoteVol = candle.quoteVolume ?? candle.volume * candle.close;
          volumeMap.set(`${tsKey}:${candle.coinId}`, quoteVol);
        }
      }
    }

    const result = await this.runSimulationLoop({
      config,
      coins,
      allCoins: coins,
      pricesByTimestamp,
      timestamps,
      priceCtx,
      precomputedIndicators,
      volumeMap,
      executeTradeFn,
      tradingStartIndex: 0
    });

    // Release large data structures after the main loop
    this.priceWindowService.clearPriceData(pricesByTimestamp, priceCtx);

    return result;
  }

  /**
   * Unified simulation loop shared by both runOptimizationBacktestCore and
   * runOptimizationBacktestWithPrecomputed. All data-source differences are
   * resolved before entry; this method only contains the per-bar logic.
   */
  private async runSimulationLoop(params: SimulationLoopParams): Promise<OptimizationBacktestResult> {
    const {
      config,
      coins,
      allCoins,
      pricesByTimestamp,
      timestamps,
      priceCtx,
      precomputedIndicators,
      volumeMap,
      executeTradeFn
    } = params;
    const tradingStartIndex = params.tradingStartIndex ?? 0;

    const initialCapital = config.initialCapital ?? 10000;
    const tradingFee = config.tradingFee ?? 0.001;
    const hardStopLossPercent = config.hardStopLossPercent ?? 0.05;
    const slippageConfig = config.slippage ?? DEFAULT_SLIPPAGE_CONFIG;

    // Exit tracker for optimization (lightweight -- no signal/fill recording)
    const exitTracker = this.exitSignalProcessor.resolveExitTracker({
      exitConfig: config.exitConfig,
      enableHardStopLoss: true,
      hardStopLossPercent
    });

    this.logger.debug(
      `Running optimization backtest: algo=${config.algorithmId}, ` +
        `range=${config.startDate.toISOString()} to ${config.endDate.toISOString()}`
    );

    let portfolio: Portfolio = {
      cashBalance: initialCapital,
      positions: new Map(),
      totalValue: initialCapital
    };

    const trades: Partial<BacktestTrade>[] = [];
    const snapshots: { portfolioValue: number; timestamp: Date }[] = [];

    // Position sizing for OPTIMIZE stage
    const optAllocLimits = getAllocationLimits(PipelineStage.OPTIMIZE, config.riskLevel, {
      maxAllocation: config.maxAllocation,
      minAllocation: config.minAllocation
    });
    let optMaxAllocation = optAllocLimits.maxAllocation;
    let optMinAllocation = optAllocLimits.minAllocation;

    // Regime gate + scaled sizing for optimization
    const { enableRegimeScaledSizing, riskLevel, regimeGateEnabled, btcCoin } =
      this.compositeRegimeService.resolveRegimeConfigForOptimization(config, allCoins, priceCtx);

    let peakValue = initialCapital;
    let maxDrawdown = 0;

    // Signal throttle
    const throttleConfig = this.signalThrottle.resolveConfig(config.parameters);
    const throttleState = this.signalThrottle.createState();

    // Reusable price map to avoid new Map() allocation per iteration
    const currentPriceMap = new Map<string, number>();

    // Reusable candle map to avoid new Map() allocation per iteration
    const candleMap = new Map<string, OHLCCandle>();

    // Track previous candle per coin for spread estimation context
    const prevCandleMap = new Map<string, OHLCCandle>();

    // Build callbacks for exit signal processing
    const exitCallbacks: ProcessExitSignalsCallbacks = {
      executeTradeFn,
      extractDailyVolumeFn: this.slippageContextService.extractDailyVolume.bind(this.slippageContextService),
      buildSpreadContextFn: this.slippageContextService.buildSpreadContext.bind(this.slippageContextService)
    };

    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = new Date(timestamps[i]);
      const currentPrices = pricesByTimestamp[timestamps[i]];

      currentPriceMap.clear();
      candleMap.clear();
      for (const price of currentPrices) {
        currentPriceMap.set(price.coinId, this.priceWindowService.getPriceValue(price));
        candleMap.set(price.coinId, price);
      }

      const marketData: MarketData = {
        timestamp,
        prices: currentPriceMap
      };

      portfolio = this.portfolioState.updateValues(portfolio, marketData.prices);

      const priceData = this.priceWindowService.advancePriceWindows(priceCtx, coins, timestamp);
      const priceDataByTimeframe = this.priceWindowService.advanceMultiTimeframeWindows(priceCtx, coins, timestamp);

      // Skip trading logic during warm-up period
      if (i < tradingStartIndex) {
        this.slippageContextService.updatePrevCandleMap(prevCandleMap, currentPrices);
        continue;
      }

      // Lightweight exit tracker check (no signal/fill recording).
      // `currentBar: i` is required so SL/TS exits register post-exit cooldowns —
      // without it, the optimizer scores exit params under different semantics than
      // the full backtest that will ultimately run these same parameters.
      if (exitTracker) {
        await this.exitSignalProcessor.processExitSignals(
          {
            exitTracker,
            currentPrices,
            marketData,
            portfolio,
            tradingFee,
            timestamp,
            trades,
            slippageConfig,
            prevCandleMap,
            currentBar: i
          },
          exitCallbacks
        );
      }

      // Compute regime for context + filtering
      const barRegimeResult = btcCoin ? this.compositeRegimeService.computeCompositeRegime(btcCoin.id, priceCtx) : null;

      // Lazy positions snapshot: only build when positions exist
      const positions =
        portfolio.positions.size > 0
          ? Object.fromEntries([...portfolio.positions.entries()].map(([id, position]) => [id, position.quantity]))
          : {};

      const hasHigherTimeframes = Object.keys(priceDataByTimeframe).length > 0;
      const context = {
        coins,
        priceData,
        timestamp,
        config: config.parameters,
        positions,
        availableBalance: portfolio.cashBalance,
        metadata: {
          isOptimization: true,
          algorithmId: config.algorithmId
        },
        precomputedIndicators,
        currentTimestampIndex: i,
        compositeRegime: barRegimeResult?.compositeRegime,
        volatilityRegime: barRegimeResult?.volatilityRegime,
        ...(hasHigherTimeframes && {
          priceDataByTimeframe: { [PriceTimeframe.HOURLY]: priceData, ...priceDataByTimeframe }
        })
      };

      let strategySignals: TradingSignal[] = [];
      try {
        const result = await this.algorithmRegistry.executeAlgorithm(config.algorithmId, context);
        if (result.success && result.signals?.length) {
          strategySignals = result.signals
            .map((s) => mapStrategySignal(s, result.exitConfig))
            .filter((signal) => signal.action !== 'HOLD');
        }
      } catch (error: unknown) {
        if (error instanceof AlgorithmNotRegisteredException) {
          throw error;
        }
        const err = toErrorInfo(error);
        this.logger.warn(`Algorithm execution failed at ${timestamp.toISOString()}: ${err.message}`);
      }

      // Apply signal throttle
      strategySignals = this.signalThrottle.filterSignals(
        strategySignals,
        throttleState,
        throttleConfig,
        timestamp.getTime()
      ).accepted;

      // Regime gate + regime-scaled position sizing
      if (btcCoin) {
        const { filteredSignals, barMaxAllocation, barMinAllocation } = this.compositeRegimeService.applyBarRegime(
          strategySignals,
          priceCtx,
          { btcCoin, regimeGateEnabled, enableRegimeScaledSizing, riskLevel },
          { maxAllocation: optAllocLimits.maxAllocation, minAllocation: optAllocLimits.minAllocation },
          barRegimeResult
        );
        strategySignals = filteredSignals;
        optMaxAllocation = barMaxAllocation;
        optMinAllocation = barMinAllocation;
      }

      // Re-entry cooldown filter: suppress BUYs on coins still inside the post-exit
      // cooldown window. Mirrors the historical path (backtest-bar-processor) so the
      // optimizer scores the same exit semantics as the full backtest.
      if (exitTracker) {
        strategySignals = strategySignals.filter((sig) => sig.action !== 'BUY' || exitTracker.canEnter(sig.coinId, i));
      }

      for (const strategySignal of strategySignals) {
        const dailyVolume = volumeMap.get(`${timestamps[i]}:${strategySignal.coinId}`);
        const spreadCtx = this.slippageContextService.buildSpreadContext(
          candleMap,
          strategySignal.coinId,
          prevCandleMap
        );

        const tradeResult = await executeTradeFn({
          signal: strategySignal,
          portfolio,
          marketData,
          tradingFee,
          slippageConfig,
          dailyVolume,
          minHoldMs: getMinHoldMs(config.riskLevel ?? DEFAULT_RISK_LEVEL),
          maxAllocation: optMaxAllocation,
          minAllocation: optMinAllocation,
          defaultLeverage: 1,
          spreadContext: spreadCtx
        });
        if (tradeResult && tradeResult.fillStatus !== SimulatedOrderStatus.CANCELLED) {
          trades.push({ ...tradeResult.trade, executedAt: timestamp });
          if (exitTracker && tradeResult.trade.price != null && tradeResult.trade.quantity != null) {
            if (strategySignal.action === 'BUY') {
              const rawAtr = strategySignal.metadata?.currentAtr;
              const currentAtr =
                typeof rawAtr === 'number' && Number.isFinite(rawAtr) && rawAtr > 0 ? rawAtr : undefined;
              exitTracker.onBuy(
                strategySignal.coinId,
                tradeResult.trade.price,
                tradeResult.trade.quantity,
                currentAtr,
                strategySignal.exitConfig
              );
            } else if (strategySignal.action === 'SELL') {
              exitTracker.onSell(strategySignal.coinId, tradeResult.trade.quantity);
            }
          }
        }
      }

      // Update previous candle map for spread estimation
      this.slippageContextService.updatePrevCandleMap(prevCandleMap, currentPrices);

      // Track peak and drawdown
      if (portfolio.totalValue > peakValue) {
        peakValue = portfolio.totalValue;
      }
      const currentDrawdown = peakValue === 0 ? 0 : Math.max(0, (peakValue - portfolio.totalValue) / peakValue);
      if (currentDrawdown > maxDrawdown) {
        maxDrawdown = currentDrawdown;
      }

      // Sample snapshots less frequently for optimization (every 24 periods)
      if (i % 24 === 0 || i === timestamps.length - 1) {
        snapshots.push({
          timestamp,
          portfolioValue: portfolio.totalValue
        });
      }
    }

    return calculateOptimizationMetrics(
      trades,
      snapshots,
      portfolio.totalValue,
      maxDrawdown,
      initialCapital,
      config.startDate,
      config.endDate,
      this.metricsCalculator
    );
  }
}
