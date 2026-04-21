import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { DataSource, type QueryDeepPartialEntity, Repository } from 'typeorm';

import { GridSearchService } from './grid-search.service';
import { OptimizationEvaluationService } from './optimization-evaluation.service';
import { OptimizationQueryService } from './optimization-query.service';
import { OptimizationRunSummaryService } from './optimization-run-summary.service';

import { AlgorithmRegistry } from '../../algorithm/registry/algorithm-registry.service';
import { PIPELINE_EVENTS } from '../../pipeline/interfaces';
import { toErrorInfo } from '../../shared/error.util';
import { sanitizeNumericValues } from '../../utils/validators/numeric-sanitizer';
import { OptimizationResult } from '../entities/optimization-result.entity';
import { OptimizationProgressDetails, OptimizationRun, OptimizationStatus } from '../entities/optimization-run.entity';
import { OptimizationConfig, ParameterSpace } from '../interfaces';
import { calculateImprovement } from '../utils/optimization-scoring.util';

/** Bars per day for the 1h candle timeframe used by all optimization runs today. */
const BARS_PER_DAY_1H = 24;

@Injectable()
export class OptimizationOrchestratorService {
  private readonly logger = new Logger(OptimizationOrchestratorService.name);

  constructor(
    @InjectRepository(OptimizationRun)
    private readonly optimizationRunRepository: Repository<OptimizationRun>,
    @InjectRepository(OptimizationResult)
    private readonly optimizationResultRepository: Repository<OptimizationResult>,
    @InjectQueue('optimization')
    private readonly optimizationQueue: Queue,
    private readonly gridSearchService: GridSearchService,
    private readonly evaluationService: OptimizationEvaluationService,
    private readonly queryService: OptimizationQueryService,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly summaryService: OptimizationRunSummaryService,
    @Inject(forwardRef(() => AlgorithmRegistry))
    private readonly algorithmRegistry: AlgorithmRegistry
  ) {}

  /**
   * Validate optimization configuration before starting a run
   */
  private validateOptimizationConfig(config: OptimizationConfig): void {
    const errors: string[] = [];

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

    if (config.maxCombinations !== undefined && config.maxCombinations <= 0) {
      errors.push('maxCombinations must be positive');
    }
    if (config.maxIterations !== undefined && config.maxIterations <= 0) {
      errors.push('maxIterations must be positive');
    }

    if (config.earlyStop?.enabled) {
      if (config.earlyStop.patience <= 0) {
        errors.push('patience must be positive when early stopping is enabled');
      }
      if (config.earlyStop.minImprovement !== undefined && config.earlyStop.minImprovement < 0) {
        errors.push('minImprovement cannot be negative');
      }
    }

    if (config.objective.metric === 'composite' && config.objective.weights) {
      const sum = Object.values(config.objective.weights).reduce((a, b) => a + (b || 0), 0);
      if (Math.abs(sum - 1.0) > 0.001) {
        errors.push(`Composite weights must sum to 1.0 (current sum: ${sum.toFixed(3)})`);
      }
    }

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

  async startOptimization(
    strategyConfigId: string,
    parameterSpace: ParameterSpace,
    config: OptimizationConfig
  ): Promise<OptimizationRun> {
    this.validateOptimizationConfig(config);

    const strategyConfig = await this.queryService.findStrategyConfig(strategyConfigId);

    if (!strategyConfig) {
      throw new NotFoundException(`Strategy config ${strategyConfigId} not found`);
    }

    const reachabilityFilter = await this.buildReachabilityFilter(strategyConfig.algorithmId, config);

    const combinations =
      config.method === 'random_search'
        ? this.gridSearchService.generateRandomCombinations(
            parameterSpace,
            config.maxIterations || 100,
            reachabilityFilter
          )
        : this.gridSearchService.generateCombinations(parameterSpace, config.maxCombinations, reachabilityFilter);

    const baselineCombination = combinations.find((c) => c.isBaseline);
    const baselineParameters = baselineCombination?.values || this.getDefaultParameters(parameterSpace);

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

    await this.optimizationQueue.add(
      'run-optimization',
      {
        runId: savedRun.id,
        combinations
      },
      {
        jobId: savedRun.id,
        removeOnComplete: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 }
      }
    );

    return savedRun;
  }

