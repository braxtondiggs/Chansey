import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { WindowMetrics } from '@chansey/api-interfaces';

import { Coin } from '../../coin/coin.entity';
import { OHLCCandle } from '../../ohlc/ohlc-candle.entity';
import { OHLCService } from '../../ohlc/ohlc.service';
import {
  BacktestEngine,
  OptimizationBacktestConfig,
  PrecomputedWindowData
} from '../../order/backtest/backtest-engine.service';
import { WalkForwardService, WalkForwardWindowConfig } from '../../scoring/walk-forward/walk-forward.service';
import { WindowProcessor } from '../../scoring/walk-forward/window-processor';
import { toErrorInfo } from '../../shared/error.util';
import { WindowResult } from '../entities/optimization-result.entity';
import { OptimizationConfig, ParameterSpace } from '../interfaces';
import { computeAdaptiveStepDays, computeWarmupDays, daysBetween } from '../utils/optimization-calc.util';
import { calculateConsistencyScore, calculateObjectiveScore } from '../utils/optimization-scoring.util';

/**
 * Evaluation result for a single parameter combination
 */
export interface CombinationEvaluationResult {
  avgTrainScore: number;
  avgTestScore: number;
  avgDegradation: number;
  consistencyScore: number;
  overfittingWindows: number;
  windowResults: WindowResult[];
}

/**
 * Parameters for evaluating a single parameter combination
 */
export interface EvaluateCombinationParams {
  strategyConfig: { id: string; algorithmId: string };
  parameters: Record<string, unknown>;
  windows: WalkForwardWindowConfig[];
  config: OptimizationConfig;
  coins: Coin[];
  preloadedCandlesByCoin?: Map<string, OHLCCandle[]>;
  heartbeatFn?: () => Promise<void>;
  precomputedWindows?: Map<string, PrecomputedWindowData>;
}

/**
 * Service responsible for evaluating parameter combinations through backtesting
 * and preparing data for optimization runs.
 */
@Injectable()
export class OptimizationEvaluationService {
  private readonly logger = new Logger(OptimizationEvaluationService.name);

  constructor(
    @InjectRepository(Coin)
    private readonly coinRepository: Repository<Coin>,
    private readonly backtestEngine: BacktestEngine,
    private readonly windowProcessor: WindowProcessor,
    private readonly ohlcService: OHLCService,
    private readonly walkForwardService: WalkForwardService
  ) {}

  /**
   * Evaluate a single parameter combination through walk-forward analysis
   */
  async evaluateCombination(params: EvaluateCombinationParams): Promise<CombinationEvaluationResult> {
    const {
      strategyConfig,
      parameters,
      windows,
      config,
      coins,
      preloadedCandlesByCoin,
      heartbeatFn,
      precomputedWindows
    } = params;

    const windowResults: WindowResult[] = [];
    let totalTrainScore = 0;
    let totalTestScore = 0;
    let totalDegradation = 0;
    let overfittingWindows = 0;

    for (const window of windows) {
      // Build window keys for pre-computed data lookup
      const trainKey = `${window.trainStartDate.getTime()}-${window.trainEndDate.getTime()}`;
      const testKey = `${window.testStartDate.getTime()}-${window.testEndDate.getTime()}`;
      const trainPrecomputed = precomputedWindows?.get(trainKey);
      const testPrecomputed = precomputedWindows?.get(testKey);

      // Execute train and test backtests in parallel (independent date ranges, no shared state)
      const [trainMetrics, testMetrics] = await Promise.all([
        this.executeBacktest(
          strategyConfig,
          parameters,
          window.trainStartDate,
          window.trainEndDate,
          coins,
          preloadedCandlesByCoin,
          trainPrecomputed,
          config.riskLevel
        ),
        this.executeBacktest(
          strategyConfig,
          parameters,
          window.testStartDate,
          window.testEndDate,
          coins,
          preloadedCandlesByCoin,
          testPrecomputed,
          config.riskLevel
        )
      ]);

      // Calculate scores based on objective
      const trainScore = calculateObjectiveScore(trainMetrics, config.objective);
      const testScore = calculateObjectiveScore(testMetrics, config.objective);

      // Process window for degradation analysis
      const windowProcessingResult = await this.windowProcessor.processWindow(window, trainMetrics, testMetrics);

      windowResults.push({
        windowIndex: window.windowIndex,
        trainScore,
        testScore,
        degradation: windowProcessingResult.degradation,
        overfitting: windowProcessingResult.overfittingDetected,
        trainStartDate: window.trainStartDate.toISOString().split('T')[0],
        trainEndDate: window.trainEndDate.toISOString().split('T')[0],
        testStartDate: window.testStartDate.toISOString().split('T')[0],
        testEndDate: window.testEndDate.toISOString().split('T')[0]
      });

      totalTrainScore += trainScore;
      totalTestScore += testScore;
      totalDegradation += windowProcessingResult.degradation;

      if (windowProcessingResult.overfittingDetected) {
        overfittingWindows++;
      }

      if (heartbeatFn) {
        await heartbeatFn();
      }
    }

    const avgTrainScore = totalTrainScore / windows.length;
    const avgTestScore = totalTestScore / windows.length;
    const avgDegradation = totalDegradation / windows.length;

    // Calculate consistency score (lower variance = higher consistency)
    const testScores = windowResults.map((w) => w.testScore);
    const consistencyScore = calculateConsistencyScore(testScores);

    return {
      avgTrainScore,
      avgTestScore,
      avgDegradation,
      consistencyScore,
      overfittingWindows,
      windowResults
    };
  }

