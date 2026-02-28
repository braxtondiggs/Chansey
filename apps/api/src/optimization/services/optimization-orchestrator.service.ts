import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { DataSource, type FindOptionsWhere, type QueryDeepPartialEntity, Repository } from 'typeorm';

import { GridSearchService } from './grid-search.service';

import { Coin } from '../../coin/coin.entity';
import { SharpeRatioCalculator } from '../../common/metrics/sharpe-ratio.calculator';
import { OHLCCandle } from '../../ohlc/ohlc-candle.entity';
import { OHLCService } from '../../ohlc/ohlc.service';
import {
  BacktestEngine,
  OptimizationBacktestConfig,
  PrecomputedWindowData
} from '../../order/backtest/backtest-engine.service';
import { PIPELINE_EVENTS } from '../../pipeline/interfaces';
import { WalkForwardService, WalkForwardWindowConfig } from '../../scoring/walk-forward/walk-forward.service';
import { WindowProcessor } from '../../scoring/walk-forward/window-processor';
import { toErrorInfo } from '../../shared/error.util';
import { StrategyConfig } from '../../strategy/entities/strategy-config.entity';
import { sanitizeNumericValue } from '../../utils/validators/numeric-sanitizer';
import { OptimizationResult, WindowResult } from '../entities/optimization-result.entity';
import { OptimizationProgressDetails, OptimizationRun, OptimizationStatus } from '../entities/optimization-run.entity';
import { OptimizationConfig, ParameterSpace } from '../interfaces';

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
 * Optimization Orchestrator Service
 * Coordinates parameter optimization with walk-forward analysis
 */
@Injectable()
export class OptimizationOrchestratorService {
  private readonly logger = new Logger(OptimizationOrchestratorService.name);

  constructor(
    @InjectRepository(OptimizationRun)
    private readonly optimizationRunRepository: Repository<OptimizationRun>,
    @InjectRepository(OptimizationResult)
    private readonly optimizationResultRepository: Repository<OptimizationResult>,
    @InjectRepository(StrategyConfig)
    private readonly strategyConfigRepository: Repository<StrategyConfig>,
    @InjectRepository(Coin)
    private readonly coinRepository: Repository<Coin>,
    @InjectQueue('optimization')
    private readonly optimizationQueue: Queue,
    private readonly gridSearchService: GridSearchService,
    private readonly walkForwardService: WalkForwardService,
    private readonly windowProcessor: WindowProcessor,
    private readonly backtestEngine: BacktestEngine,
    private readonly ohlcService: OHLCService,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2
  ) {}