  /** Called by job processor */
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

    const isResume = run.combinationsTested > 0;
    run.status = OptimizationStatus.RUNNING;
    if (!isResume) {
      run.startedAt = new Date();
    }
    run.lastHeartbeatAt = new Date();
    await this.optimizationRunRepository.save(run);

    const minDataDays = run.config.walkForward.trainDays + run.config.walkForward.testDays;
    const coins = await this.evaluationService.loadCoinsForOptimization(run.config.maxCoins, minDataDays);
    this.logger.log(`Loaded ${coins.length} coins for optimization run ${runId}`);

    try {
      const dateRange = await this.evaluationService.getDateRange(run.config);
      const { windows, candlesByCoin, precomputedWindows } = await this.evaluationService.prepareWalkForwardData({
        config: run.config,
        parameterSpace: run.parameterSpace,
        coins,
        runId,
        dateRange
      });

      let bestScore = -Infinity;
      let bestParameters: Record<string, unknown> | null = null;
      let baselineScore = 0;
      let noImprovementCount = 0;
      let combinationsProcessed = 0;

      if (isResume) {
        const existingResults = await this.optimizationResultRepository.find({
          where: { optimizationRunId: runId },
          select: ['combinationIndex', 'avgTestScore', 'parameters', 'isBaseline']
        });

        const processedIndices = new Set(existingResults.map((r) => r.combinationIndex));
        combinations = combinations.filter((c) => !processedIndices.has(c.index));
        combinationsProcessed = existingResults.length;

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

      const heartbeatFn = async () => {
        await this.optimizationRunRepository.update(run.id, {
          lastHeartbeatAt: new Date()
        } as QueryDeepPartialEntity<OptimizationRun>);
      };

      const maxConcurrent = run.config.parallelism?.maxConcurrentBacktests || 3;

      for (let batchStart = 0; batchStart < combinations.length; batchStart += maxConcurrent) {
        const currentRun = await this.optimizationRunRepository.findOne({ where: { id: runId } });
        if (currentRun?.status === OptimizationStatus.CANCELLED) {
          this.logger.log(`Optimization run ${runId} was cancelled`);
          return;
        }

        const batchEnd = Math.min(batchStart + maxConcurrent, combinations.length);
        const batch = combinations.slice(batchStart, batchEnd);

        const batchResults = await Promise.all(
          batch.map(async (combination) => {
            const evaluationResult = await this.evaluationService.evaluateCombination({
              strategyConfig: run.strategyConfig,
              parameters: combination.values,
              windows,
              config: run.config,
              coins,
              preloadedCandlesByCoin: candlesByCoin,
              heartbeatFn,
              precomputedWindows
            });
            return { combination, evaluationResult };
          })
        );

        await this.dataSource.transaction(async (manager) => {
          for (const { combination, evaluationResult } of batchResults) {
            const sanitized = sanitizeNumericValues(
              {
                avgTrainScore: evaluationResult.avgTrainScore,
                avgTestScore: evaluationResult.avgTestScore,
                avgDegradation: evaluationResult.avgDegradation,
                consistencyScore: evaluationResult.consistencyScore
              },
              { maxIntegerDigits: 14 }
            );

            const result = manager.create(OptimizationResult, {
              optimizationRunId: runId,
              combinationIndex: combination.index,
              parameters: combination.values,
              avgTrainScore: sanitized.avgTrainScore ?? 0,
              avgTestScore: sanitized.avgTestScore ?? 0,
              avgDegradation: sanitized.avgDegradation ?? 0,
              consistencyScore: sanitized.consistencyScore ?? 0,
              overfittingWindows: evaluationResult.overfittingWindows,
              windowResults: evaluationResult.windowResults,
              isBaseline: combination.isBaseline
            });

            await manager.save(OptimizationResult, result);

            if (combination.isBaseline) {
              baselineScore = evaluationResult.avgTestScore;
            }

            if (evaluationResult.avgTestScore > bestScore) {
              if (!Number.isFinite(bestScore)) {
                // First valid score — treat as significant improvement
                noImprovementCount = 0;
              } else {
                const improvementPct =
                  bestScore !== 0 ? ((evaluationResult.avgTestScore - bestScore) / Math.abs(bestScore)) * 100 : 100;
                const minImprovement = run.config.earlyStop?.minImprovement ?? 0;

                if (improvementPct >= minImprovement) {
                  noImprovementCount = 0;
                } else {
                  noImprovementCount++;
                }
              }

              bestScore = evaluationResult.avgTestScore;
              bestParameters = combination.values;
            } else {
              noImprovementCount++;
            }

            combinationsProcessed++;
          }
        });

        if (typeof global.gc === 'function') {
          global.gc();
        }

        await this.updateProgress(run, combinationsProcessed, windows.length, bestScore, bestParameters);

        if (run.config.earlyStop?.enabled && noImprovementCount >= run.config.earlyStop.patience) {
          this.logger.log(
            `Early stopping triggered after ${combinationsProcessed} combinations ` +
              `(no improvement for ${noImprovementCount} iterations)`
          );
          break;
        }
      }

      run.combinationsTested = combinationsProcessed;
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
      if (typeof global.gc === 'function') {
        global.gc();
      }
    }
  }

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