  /**
   * Load coins for optimization run - called once at start of optimization.
   * Only returns coins that have OHLC candle data, ranked by market cap.
   * @param maxCoins Maximum coins to return (default 20)
   * @param minDataDays Minimum days of OHLC data span required (filters coins with insufficient history)
   */
  async loadCoinsForOptimization(maxCoins = 20, minDataDays?: number): Promise<Coin[]> {
    // Base filter: coin must have OHLC data
    const ohlcExistsSubquery = `EXISTS (SELECT 1 FROM ohlc_candles c WHERE c."coinId" = coin.id)`;

    // Additional filter: coin must have enough data span for walk-forward windows
    const ohlcSpanCondition = minDataDays
      ? `(SELECT EXTRACT(EPOCH FROM MAX(c.timestamp) - MIN(c.timestamp)) / 86400 ` +
        `FROM ohlc_candles c WHERE c."coinId" = coin.id) >= :minDataDays`
      : null;

    // Load coins ranked by market cap, filtered to only those with sufficient OHLC data
    let qb = this.coinRepository
      .createQueryBuilder('coin')
      .where(ohlcExistsSubquery)
      .andWhere('coin.marketRank IS NOT NULL');

    if (ohlcSpanCondition) {
      qb = qb.andWhere(ohlcSpanCondition, { minDataDays });
    }

    let coins = await qb.orderBy('coin.marketRank', 'ASC').take(maxCoins).getMany();

    if (coins.length === 0) {
      // Fallback: get any coins with sufficient OHLC data (no market rank filter)
      let fallbackQb = this.coinRepository.createQueryBuilder('coin').where(ohlcExistsSubquery);
      if (ohlcSpanCondition) {
        fallbackQb = fallbackQb.andWhere(ohlcSpanCondition, { minDataDays });
      }
      coins = await fallbackQb.take(maxCoins).getMany();
    }

    if (coins.length === 0) {
      const spanMsg = minDataDays ? ` with >= ${minDataDays} days of data` : '';
      throw new Error(`No coins${spanMsg} available for optimization. Ensure OHLC sync has run.`);
    }

    this.logger.log(
      `Filtered to ${coins.length} coins with OHLC data (max ${maxCoins}${minDataDays ? `, min ${minDataDays} days` : ''})`
    );

    return coins;
  }

  /**
   * Pre-load all OHLC candle data and build a coin-indexed map for efficient lookups.
   */
  async loadAndIndexCandles(
    coinIds: string[],
    extendedMinDate: Date,
    maxDate: Date,
    runId: string
  ): Promise<{ candlesByCoin: Map<string, OHLCCandle[]>; allCandleCount: number }> {
    const candlesByCoin = new Map<string, OHLCCandle[]>();

    let allCandles = await this.ohlcService.getCandlesByDateRange(coinIds, extendedMinDate, maxDate);
    this.logger.log(`Pre-loaded ${allCandles.length} candles for optimization run ${runId}`);

    if (allCandles.length > 500_000) {
      this.logger.warn(
        `Large candle dataset (${allCandles.length} rows) for optimization run ${runId}. ` +
          `Consider narrowing the date range or coin set to reduce memory usage.`
      );
    }

    const allCandleCount = allCandles.length;

    // Build coin-indexed map for O(log N) range lookups (each array is already sorted by timestamp from DB)
    for (const candle of allCandles) {
      let arr = candlesByCoin.get(candle.coinId);
      if (!arr) {
        arr = [];
        candlesByCoin.set(candle.coinId, arr);
      }
      arr.push(candle);
    }
    // Release flat array immediately — the map now owns the data
    allCandles = [];

    return { candlesByCoin, allCandleCount };
  }