  /**
   * Validate optimization configuration before starting a run
   */
  private validateOptimizationConfig(config: OptimizationConfig): void {
    const errors: string[] = [];

    // Validate walk-forward configuration
    if (config.walkForward.trainDays < config.walkForward.testDays) {
      errors.push('trainDays must be >= testDays');
    }
    if (config.walkForward.trainDays <= 0) {
      errors.push('trainDays must be positive');
    }
    if (config.walkForward.testDays <= 0) {
      errors.push('testDays must be positive');
    }
    if (config.walkForward.stepDays <= 0) {
      errors.push('stepDays must be positive');
    }

    // Validate combination limits
    if (config.maxCombinations !== undefined && config.maxCombinations <= 0) {
      errors.push('maxCombinations must be positive');
    }
    if (config.maxIterations !== undefined && config.maxIterations <= 0) {
      errors.push('maxIterations must be positive');
    }

    // Validate early stopping config
    if (config.earlyStop?.enabled) {
      if (config.earlyStop.patience <= 0) {
        errors.push('patience must be positive when early stopping is enabled');
      }
      if (config.earlyStop.minImprovement !== undefined && config.earlyStop.minImprovement < 0) {
        errors.push('minImprovement cannot be negative');
      }
    }

    // Validate composite weights sum to 1.0
    if (config.objective.metric === 'composite' && config.objective.weights) {
      const sum = Object.values(config.objective.weights).reduce((a, b) => a + (b || 0), 0);
      if (Math.abs(sum - 1.0) > 0.001) {
        errors.push(`Composite weights must sum to 1.0 (current sum: ${sum.toFixed(3)})`);
      }
    }

    // Validate date range if provided
    if (config.dateRange) {
      const startDate = new Date(config.dateRange.startDate);
      const endDate = new Date(config.dateRange.endDate);
      if (startDate >= endDate) {
        errors.push('startDate must be before endDate');
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException(`Invalid optimization config: ${errors.join('; ')}`);
    }
  }

  /**
   * Start a new optimization run
   */
  async startOptimization(
    strategyConfigId: string,
    parameterSpace: ParameterSpace,
    config: OptimizationConfig
  ): Promise<OptimizationRun> {
    // Validate configuration before proceeding
    this.validateOptimizationConfig(config);

    // Validate strategy exists
    const strategyConfig = await this.strategyConfigRepository.findOne({
      where: { id: strategyConfigId }
    });

    if (!strategyConfig) {
      throw new NotFoundException(`Strategy config ${strategyConfigId} not found`);
    }

    // Generate parameter combinations
    const combinations =
      config.method === 'random_search'
        ? this.gridSearchService.generateRandomCombinations(parameterSpace, config.maxIterations || 100)
        : this.gridSearchService.generateCombinations(parameterSpace, config.maxCombinations);

    // Get baseline parameters
    const baselineCombination = combinations.find((c) => c.isBaseline);
    const baselineParameters = baselineCombination?.values || this.getDefaultParameters(parameterSpace);

    // Create optimization run (persist combinations for checkpoint-resume)
    const run = this.optimizationRunRepository.create({
      strategyConfigId,
      status: OptimizationStatus.PENDING,
      config,
      parameterSpace,
      baselineParameters,
      totalCombinations: combinations.length,
      combinationsTested: 0,
      combinations
    });

    const savedRun = await this.optimizationRunRepository.save(run);

    this.logger.log(
      `Created optimization run ${savedRun.id} for strategy ${strategyConfigId} with ${combinations.length} combinations`
    );

    // Queue the optimization job
    await this.optimizationQueue.add(
      'run-optimization',
      {
        runId: savedRun.id,
        combinations
      },
      {
        jobId: savedRun.id,
        removeOnComplete: true,
        attempts: 1
      }
    );

    return savedRun;
  }

  /**
   * Execute optimization (called by job processor)
   */
  async executeOptimization(
    runId: string,
    combinations: Array<{ index: number; values: Record<string, unknown>; isBaseline: boolean }>
  ): Promise<void> {
    const run = await this.optimizationRunRepository.findOne({
      where: { id: runId },
      relations: ['strategyConfig']
    });

    if (!run) {
      throw new NotFoundException(`Optimization run ${runId} not found`);
    }

    // Detect resume: preserve original startedAt if this is a resumed run
    const isResume = run.combinationsTested > 0;
    run.status = OptimizationStatus.RUNNING;
    if (!isResume) {
      run.startedAt = new Date();
    }
    run.lastHeartbeatAt = new Date();
    await this.optimizationRunRepository.save(run);

    // Load coins once at start of optimization run for thread safety
    // Filter by minimum data span required to fill walk-forward windows
    const minDataDays = run.config.walkForward.trainDays + run.config.walkForward.testDays;
    const coins = await this.loadCoinsForOptimization(run.config.maxCoins, minDataDays);
    this.logger.log(`Loaded ${coins.length} coins for optimization run ${runId}`);

    // Declare maps outside try so they can be cleaned up in finally
    const candlesByCoin = new Map<string, OHLCCandle[]>();
    const precomputedWindows = new Map<string, PrecomputedWindowData>();

    try {
      // Generate walk-forward windows
      const { startDate, endDate } = await this.getDateRange(run.config);
      const totalDays = this.daysBetween(startDate, endDate);

      // Adaptively reduce stepDays if the data span can't produce enough windows
      const { stepDays: adaptiveStepDays, adjusted: stepAdjusted } = this.computeAdaptiveStepDays(
        totalDays,
        run.config.walkForward.trainDays,
        run.config.walkForward.testDays,
        run.config.walkForward.stepDays,
        run.config.walkForward.minWindowsRequired
      );

      if (stepAdjusted) {
        this.logger.warn(
          `Adaptive step adjustment for run ${runId}: stepDays reduced from ` +
            `${run.config.walkForward.stepDays} to ${adaptiveStepDays} ` +
            `(data span: ${totalDays} days, need ${run.config.walkForward.minWindowsRequired} windows)`
        );
      }

      const windows = this.walkForwardService.generateWindows({
        startDate,
        endDate,
        trainDays: run.config.walkForward.trainDays,
        testDays: run.config.walkForward.testDays,
        stepDays: adaptiveStepDays,
        method: run.config.walkForward.method
      });

      if (windows.length < run.config.walkForward.minWindowsRequired) {
        throw new Error(
          `Insufficient windows: ${windows.length} generated, ${run.config.walkForward.minWindowsRequired} required. ` +
            `Data span: ${totalDays} days (${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}), ` +
            `trainDays=${run.config.walkForward.trainDays}, testDays=${run.config.walkForward.testDays}, stepDays=${adaptiveStepDays}`
        );
      }

      this.logger.log(`Generated ${windows.length} walk-forward windows for optimization run ${runId}`);

      // Compute warm-up days from parameter space to ensure indicators have valid values
      const warmupDays = this.computeWarmupDays(run.parameterSpace);

      // Pre-load all OHLC data once for the full date range across all windows
      const coinIds = coins.map((c) => c.id);
      const allWindowDates = windows.flatMap((w) => [w.trainStartDate, w.testEndDate]);
      const minDate = new Date(Math.min(...allWindowDates.map((d) => d.getTime())));
      const maxDate = new Date(Math.max(...allWindowDates.map((d) => d.getTime())));

      // Extend minDate backward by warmupDays to ensure warm-up candles are loaded
      const extendedMinDate = new Date(minDate.getTime() - warmupDays * 24 * 60 * 60 * 1000);

      let allCandles = await this.ohlcService.getCandlesByDateRange(coinIds, extendedMinDate, maxDate);
      this.logger.log(`Pre-loaded ${allCandles.length} candles for optimization run ${runId}`);

      if (allCandles.length > 500_000) {
        this.logger.warn(
          `Large candle dataset (${allCandles.length} rows) for optimization run ${runId}. ` +
            `Consider narrowing the date range or coin set to reduce memory usage.`
        );
      }

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

      // Pre-compute expensive per-window data once for all unique date ranges.
      // With 3 windows × 2 phases (train+test) = 6 unique ranges, this avoids
      // recomputing groupPricesByTimestamp, initPriceTracking, binary search, and volume maps
      // for every parameter combination (~74x reduction in redundant work).
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

      let bestScore = -Infinity;
      let bestParameters: Record<string, unknown> | null = null;
      let baselineScore = 0;
      let noImprovementCount = 0;
      let combinationsProcessed = 0;

      // Resume: reconstruct state from already-persisted results
      if (isResume) {
        const existingResults = await this.optimizationResultRepository.find({
          where: { optimizationRunId: runId },
          select: ['combinationIndex', 'avgTestScore', 'parameters', 'isBaseline']
        });

        const processedIndices = new Set(existingResults.map((r) => r.combinationIndex));
        combinations = combinations.filter((c) => !processedIndices.has(c.index));
        combinationsProcessed = existingResults.length;

        // Reconstruct best score/parameters from persisted results
        for (const result of existingResults) {
          if (result.isBaseline) {
            baselineScore = result.avgTestScore;
          }
          if (result.avgTestScore > bestScore) {
            bestScore = result.avgTestScore;
            bestParameters = result.parameters;
          }
        }

        this.logger.log(
          `Resumed optimization run ${runId}: ${combinationsProcessed} already processed, ` +
            `${combinations.length} remaining, best score: ${bestScore === -Infinity ? 'none' : bestScore.toFixed(4)}`
        );
      }

      // Heartbeat callback updates lastHeartbeatAt on the run entity
      const heartbeatFn = async () => {
        await this.optimizationRunRepository.update(run.id, {
          lastHeartbeatAt: new Date()
        } as QueryDeepPartialEntity<OptimizationRun>);
      };

      // Get parallelism config (default to 3 concurrent backtests)
      const maxConcurrent = run.config.parallelism?.maxConcurrentBacktests || 3;

      // Process combinations in parallel batches
      for (let batchStart = 0; batchStart < combinations.length; batchStart += maxConcurrent) {
        // Check if run was cancelled before starting batch
        const currentRun = await this.optimizationRunRepository.findOne({ where: { id: runId } });
        if (currentRun?.status === OptimizationStatus.CANCELLED) {
          this.logger.log(`Optimization run ${runId} was cancelled`);
          return;
        }

        // Get current batch
        const batchEnd = Math.min(batchStart + maxConcurrent, combinations.length);
        const batch = combinations.slice(batchStart, batchEnd);

        // Process batch in parallel
        const batchResults = await Promise.all(
          batch.map(async (combination) => {
            const evaluationResult = await this.evaluateCombination(
              run.strategyConfig,
              combination.values,
              windows,
              run.config,
              coins,
              candlesByCoin,
              heartbeatFn,
              precomputedWindows
            );
            return { combination, evaluationResult };
          })
        );

        // Process batch results in transaction for atomic commit
        await this.dataSource.transaction(async (manager) => {
          const sanitizeOpts = { maxIntegerDigits: 14 };
          for (const { combination, evaluationResult } of batchResults) {
            // Store result
            const result = manager.create(OptimizationResult, {
              optimizationRunId: runId,
              combinationIndex: combination.index,
              parameters: combination.values,
              avgTrainScore:
                sanitizeNumericValue(evaluationResult.avgTrainScore, {
                  ...sanitizeOpts,
                  fieldName: 'avgTrainScore'
                }) ?? 0,
              avgTestScore:
                sanitizeNumericValue(evaluationResult.avgTestScore, {
                  ...sanitizeOpts,
                  fieldName: 'avgTestScore'
                }) ?? 0,
              avgDegradation:
                sanitizeNumericValue(evaluationResult.avgDegradation, {
                  ...sanitizeOpts,
                  fieldName: 'avgDegradation'
                }) ?? 0,
              consistencyScore:
                sanitizeNumericValue(evaluationResult.consistencyScore, {
                  ...sanitizeOpts,
                  fieldName: 'consistencyScore'
                }) ?? 0,
              overfittingWindows: evaluationResult.overfittingWindows,
              windowResults: evaluationResult.windowResults,
              isBaseline: combination.isBaseline
            });

            await manager.save(OptimizationResult, result);

            // Track baseline score
            if (combination.isBaseline) {
              baselineScore = evaluationResult.avgTestScore;
            }

            // Track best score with minImprovement threshold for early stopping
            if (evaluationResult.avgTestScore > bestScore) {
              // Calculate improvement percentage
              const improvementPct =
                bestScore !== 0 ? ((evaluationResult.avgTestScore - bestScore) / Math.abs(bestScore)) * 100 : 100; // First improvement is always significant

              const minImprovement = run.config.earlyStop?.minImprovement ?? 0;

              // Only reset patience counter if improvement meets threshold
              if (improvementPct >= minImprovement) {
                noImprovementCount = 0; // Significant improvement - reset patience
              } else {
                noImprovementCount++; // Marginal improvement - continue counting
              }

              // Always update best score and parameters
              bestScore = evaluationResult.avgTestScore;
              bestParameters = combination.values;
            } else {
              noImprovementCount++;
            }

            combinationsProcessed++;
          }
        });

        // Release memory between batches to reduce peak RSS
        if (typeof global.gc === 'function') {
          global.gc();
        }

        // Update progress after each batch
        await this.updateProgress(run, combinationsProcessed, windows.length, bestScore, bestParameters);

        // Check early stopping after each batch
        if (run.config.earlyStop?.enabled && noImprovementCount >= run.config.earlyStop.patience) {
          this.logger.log(
            `Early stopping triggered after ${combinationsProcessed} combinations ` +
              `(no improvement for ${noImprovementCount} iterations)`
          );
          break;
        }
      }

      // Sync in-memory entity with actual count (updateProgress() used repository.update()
      // which doesn't update the in-memory entity, so save() would overwrite to 0)
      run.combinationsTested = combinationsProcessed;

      // Finalize run
      await this.finalizeOptimization(run, bestScore, bestParameters, baselineScore);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Optimization run ${runId} failed: ${err.message}`);
      run.status = OptimizationStatus.FAILED;
      run.errorMessage = err.message;
      run.completedAt = new Date();
      await this.optimizationRunRepository.save(run);

      this.eventEmitter.emit(PIPELINE_EVENTS.OPTIMIZATION_FAILED, {
        runId: run.id,
        reason: err.message
      });

      throw error;
    } finally {
      // Release pre-loaded candles and pre-computed windows to free memory
      // (runs on both success and error paths)
      candlesByCoin.clear();
      precomputedWindows.clear();
      if (typeof global.gc === 'function') {
        global.gc();
      }
    }
  }

  /**
   * Evaluate a single parameter combination through walk-forward analysis
   */
  async evaluateCombination(
    strategyConfig: StrategyConfig,
    parameters: Record<string, unknown>,
    windows: WalkForwardWindowConfig[],
    config: OptimizationConfig,
    coins: Coin[],
    preloadedCandlesByCoin?: Map<string, OHLCCandle[]>,
    heartbeatFn?: () => Promise<void>,
    precomputedWindows?: Map<string, PrecomputedWindowData>
  ): Promise<CombinationEvaluationResult> {
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
      const trainScore = this.calculateObjectiveScore(trainMetrics, config.objective);
      const testScore = this.calculateObjectiveScore(testMetrics, config.objective);

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
    const consistencyScore = this.calculateConsistencyScore(testScores);

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
  private async loadCoinsForOptimization(maxCoins = 20, minDataDays?: number): Promise<Coin[]> {
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
   * Execute a backtest for the given parameters and date range using the real backtest engine
   */
  private async executeBacktest(
    strategyConfig: StrategyConfig,
    parameters: Record<string, unknown>,
    startDate: Date,
    endDate: Date,
    coins: Coin[],
    preloadedCandlesByCoin?: Map<string, OHLCCandle[]>,
    precomputedData?: PrecomputedWindowData,
    riskLevel?: number
  ): Promise<import('@chansey/api-interfaces').WindowMetrics> {
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
   * Calculate objective score from metrics
   */
  private calculateObjectiveScore(
    metrics: import('@chansey/api-interfaces').WindowMetrics,
    objective: OptimizationConfig['objective']
  ): number {
    let score: number;

    switch (objective.metric) {
      case 'sharpe_ratio':
        score = metrics.sharpeRatio;
        break;
      case 'total_return':
        score = metrics.totalReturn;
        break;
      case 'calmar_ratio':
        score = metrics.maxDrawdown !== 0 ? metrics.totalReturn / Math.abs(metrics.maxDrawdown) : 0;
        break;
      case 'profit_factor':
        score = metrics.profitFactor || 1;
        break;
      case 'sortino_ratio': {
        // Sortino ratio: (Return - Risk Free Rate) / Downside Deviation
        // Uses 2% annual risk-free rate, consistent with Sharpe calculation
        const riskFreeRate = 0.02;
        if (!metrics.downsideDeviation || metrics.downsideDeviation === 0) {
          // Fallback to Sharpe when no downside volatility (all returns positive)
          score = metrics.sharpeRatio;
        } else {
          score = (metrics.totalReturn - riskFreeRate) / metrics.downsideDeviation;
        }
        break;
      }
      case 'composite':
        score = this.calculateCompositeScore(metrics, objective.weights);
        break;
      default:
        score = metrics.sharpeRatio;
    }

    // Guard non-finite values and clamp to prevent downstream overflow
    if (!Number.isFinite(score)) return 0;
    return Math.max(-SharpeRatioCalculator.MAX_SHARPE, Math.min(SharpeRatioCalculator.MAX_SHARPE, score));
  }

  /**
   * Calculate composite score from weighted metrics
   */
  private calculateCompositeScore(
    metrics: import('@chansey/api-interfaces').WindowMetrics,
    weights?: OptimizationConfig['objective']['weights']
  ): number {
    const w = weights || {
      sharpeRatio: 0.3,
      totalReturn: 0.25,
      calmarRatio: 0.15,
      profitFactor: 0.15,
      maxDrawdown: 0.1,
      winRate: 0.05
    };

    const calmarRatio = metrics.maxDrawdown !== 0 ? metrics.totalReturn / Math.abs(metrics.maxDrawdown) : 0;
    const norm = OptimizationOrchestratorService.METRIC_NORMALIZATION;

    // Helper to normalize a value to [0, 1] given its expected range
    const normalize = (value: number, range: { min: number; max: number }) =>
      Math.max(0, Math.min(1, (value - range.min) / (range.max - range.min)));

    // Normalize each metric to 0-1 scale using documented ranges
    const normalizedSharpe = normalize(metrics.sharpeRatio, norm.sharpeRatio);
    const normalizedReturn = normalize(metrics.totalReturn, norm.totalReturn);
    const normalizedCalmar = normalize(calmarRatio, norm.calmarRatio);
    const normalizedPF = normalize(metrics.profitFactor || 1, norm.profitFactor);
    const normalizedDD = normalize(metrics.maxDrawdown, norm.maxDrawdown);
    const normalizedWR = normalize(metrics.winRate, norm.winRate);

    return (
      normalizedSharpe * (w.sharpeRatio || 0) +
      normalizedReturn * (w.totalReturn || 0) +
      normalizedCalmar * (w.calmarRatio || 0) +
      normalizedPF * (w.profitFactor || 0) +
      normalizedDD * (w.maxDrawdown || 0) +
      normalizedWR * (w.winRate || 0)
    );
  }

  /**
   * Normalization ranges for composite score calculation.
   * Each metric is normalized to [0, 1] using: (value - min) / (max - min)
   */
  private static readonly METRIC_NORMALIZATION = {
    /** Sharpe ratio typically ranges from -1 (losing) to 3+ (excellent) */
    sharpeRatio: { min: -1, max: 3 },
    /** Total return as decimal, e.g., -50% to +50% */
    totalReturn: { min: -0.5, max: 0.5 },
    /** Calmar ratio (return / max drawdown) typically 0 to 3 */
    calmarRatio: { min: 0, max: 3 },
    /** Profit factor typically 0.5 (losing) to 3+ (excellent) */
    profitFactor: { min: 0.5, max: 3 },
    /** Max drawdown as negative decimal, -100% to 0% */
    maxDrawdown: { min: -1, max: 0 },
    /** Win rate already normalized as decimal 0.0 to 1.0 */
    winRate: { min: 0, max: 1 }
  };

  /**
   * Multiplier for converting standard deviation to consistency penalty.
   * Calibrated for scores typically in [-1, 3] range (e.g., Sharpe ratios):
   * - stdDev=0.0 → 100% consistency (perfect)
   * - stdDev=0.5 → 75% consistency (good)
   * - stdDev=1.0 → 50% consistency (moderate)
   * - stdDev=2.0 → 0% consistency (poor)
   */
  private static readonly CONSISTENCY_STDDEV_MULTIPLIER = 50;

  /**
   * Calculate consistency score based on variance of test scores.
   * Measures how stable performance is across different time windows.
   * Higher score = more consistent (lower variance).
   *
   * @param testScores Array of test scores from each walk-forward window
   * @returns Consistency score from 0-100 (100 = perfectly consistent)
   */
  private calculateConsistencyScore(testScores: number[]): number {
    if (testScores.length < 2) return 100;

    const mean = testScores.reduce((sum, s) => sum + s, 0) / testScores.length;
    const variance = testScores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / testScores.length;
    const stdDev = Math.sqrt(variance);

    // Lower standard deviation = higher consistency
    // Score of 100 at stdDev=0, decreasing as stdDev increases
    const consistencyScore = Math.max(0, 100 - stdDev * OptimizationOrchestratorService.CONSISTENCY_STDDEV_MULTIPLIER);
    return Math.round(consistencyScore * 100) / 100;
  }

  /**
   * Update optimization progress
   */
  private async updateProgress(
    run: OptimizationRun,
    combinationsTested: number,
    totalWindows: number,
    currentBestScore: number,
    currentBestParams: Record<string, unknown> | null
  ): Promise<void> {
    const elapsed = Date.now() - run.startedAt.getTime();
    const avgTimePerCombination = elapsed / combinationsTested;
    const remainingCombinations = run.totalCombinations - combinationsTested;
    const estimatedTimeRemaining = Math.round((avgTimePerCombination * remainingCombinations) / 1000);

    const progressDetails: OptimizationProgressDetails = {
      currentCombination: combinationsTested,
      // All windows are processed per combination; when updateProgress is called
      // after a batch, all windows for those combinations have completed
      currentWindow: totalWindows,
      totalWindows,
      estimatedTimeRemaining,
      lastUpdated: new Date(),
      currentBestScore,
      currentBestParams: currentBestParams || undefined,
      autoResumeCount: run.progressDetails?.autoResumeCount
    };

    await this.optimizationRunRepository.update(run.id, {
      combinationsTested,
      progressDetails,
      lastHeartbeatAt: new Date()
    } as QueryDeepPartialEntity<OptimizationRun>);
  }

  /**
   * Calculate improvement percentage with robust handling for negative/zero baselines.
   * - Floors denominator at max(|baselineScore|, 1) when baseline < 0 to prevent inflation
   * - When baseline=0 and best>0: returns min(bestScore * 100, 500) for meaningful signal
   * - When baseline=0 and best<=0: returns 0
   * - Caps all results at ±500%
   */
  calculateImprovement(bestScore: number, baselineScore: number): number {
    const MAX_IMPROVEMENT = 500;

    if (baselineScore === 0) {
      if (bestScore > 0) {
        return Math.min(bestScore * 100, MAX_IMPROVEMENT);
      }
      return 0;
    }

    // Floor denominator at 1 when baseline is negative to prevent inflation
    // (e.g., baseline=-0.78, best=1.23 would give 256% without flooring)
    const denominator = baselineScore < 0 ? Math.max(Math.abs(baselineScore), 1) : Math.abs(baselineScore);
    const improvement = ((bestScore - baselineScore) / denominator) * 100;

    return Math.max(-MAX_IMPROVEMENT, Math.min(MAX_IMPROVEMENT, improvement));
  }

  /**
   * Finalize optimization run
   */
  private async finalizeOptimization(
    run: OptimizationRun,
    bestScore: number,
    bestParameters: Record<string, unknown> | null,
    baselineScore: number
  ): Promise<void> {
    // Rank all results by composite score (consistency + overfit penalty)
    const rankedResults = await this.rankResults(run.id);

    // Re-derive best from rank-1 result (may differ from raw highest avgTestScore
    // because composite ranking penalizes low-consistency and overfitting results)
    const rank1 = rankedResults.length > 0 ? rankedResults[0] : null;
    if (rank1) {
      bestScore = rank1.avgTestScore;
      bestParameters = rank1.parameters as Record<string, unknown>;
    }

    // Calculate improvement using rank-1's score
    const improvement = this.calculateImprovement(bestScore, baselineScore);

    // Update run (sanitize scores to prevent numeric overflow on save)
    const sanitizeOpts = { maxIntegerDigits: 14 };
    run.status = OptimizationStatus.COMPLETED;
    run.bestScore = sanitizeNumericValue(bestScore, { ...sanitizeOpts, fieldName: 'bestScore' }) ?? 0;
    run.bestParameters = bestParameters ?? {};
    run.baselineScore = sanitizeNumericValue(baselineScore, { ...sanitizeOpts, fieldName: 'baselineScore' }) ?? 0;
    run.improvement =
      sanitizeNumericValue(Math.round(improvement * 100) / 100, { ...sanitizeOpts, fieldName: 'improvement' }) ?? 0;
    run.completedAt = new Date();

    await this.optimizationRunRepository.save(run);

    // Mark best result by ID (more reliable than JSON parameter matching)
    if (rank1) {
      await this.optimizationResultRepository
        .createQueryBuilder()
        .update(OptimizationResult)
        .set({ isBest: true })
        .where('id = :id', { id: rank1.id })
        .execute();
    }

    this.logger.log(
      `Optimization run ${run.id} completed. Best score: ${bestScore.toFixed(4)}, Improvement: ${improvement.toFixed(2)}%`
    );

    // Emit completion event for pipeline orchestrator
    this.eventEmitter.emit(PIPELINE_EVENTS.OPTIMIZATION_COMPLETED, {
      runId: run.id,
      strategyConfigId: run.strategyConfigId,
      bestParameters: bestParameters ?? {},
      bestScore,
      improvement: run.improvement
    });
  }

  /**
   * Compute a composite ranking score that balances raw performance with consistency.
   * - Consistency 100 → 1.0x multiplier, Consistency 0 → 0.6x
   * - Each overfitting window → -10% penalty (floor at 0.5x)
   */
  computeRankingScore(avgTestScore: number, consistencyScore: number, overfittingWindows: number): number {
    const consistencyMultiplier = 0.6 + 0.4 * (consistencyScore / 100);
    const overfitPenalty = Math.max(0.5, 1.0 - 0.1 * overfittingWindows);
    return avgTestScore * consistencyMultiplier * overfitPenalty;
  }

  /**
   * Rank all results by composite score (test score × consistency × overfit penalty)
   */
  private async rankResults(runId: string): Promise<OptimizationResult[]> {
    const results = await this.optimizationResultRepository.find({
      where: { optimizationRunId: runId }
    });

    // Sort by composite ranking score descending
    results.sort((a, b) => {
      const scoreA = this.computeRankingScore(a.avgTestScore, a.consistencyScore, a.overfittingWindows);
      const scoreB = this.computeRankingScore(b.avgTestScore, b.consistencyScore, b.overfittingWindows);
      return scoreB - scoreA;
    });

    for (let i = 0; i < results.length; i++) {
      results[i].rank = i + 1;
    }

    await this.optimizationResultRepository.save(results);
    return results;
  }

  /**
   * Get optimization progress
   */
  async getProgress(runId: string): Promise<{
    status: OptimizationStatus;
    combinationsTested: number;
    totalCombinations: number;
    percentComplete: number;
    estimatedTimeRemaining: number;
    currentBestScore: number | null;
  }> {
    const run = await this.optimizationRunRepository.findOne({ where: { id: runId } });

    if (!run) {
      throw new NotFoundException(`Optimization run ${runId} not found`);
    }

    const percentComplete = run.totalCombinations > 0 ? (run.combinationsTested / run.totalCombinations) * 100 : 0;

    return {
      status: run.status,
      combinationsTested: run.combinationsTested,
      totalCombinations: run.totalCombinations,
      percentComplete: Math.round(percentComplete * 100) / 100,
      estimatedTimeRemaining: run.progressDetails?.estimatedTimeRemaining || 0,
      currentBestScore: run.progressDetails?.currentBestScore || null
    };
  }

  /**
   * Cancel running optimization
   */
  async cancelOptimization(runId: string): Promise<void> {
    const run = await this.optimizationRunRepository.findOne({ where: { id: runId } });

    if (!run) {
      throw new NotFoundException(`Optimization run ${runId} not found`);
    }

    if (run.status !== OptimizationStatus.RUNNING && run.status !== OptimizationStatus.PENDING) {
      throw new Error(`Cannot cancel optimization in ${run.status} status`);
    }

    run.status = OptimizationStatus.CANCELLED;
    run.completedAt = new Date();
    await this.optimizationRunRepository.save(run);

    // Remove from queue if pending
    await this.optimizationQueue.remove(runId);

    this.logger.log(`Optimization run ${runId} cancelled`);
  }

  /**
   * Get date range for optimization.
   * Uses explicit config dateRange if provided, otherwise queries actual OHLC data bounds.
   * Falls back to last 3 months if no data exists.
   */
  private async getDateRange(config: OptimizationConfig): Promise<{ startDate: Date; endDate: Date }> {
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

  /**
   * Get default parameters from parameter space
   */
  private getDefaultParameters(space: ParameterSpace): Record<string, unknown> {
    const defaults: Record<string, unknown> = {};
    for (const param of space.parameters) {
      defaults[param.name] = param.default;
    }
    return defaults;
  }

  /** Regex matching parameter names that represent indicator lookback periods */
  private static readonly PERIOD_PARAM_PATTERN = /period|slow|fast|medium|signal|atr|lookback/i;

  /** Compound indicator param names that need extra lookback (e.g., MACD slow+signal) */
  private static readonly COMPOUND_PARAM_PATTERN = /slow|signal/i;

  /**
   * Compute the number of warm-up days needed from the parameter space.
   * Examines max values of period-like parameters, applies a 1.5× multiplier for
   * compound indicators (MACD slow+signal), adds 20% safety margin, and enforces
   * a minimum of 5 days.
   */
  computeWarmupDays(parameterSpace: ParameterSpace): number {
    const MIN_WARMUP_DAYS = 5;

    let maxPeriod = 0;
    let hasCompoundIndicator = false;

    for (const param of parameterSpace.parameters) {
      if (!OptimizationOrchestratorService.PERIOD_PARAM_PATTERN.test(param.name)) continue;

      // Use max from the parameter range, or default if no range
      const periodMax = param.max ?? (typeof param.default === 'number' ? param.default : 0);
      if (periodMax > maxPeriod) {
        maxPeriod = periodMax;
      }

      if (OptimizationOrchestratorService.COMPOUND_PARAM_PATTERN.test(param.name)) {
        hasCompoundIndicator = true;
      }
    }

    if (maxPeriod === 0) return MIN_WARMUP_DAYS;

    // Compound indicators need 1.5× the max period (e.g., MACD slow 26 + signal 9 ≈ 35)
    let warmupPeriods = hasCompoundIndicator ? maxPeriod * 1.5 : maxPeriod;

    // Add 20% safety margin
    warmupPeriods *= 1.2;

    // Convert periods to days (1 period = 1 day for daily OHLC data)
    return Math.max(MIN_WARMUP_DAYS, Math.ceil(warmupPeriods));
  }

  /**
   * Compute the number of days between two dates (rounded to nearest integer).
   */
  private daysBetween(date1: Date, date2: Date): number {
    const oneDay = 24 * 60 * 60 * 1000;
    return Math.round(Math.abs((date2.getTime() - date1.getTime()) / oneDay));
  }

  /**
   * Compute an adaptive stepDays that guarantees at least `minWindows` walk-forward windows
   * given the available data span. Uses the inverse of WalkForwardService.estimateWindowCount():
   *
   *   maxStepDays = floor((totalDays - trainDays - testDays) / (minWindows - 1))
   *
   * Returns min(configuredStepDays, maxStepDays) — never increases, only reduces.
   * Floors at 1 day minimum.
   *
   * @returns Object with `stepDays` (possibly reduced) and `adjusted` flag
   */
  computeAdaptiveStepDays(
    totalDays: number,
    trainDays: number,
    testDays: number,
    configuredStepDays: number,
    minWindows: number
  ): { stepDays: number; adjusted: boolean } {
    // When minWindows <= 1, a single window needs no stepping at all
    if (minWindows <= 1) {
      return { stepDays: configuredStepDays, adjusted: false };
    }

    // WalkForwardService.generateWindows() inserts a +1 day gap between
    // trainEnd and testStart, so the effective window footprint is
    // trainDays + 1 + testDays, not trainDays + testDays.
    const windowSize = trainDays + 1 + testDays;

    // Not enough data for even one window — return configured value unchanged
    // (will fail at window generation with a clear error)
    if (totalDays < windowSize) {
      return { stepDays: configuredStepDays, adjusted: false };
    }

    const maxStepDays = Math.floor((totalDays - windowSize) / (minWindows - 1));
    const adaptiveStep = Math.max(1, Math.min(configuredStepDays, maxStepDays));

    return {
      stepDays: adaptiveStep,
      adjusted: adaptiveStep < configuredStepDays
    };
  }

  /**
   * Get optimization run by ID
   */
  async getOptimizationRun(runId: string): Promise<OptimizationRun> {
    const run = await this.optimizationRunRepository.findOne({
      where: { id: runId },
      relations: ['strategyConfig']
    });

    if (!run) {
      throw new NotFoundException(`Optimization run ${runId} not found`);
    }

    return run;
  }

  /**
   * Get optimization results
   */
  async getResults(
    runId: string,
    limit = 20,
    sortBy: 'testScore' | 'degradation' | 'consistency' = 'testScore'
  ): Promise<OptimizationResult[]> {
    const orderField =
      sortBy === 'testScore' ? 'avgTestScore' : sortBy === 'degradation' ? 'avgDegradation' : 'consistencyScore';

    const order = sortBy === 'degradation' ? 'ASC' : 'DESC';

    return this.optimizationResultRepository.find({
      where: { optimizationRunId: runId },
      order: { [orderField]: order },
      take: limit
    });
  }

  /**
   * List optimization runs for a strategy
   */
  async listOptimizationRuns(strategyConfigId: string, status?: OptimizationStatus): Promise<OptimizationRun[]> {
    const where: FindOptionsWhere<OptimizationRun> = { strategyConfigId };
    if (status) {
      where.status = status;
    }

    return this.optimizationRunRepository.find({
      where,
      order: { createdAt: 'DESC' }
    });
  }

  /**
   * Apply best parameters to strategy
   */
  async applyBestParameters(runId: string): Promise<StrategyConfig> {
    const run = await this.optimizationRunRepository.findOne({
      where: { id: runId },
      relations: ['strategyConfig']
    });

    if (!run) {
      throw new NotFoundException(`Optimization run ${runId} not found`);
    }

    if (run.status !== OptimizationStatus.COMPLETED) {
      throw new Error('Cannot apply parameters from incomplete optimization run');
    }

    if (!run.bestParameters) {
      throw new Error('No best parameters found');
    }

    // Update strategy config with best parameters
    const strategyConfig = run.strategyConfig;
    strategyConfig.parameters = {
      ...strategyConfig.parameters,
      ...run.bestParameters
    };

    await this.strategyConfigRepository.save(strategyConfig);

    this.logger.log(`Applied best parameters from optimization run ${runId} to strategy ${strategyConfig.id}`);

    return strategyConfig;
  }
}