  private async finalizeOptimization(
    run: OptimizationRun,
    bestScore: number,
    bestParameters: Record<string, unknown> | null,
    baselineScore: number
  ): Promise<void> {
    const rank1 = await this.queryService.rankResults(run.id);
    if (rank1) {
      bestScore = rank1.avgTestScore;
      bestParameters = rank1.parameters as Record<string, unknown>;
    }

    const improvement = calculateImprovement(bestScore, baselineScore);
    const sanitized = sanitizeNumericValues(
      { bestScore, baselineScore, improvement: Math.round(improvement * 100) / 100 },
      { maxIntegerDigits: 14 }
    );
    run.status = OptimizationStatus.COMPLETED;
    run.bestScore = sanitized.bestScore ?? 0;
    run.bestParameters = bestParameters ?? {};
    run.baselineScore = sanitized.baselineScore ?? 0;
    run.improvement = sanitized.improvement ?? 0;
    run.completedAt = new Date();

    await this.optimizationRunRepository.save(run);

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

    // Compute analytics summary for admin dashboard reads. Non-blocking — failure
    // must not prevent the pipeline from advancing.
    try {
      await this.summaryService.computeAndPersist(run.id);
    } catch (err: unknown) {
      const info = toErrorInfo(err);
      this.logger.error(`Failed to compute summary for optimization run ${run.id}: ${info.message}`, info.stack);
    }

    this.eventEmitter.emit(PIPELINE_EVENTS.OPTIMIZATION_COMPLETED, {
      runId: run.id,
      strategyConfigId: run.strategyConfigId,
      bestParameters: bestParameters ?? {},
      bestScore,
      improvement: run.improvement
    });
  }

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

    await this.optimizationQueue.remove(runId);

    this.logger.log(`Optimization run ${runId} cancelled`);
  }

  private getDefaultParameters(space: ParameterSpace): Record<string, unknown> {
    const defaults: Record<string, unknown> = {};
    for (const param of space.parameters) {
      defaults[param.name] = param.default;
    }
    return defaults;
  }

  /**
   * Build a reachability filter for grid-search. Rejects parameter combinations whose required
   * indicator warmup exceeds the available test-window bars, so the sampling budget isn't wasted
   * on combos that can never produce signals. Returns undefined when the strategy doesn't declare
   * a minimum-data-points requirement (filter is skipped in that case).
   */
  private async buildReachabilityFilter(
    algorithmId: string,
    config: OptimizationConfig
  ): Promise<((params: Record<string, unknown>) => boolean) | undefined> {
    const strategy = await this.algorithmRegistry.getStrategyForAlgorithm(algorithmId);
    if (!strategy?.getMinDataPoints) {
      return undefined;
    }

    const testBars = config.walkForward.testDays * BARS_PER_DAY_1H;
    const getMinDataPoints = strategy.getMinDataPoints.bind(strategy);

    return (params: Record<string, unknown>) => getMinDataPoints(params) <= testBars;
  }
}