  /**
   * Pre-compute expensive per-window data once for all unique date ranges.
   * Avoids recomputing groupPricesByTimestamp, initPriceTracking, binary search, and volume maps
   * for every parameter combination.
   */
  precomputeAllWindowData(
    windows: WalkForwardWindowConfig[],
    coins: Coin[],
    candlesByCoin: Map<string, OHLCCandle[]>,
    warmupDays: number,
    extendedMinDate: Date,
    runId: string
  ): Map<string, PrecomputedWindowData> {
    const precomputedWindows = new Map<string, PrecomputedWindowData>();
    const warmupMs = warmupDays * 24 * 60 * 60 * 1000;

    for (const window of windows) {
      const ranges = [
        { start: window.trainStartDate, end: window.trainEndDate },
        { start: window.testStartDate, end: window.testEndDate }
      ];
      for (const { start, end } of ranges) {
        const key = `${start.getTime()}-${end.getTime()}`;
        if (!precomputedWindows.has(key)) {
          // Extend start backward by warmup period, clamped to available data
          const warmupStart = new Date(Math.max(start.getTime() - warmupMs, extendedMinDate.getTime()));
          const precomputed = this.backtestEngine.precomputeWindowData(coins, candlesByCoin, warmupStart, end);

          // Compute tradingStartIndex: first timestamp >= original start date
          const originalStartMs = start.getTime();
          let tradingStartIdx = 0;
          for (let t = 0; t < precomputed.timestamps.length; t++) {
            if (new Date(precomputed.timestamps[t]).getTime() >= originalStartMs) {
              tradingStartIdx = t;
              break;
            }
          }
          precomputed.tradingStartIndex = tradingStartIdx;

          precomputedWindows.set(key, precomputed);
        }
      }
    }

    this.logger.log(
      `Pre-computed ${precomputedWindows.size} window data sets for optimization run ${runId} ` +
        `(warmup: ${warmupDays} days)`
    );

    return precomputedWindows;
  }

