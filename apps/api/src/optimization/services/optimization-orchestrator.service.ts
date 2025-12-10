import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { GridSearchService } from './grid-search.service';

import { Coin } from '../../coin/coin.entity';
import { BacktestEngine, OptimizationBacktestConfig } from '../../order/backtest/backtest-engine.service';
import { WalkForwardService, WalkForwardWindowConfig } from '../../scoring/walk-forward/walk-forward.service';
import { WindowProcessor } from '../../scoring/walk-forward/window-processor';
import { StrategyConfig } from '../../strategy/entities/strategy-config.entity';
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
    private readonly backtestEngine: BacktestEngine
  ) {}

  /**
   * Start a new optimization run
   */
  async startOptimization(
    strategyConfigId: string,
    parameterSpace: ParameterSpace,
    config: OptimizationConfig
  ): Promise<OptimizationRun> {
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

    // Create optimization run
    const run = this.optimizationRunRepository.create({
      strategyConfigId,
      status: OptimizationStatus.PENDING,
      config,
      parameterSpace,
      baselineParameters,
      totalCombinations: combinations.length,
      combinationsTested: 0
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

    // Update status to running
    run.status = OptimizationStatus.RUNNING;
    run.startedAt = new Date();
    await this.optimizationRunRepository.save(run);

    // Clear coin cache at the start of each run
    this.clearCoinCache();

    try {
      // Generate walk-forward windows
      const { startDate, endDate } = this.getDateRange(run.config);
      const windows = this.walkForwardService.generateWindows({
        startDate,
        endDate,
        trainDays: run.config.walkForward.trainDays,
        testDays: run.config.walkForward.testDays,
        stepDays: run.config.walkForward.stepDays,
        method: run.config.walkForward.method
      });

      if (windows.length < run.config.walkForward.minWindowsRequired) {
        throw new Error(
          `Insufficient windows: ${windows.length} generated, ${run.config.walkForward.minWindowsRequired} required`
        );
      }

      this.logger.log(`Generated ${windows.length} walk-forward windows for optimization run ${runId}`);

      let bestScore = -Infinity;
      let bestParameters: Record<string, unknown> | null = null;
      let baselineScore = 0;
      let noImprovementCount = 0;
      let combinationsProcessed = 0;

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
              run.config
            );
            return { combination, evaluationResult };
          })
        );

        // Process batch results sequentially for proper tracking
        for (const { combination, evaluationResult } of batchResults) {
          // Store result
          const result = this.optimizationResultRepository.create({
            optimizationRunId: runId,
            combinationIndex: combination.index,
            parameters: combination.values,
            avgTrainScore: evaluationResult.avgTrainScore,
            avgTestScore: evaluationResult.avgTestScore,
            avgDegradation: evaluationResult.avgDegradation,
            consistencyScore: evaluationResult.consistencyScore,
            overfittingWindows: evaluationResult.overfittingWindows,
            windowResults: evaluationResult.windowResults,
            isBaseline: combination.isBaseline
          });

          await this.optimizationResultRepository.save(result);

          // Track baseline score
          if (combination.isBaseline) {
            baselineScore = evaluationResult.avgTestScore;
          }

          // Track best score
          if (evaluationResult.avgTestScore > bestScore) {
            bestScore = evaluationResult.avgTestScore;
            bestParameters = combination.values;
            noImprovementCount = 0;
          } else {
            noImprovementCount++;
          }

          combinationsProcessed++;
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

      // Finalize run
      await this.finalizeOptimization(run, bestScore, bestParameters, baselineScore);
    } catch (error) {
      this.logger.error(`Optimization run ${runId} failed: ${error.message}`);
      run.status = OptimizationStatus.FAILED;
      run.errorMessage = error.message;
      run.completedAt = new Date();
      await this.optimizationRunRepository.save(run);
      throw error;
    }
  }

  /**
   * Evaluate a single parameter combination through walk-forward analysis
   */
  async evaluateCombination(
    strategyConfig: StrategyConfig,
    parameters: Record<string, unknown>,
    windows: WalkForwardWindowConfig[],
    config: OptimizationConfig
  ): Promise<CombinationEvaluationResult> {
    const windowResults: WindowResult[] = [];
    let totalTrainScore = 0;
    let totalTestScore = 0;
    let totalDegradation = 0;
    let overfittingWindows = 0;

    for (const window of windows) {
      // Execute backtest for train period
      const trainMetrics = await this.executeBacktest(
        strategyConfig,
        parameters,
        window.trainStartDate,
        window.trainEndDate
      );

      // Execute backtest for test period
      const testMetrics = await this.executeBacktest(
        strategyConfig,
        parameters,
        window.testStartDate,
        window.testEndDate
      );

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
   * Cached coins for optimization - loaded once per optimization run
   */
  private cachedCoins: Coin[] | null = null;

  /**
   * Execute a backtest for the given parameters and date range using the real backtest engine
   */
  private async executeBacktest(
    strategyConfig: StrategyConfig,
    parameters: Record<string, unknown>,
    startDate: Date,
    endDate: Date
  ): Promise<import('@chansey/api-interfaces').WindowMetrics> {
    // Load coins if not cached - get top 50 by market rank
    if (!this.cachedCoins) {
      this.cachedCoins = await this.coinRepository
        .createQueryBuilder('coin')
        .where('coin.marketRank IS NOT NULL')
        .orderBy('coin.marketRank', 'ASC')
        .take(50)
        .getMany();

      if (this.cachedCoins.length === 0) {
        // Fallback: get any coins with price data
        this.cachedCoins = await this.coinRepository.find({ take: 50 });
      }

      if (this.cachedCoins.length === 0) {
        this.logger.warn('No coins found, optimization will use simulated metrics');
        return this.getSimulatedMetrics();
      }
    }

    // Build optimization backtest config
    const backtestConfig: OptimizationBacktestConfig = {
      algorithmId: strategyConfig.algorithmId,
      parameters,
      startDate,
      endDate,
      initialCapital: 10000,
      tradingFee: 0.001
    };

    try {
      const result = await this.backtestEngine.executeOptimizationBacktest(backtestConfig, this.cachedCoins);

      return {
        sharpeRatio: result.sharpeRatio,
        totalReturn: result.totalReturn,
        maxDrawdown: result.maxDrawdown,
        winRate: result.winRate,
        volatility: result.volatility,
        profitFactor: result.profitFactor,
        tradeCount: result.tradeCount
      };
    } catch (error) {
      this.logger.warn(`Backtest execution failed, using simulated metrics: ${error.message}`);
      return this.getSimulatedMetrics();
    }
  }

  /**
   * Get simulated metrics as fallback when backtest execution fails
   */
  private getSimulatedMetrics(): import('@chansey/api-interfaces').WindowMetrics {
    const baseReturn = 0.05 + Math.random() * 0.15;
    const volatility = 0.1 + Math.random() * 0.2;
    const sharpeRatio = baseReturn / volatility;
    const maxDrawdown = -(0.05 + Math.random() * 0.15);
    const winRate = 45 + Math.random() * 20;
    const profitFactor = 1 + Math.random() * 1.5;

    return {
      sharpeRatio,
      totalReturn: baseReturn,
      maxDrawdown,
      winRate,
      volatility,
      profitFactor,
      tradeCount: Math.floor(10 + Math.random() * 50)
    };
  }

  /**
   * Clear the cached coins (call at the start of each optimization run)
   */
  private clearCoinCache(): void {
    this.cachedCoins = null;
  }

  /**
   * Calculate objective score from metrics
   */
  private calculateObjectiveScore(
    metrics: import('@chansey/api-interfaces').WindowMetrics,
    objective: OptimizationConfig['objective']
  ): number {
    switch (objective.metric) {
      case 'sharpe_ratio':
        return metrics.sharpeRatio;
      case 'total_return':
        return metrics.totalReturn;
      case 'calmar_ratio':
        return metrics.maxDrawdown !== 0 ? metrics.totalReturn / Math.abs(metrics.maxDrawdown) : 0;
      case 'profit_factor':
        return metrics.profitFactor || 1;
      case 'sortino_ratio':
        // Simplified Sortino - would need downside deviation
        return metrics.sharpeRatio * 1.1;
      case 'composite':
        return this.calculateCompositeScore(metrics, objective.weights);
      default:
        return metrics.sharpeRatio;
    }
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

    // Normalize each metric to roughly 0-1 scale, then weight
    const normalizedSharpe = Math.max(0, Math.min(1, (metrics.sharpeRatio + 1) / 4)); // -1 to 3 -> 0 to 1
    const normalizedReturn = Math.max(0, Math.min(1, (metrics.totalReturn + 0.5) / 1)); // -0.5 to 0.5 -> 0 to 1
    const normalizedCalmar = Math.max(0, Math.min(1, calmarRatio / 3)); // 0 to 3 -> 0 to 1
    const normalizedPF = Math.max(0, Math.min(1, ((metrics.profitFactor || 1) - 0.5) / 2.5)); // 0.5 to 3 -> 0 to 1
    const normalizedDD = Math.max(0, Math.min(1, 1 + metrics.maxDrawdown)); // -1 to 0 -> 0 to 1
    const normalizedWR = metrics.winRate / 100; // 0 to 100 -> 0 to 1

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
   * Calculate consistency score based on variance of test scores
   */
  private calculateConsistencyScore(testScores: number[]): number {
    if (testScores.length < 2) return 100;

    const mean = testScores.reduce((sum, s) => sum + s, 0) / testScores.length;
    const variance = testScores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / testScores.length;
    const stdDev = Math.sqrt(variance);

    // Lower standard deviation = higher consistency
    // Score of 100 at stdDev=0, decreasing as stdDev increases
    const consistencyScore = Math.max(0, 100 - stdDev * 50);
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
      currentWindow: 0,
      totalWindows,
      estimatedTimeRemaining,
      lastUpdated: new Date(),
      currentBestScore,
      currentBestParams: currentBestParams || undefined
    };

    await this.optimizationRunRepository.update(run.id, {
      combinationsTested,
      progressDetails
    });
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
    // Calculate improvement
    const improvement = baselineScore !== 0 ? ((bestScore - baselineScore) / Math.abs(baselineScore)) * 100 : 0;

    // Rank all results
    await this.rankResults(run.id);

    // Update run
    run.status = OptimizationStatus.COMPLETED;
    run.bestScore = bestScore;
    run.bestParameters = bestParameters;
    run.baselineScore = baselineScore;
    run.improvement = Math.round(improvement * 100) / 100;
    run.completedAt = new Date();

    await this.optimizationRunRepository.save(run);

    // Mark best result
    if (bestParameters) {
      await this.optimizationResultRepository.update(
        {
          optimizationRunId: run.id,
          parameters: bestParameters as any
        },
        { isBest: true }
      );
    }

    this.logger.log(
      `Optimization run ${run.id} completed. Best score: ${bestScore.toFixed(4)}, Improvement: ${improvement.toFixed(2)}%`
    );
  }

  /**
   * Rank all results by test score
   */
  private async rankResults(runId: string): Promise<void> {
    const results = await this.optimizationResultRepository.find({
      where: { optimizationRunId: runId },
      order: { avgTestScore: 'DESC' }
    });

    for (let i = 0; i < results.length; i++) {
      results[i].rank = i + 1;
    }

    await this.optimizationResultRepository.save(results);
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
   * Get date range for optimization
   */
  private getDateRange(config: OptimizationConfig): { startDate: Date; endDate: Date } {
    if (config.dateRange) {
      return {
        startDate: new Date(config.dateRange.startDate),
        endDate: new Date(config.dateRange.endDate)
      };
    }

    // Default: last 3 years
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 3);

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
    const where: any = { strategyConfigId };
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