  /**
   * Execute a backtest for the given parameters and date range using the real backtest engine
   */
  private async executeBacktest(
    strategyConfig: { id: string; algorithmId: string },
    parameters: Record<string, unknown>,
    startDate: Date,
    endDate: Date,
    coins: Coin[],
    preloadedCandlesByCoin?: Map<string, OHLCCandle[]>,
    precomputedData?: PrecomputedWindowData,
    riskLevel?: number
  ): Promise<WindowMetrics> {
    // Build optimization backtest config
    const backtestConfig: OptimizationBacktestConfig = {
      algorithmId: strategyConfig.algorithmId,
      parameters,
      startDate,
      endDate,
      initialCapital: 10000,
      tradingFee: 0.001,
      riskLevel,
      enableRegimeScaledSizing: true
    };

    try {
      // Prefer pre-computed fast path, fall back to existing paths
      const result = precomputedData
        ? await this.backtestEngine.runOptimizationBacktestWithPrecomputed(backtestConfig, coins, precomputedData)
        : preloadedCandlesByCoin
          ? await this.backtestEngine.executeOptimizationBacktestWithData(backtestConfig, coins, preloadedCandlesByCoin)
          : await this.backtestEngine.executeOptimizationBacktest(backtestConfig, coins);

      return {
        sharpeRatio: result.sharpeRatio,
        totalReturn: result.totalReturn,
        maxDrawdown: result.maxDrawdown,
        winRate: result.winRate,
        volatility: result.volatility,
        profitFactor: result.profitFactor,
        tradeCount: result.tradeCount,
        downsideDeviation: result.downsideDeviation
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      throw new Error(`Backtest failed for ${startDate.toISOString()}-${endDate.toISOString()}: ${err.message}`);
    }
  }

  /**
   * Prepare walk-forward windows, candle data, and pre-computed window data for an optimization run.
   * Consolidates adaptive step calculation, window generation, validation, candle loading, and precomputation.
   */
  async prepareWalkForwardData(params: {
    config: OptimizationConfig;
    parameterSpace: ParameterSpace;
    coins: Coin[];
    runId: string;
    dateRange: { startDate: Date; endDate: Date };
  }): Promise<{
    windows: WalkForwardWindowConfig[];
    candlesByCoin: Map<string, OHLCCandle[]>;
    precomputedWindows: Map<string, PrecomputedWindowData>;
    warmupDays: number;
  }> {
    const { config, parameterSpace, coins, runId, dateRange } = params;
    const { startDate, endDate } = dateRange;
    const totalDays = daysBetween(startDate, endDate);

    // Adaptively reduce stepDays if the data span can't produce enough windows
    const { stepDays: adaptiveStepDays, adjusted: stepAdjusted } = computeAdaptiveStepDays(
      totalDays,
      config.walkForward.trainDays,
      config.walkForward.testDays,
      config.walkForward.stepDays,
      config.walkForward.minWindowsRequired
    );

    if (stepAdjusted) {
      this.logger.warn(
        `Adaptive step adjustment for run ${runId}: stepDays reduced from ` +
          `${config.walkForward.stepDays} to ${adaptiveStepDays} ` +
          `(data span: ${totalDays} days, need ${config.walkForward.minWindowsRequired} windows)`
      );
    }

    const windows = this.walkForwardService.generateWindows({
      startDate,
      endDate,
      trainDays: config.walkForward.trainDays,
      testDays: config.walkForward.testDays,
      stepDays: adaptiveStepDays,
      method: config.walkForward.method
    });

    if (windows.length < config.walkForward.minWindowsRequired) {
      throw new Error(
        `Insufficient windows: ${windows.length} generated, ${config.walkForward.minWindowsRequired} required. ` +
          `Data span: ${totalDays} days (${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}), ` +
          `trainDays=${config.walkForward.trainDays}, testDays=${config.walkForward.testDays}, stepDays=${adaptiveStepDays}`
      );
    }

    this.logger.log(`Generated ${windows.length} walk-forward windows for optimization run ${runId}`);

    // Compute warm-up days from parameter space to ensure indicators have valid values
    const warmupDays = computeWarmupDays(parameterSpace);

    // Pre-load all OHLC data once for the full date range across all windows
    const coinIds = coins.map((c) => c.id);
    const allWindowDates = windows.flatMap((w) => [w.trainStartDate, w.testEndDate]);
    const minDate = new Date(Math.min(...allWindowDates.map((d) => d.getTime())));
    const maxDate = new Date(Math.max(...allWindowDates.map((d) => d.getTime())));

    // Extend minDate backward by warmupDays to ensure warm-up candles are loaded
    const extendedMinDate = new Date(minDate.getTime() - warmupDays * 24 * 60 * 60 * 1000);

    const { candlesByCoin } = await this.loadAndIndexCandles(coinIds, extendedMinDate, maxDate, runId);

    // Pre-compute expensive per-window data once for all unique date ranges
    const precomputedWindows = this.precomputeAllWindowData(
      windows,
      coins,
      candlesByCoin,
      warmupDays,
      extendedMinDate,
      runId
    );

    return { windows, candlesByCoin, precomputedWindows, warmupDays };
  }

  /**
   * Get date range for optimization.
   * Uses explicit config dateRange if provided, otherwise queries actual OHLC data bounds.
   * Falls back to last 3 months if no data exists.
   */
  async getDateRange(config: OptimizationConfig): Promise<{ startDate: Date; endDate: Date }> {
    if (config.dateRange) {
      return {
        startDate: new Date(config.dateRange.startDate),
        endDate: new Date(config.dateRange.endDate)
      };
    }

    // Query actual OHLC data bounds instead of assuming 3 years
    const dataRange = await this.ohlcService.getCandleDataDateRange();
    if (dataRange) {
      this.logger.log(
        `Using actual OHLC data bounds: ${dataRange.start.toISOString()} to ${dataRange.end.toISOString()}`
      );
      return { startDate: dataRange.start, endDate: dataRange.end };
    }

    // Last-resort fallback: last 3 months
    this.logger.warn('No OHLC data found, falling back to 3-month date range');
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 3);

    return { startDate, endDate };
  }
}
