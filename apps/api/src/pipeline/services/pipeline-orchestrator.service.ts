import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';

import { MarketRegimeType } from '@chansey/api-interfaces';

import { AlgorithmRegistry } from '../../algorithm/registry/algorithm-registry.service';
import { ExchangeKey } from '../../exchange/exchange-key/exchange-key.entity';
import { MarketRegimeService } from '../../market-regime/market-regime.service';
import { OptimizationOrchestratorService } from '../../optimization/services/optimization-orchestrator.service';
import { buildParameterSpace } from '../../optimization/utils/parameter-space-builder';
import { BacktestType } from '../../order/backtest/backtest.entity';
import { BacktestService } from '../../order/backtest/backtest.service';
import { PaperTradingService } from '../../order/paper-trading/paper-trading.service';
import { ScoringService } from '../../scoring/scoring.service';
import { StrategyConfig } from '../../strategy/entities/strategy-config.entity';
import { User } from '../../users/users.entity';
import { CreatePipelineInput, PipelineFiltersDto } from '../dto';
import { Pipeline } from '../entities/pipeline.entity';
import {
  DEFAULT_PROGRESSION_RULES,
  DeploymentRecommendation,
  HistoricalStageResult,
  LiveReplayStageResult,
  OptimizationStageResult,
  PIPELINE_EVENTS,
  PaperTradingStageResult,
  PipelineProgressionRules,
  PipelineScoreResult,
  PipelineStage,
  PipelineStageResults,
  PipelineStatus,
  StageProgressionThresholds
} from '../interfaces';
import { pipelineConfig } from '../pipeline.config';

export interface PipelineJobData {
  pipelineId: string;
  userId: string;
  stage: PipelineStage;
}

@Injectable()
export class PipelineOrchestratorService {
  private readonly logger = new Logger(PipelineOrchestratorService.name);

  constructor(
    @InjectRepository(Pipeline)
    private readonly pipelineRepository: Repository<Pipeline>,
    @InjectRepository(StrategyConfig)
    private readonly strategyConfigRepository: Repository<StrategyConfig>,
    @InjectRepository(ExchangeKey)
    private readonly exchangeKeyRepository: Repository<ExchangeKey>,
    @InjectQueue('pipeline')
    private readonly pipelineQueue: Queue,
    @Inject(pipelineConfig.KEY)
    private readonly config: ConfigType<typeof pipelineConfig>,
    @Inject(forwardRef(() => OptimizationOrchestratorService))
    private readonly optimizationService: OptimizationOrchestratorService,
    @Inject(forwardRef(() => BacktestService))
    private readonly backtestService: BacktestService,
    @Inject(forwardRef(() => PaperTradingService))
    private readonly paperTradingService: PaperTradingService,
    @Inject(forwardRef(() => ScoringService))
    private readonly scoringService: ScoringService,
    @Inject(forwardRef(() => MarketRegimeService))
    private readonly marketRegimeService: MarketRegimeService,
    @Inject(forwardRef(() => AlgorithmRegistry))
    private readonly algorithmRegistry: AlgorithmRegistry,
    private readonly eventEmitter: EventEmitter2,
    private readonly dataSource: DataSource
  ) {}

  /**
   * Create a new pipeline
   */
  async createPipeline(dto: CreatePipelineInput, user: User): Promise<Pipeline> {
    // Validate strategy config exists
    const strategyConfig = await this.strategyConfigRepository.findOne({
      where: { id: dto.strategyConfigId }
    });
    if (!strategyConfig) {
      throw new NotFoundException(`Strategy config ${dto.strategyConfigId} not found`);
    }

    // Validate exchange key exists and belongs to user
    const exchangeKey = await this.exchangeKeyRepository.findOne({
      where: { id: dto.exchangeKeyId },
      relations: ['user', 'exchange']
    });
    if (!exchangeKey) {
      throw new NotFoundException(`Exchange key ${dto.exchangeKeyId} not found`);
    }
    if (exchangeKey.user.id !== user.id) {
      throw new ForbiddenException('Exchange key does not belong to user');
    }

    // Use provided progression rules or defaults
    const progressionRules: PipelineProgressionRules = dto.progressionRules ?? {
      ...DEFAULT_PROGRESSION_RULES
    };

    const pipeline = this.pipelineRepository.create({
      name: dto.name,
      description: dto.description,
      status: PipelineStatus.PENDING,
      currentStage: dto.initialStage ?? PipelineStage.OPTIMIZE,
      strategyConfigId: dto.strategyConfigId,
      exchangeKeyId: dto.exchangeKeyId,
      stageConfig: dto.stageConfig,
      progressionRules,
      user
    });

    const savedPipeline = await this.pipelineRepository.save(pipeline);

    this.logger.log(`Created pipeline ${savedPipeline.id} for strategy ${dto.strategyConfigId}`);

    return this.findOne(savedPipeline.id, user);
  }

  /**
   * Get a pipeline by ID
   */
  async findOne(id: string, user: User): Promise<Pipeline> {
    const pipeline = await this.pipelineRepository.findOne({
      where: { id, user: { id: user.id } },
      relations: ['strategyConfig', 'exchangeKey', 'exchangeKey.exchange', 'user']
    });

    if (!pipeline) {
      throw new NotFoundException(`Pipeline ${id} not found`);
    }

    return pipeline;
  }

  /**
   * List pipelines for a user
   */
  async findAll(user: User, filters: PipelineFiltersDto): Promise<{ data: Pipeline[]; total: number }> {
    const where: FindOptionsWhere<Pipeline> = { user: { id: user.id } };

    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.currentStage) {
      where.currentStage = filters.currentStage;
    }
    if (filters.strategyConfigId) {
      where.strategyConfigId = filters.strategyConfigId;
    }

    const [data, total] = await this.pipelineRepository.findAndCount({
      where,
      relations: ['strategyConfig'],
      order: { createdAt: 'DESC' },
      take: filters.limit ?? 20,
      skip: filters.offset ?? 0
    });

    return { data, total };
  }

  /**
   * List all pipelines (admin only)
   */
  async findAllAdmin(filters: PipelineFiltersDto): Promise<{ data: Pipeline[]; total: number }> {
    const where: FindOptionsWhere<Pipeline> = {};

    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.currentStage) {
      where.currentStage = filters.currentStage;
    }
    if (filters.strategyConfigId) {
      where.strategyConfigId = filters.strategyConfigId;
    }

    const [data, total] = await this.pipelineRepository.findAndCount({
      where,
      relations: ['strategyConfig', 'user'],
      order: { createdAt: 'DESC' },
      take: filters.limit ?? 20,
      skip: filters.offset ?? 0
    });

    return { data, total };
  }

  /**
   * Get a pipeline by ID (admin only)
   */
  async findOneAdmin(id: string): Promise<Pipeline> {
    const pipeline = await this.pipelineRepository.findOne({
      where: { id },
      relations: ['strategyConfig', 'exchangeKey', 'exchangeKey.exchange', 'user']
    });

    if (!pipeline) {
      throw new NotFoundException(`Pipeline ${id} not found`);
    }

    return pipeline;
  }

  /**
   * Cancel pipeline execution (admin only)
   */
  async cancelPipelineAdmin(id: string): Promise<Pipeline> {
    const pipeline = await this.findOneAdmin(id);

    if (pipeline.status === PipelineStatus.COMPLETED || pipeline.status === PipelineStatus.CANCELLED) {
      throw new BadRequestException('Pipeline is already completed or cancelled');
    }

    await this.dataSource.transaction(async (manager) => {
      pipeline.status = PipelineStatus.CANCELLED;
      pipeline.completedAt = new Date();
      pipeline.failureReason = 'Cancelled by admin';
      await manager.save(pipeline);
    });

    // Cancel current stage execution
    await this.cancelCurrentStage(pipeline);

    // Remove any pending queue jobs
    await this.pipelineQueue.remove(`pipeline-${id}-${pipeline.currentStage}`);

    this.logger.log(`Admin cancelled pipeline ${id}`);

    return this.findOneAdmin(id);
  }

  /**
   * Start pipeline execution
   */
  async startPipeline(id: string, user: User): Promise<Pipeline> {
    const pipeline = await this.findOne(id, user);

    if (pipeline.status === PipelineStatus.RUNNING) {
      throw new BadRequestException('Pipeline is already running');
    }
    if (pipeline.status === PipelineStatus.COMPLETED) {
      throw new BadRequestException('Pipeline has already completed');
    }
    if (pipeline.status === PipelineStatus.CANCELLED) {
      throw new BadRequestException('Pipeline has been cancelled');
    }

    await this.dataSource.transaction(async (manager) => {
      pipeline.status = PipelineStatus.RUNNING;
      pipeline.startedAt = pipeline.startedAt ?? new Date();
      await manager.save(pipeline);

      // Queue the first stage with unique job ID to prevent collisions on resume
      await this.pipelineQueue.add(
        'execute-stage',
        {
          pipelineId: id,
          userId: user.id,
          stage: pipeline.currentStage
        } as PipelineJobData,
        {
          jobId: `pipeline-${id}-${pipeline.currentStage}-${Date.now()}`
        }
      );
    });

    this.logger.log(`Started pipeline ${id} at stage ${pipeline.currentStage}`);

    return this.findOne(id, user);
  }

  /**
   * Pause pipeline execution
   */
  async pausePipeline(id: string, user: User): Promise<Pipeline> {
    const pipeline = await this.findOne(id, user);

    if (pipeline.status !== PipelineStatus.RUNNING) {
      throw new BadRequestException('Can only pause a running pipeline');
    }

    pipeline.status = PipelineStatus.PAUSED;
    await this.pipelineRepository.save(pipeline);

    // Delegate pause to the current stage service
    await this.pauseCurrentStage(pipeline);

    this.logger.log(`Paused pipeline ${id} at stage ${pipeline.currentStage}`);

    return this.findOne(id, user);
  }

  /**
   * Resume paused pipeline
   */
  async resumePipeline(id: string, user: User): Promise<Pipeline> {
    const pipeline = await this.findOne(id, user);

    if (pipeline.status !== PipelineStatus.PAUSED) {
      throw new BadRequestException('Can only resume a paused pipeline');
    }

    pipeline.status = PipelineStatus.RUNNING;
    await this.pipelineRepository.save(pipeline);

    // Delegate resume to the current stage service
    await this.resumeCurrentStage(pipeline, user);

    this.logger.log(`Resumed pipeline ${id} at stage ${pipeline.currentStage}`);

    return this.findOne(id, user);
  }

  /**
   * Cancel pipeline execution
   */
  async cancelPipeline(id: string, user: User): Promise<Pipeline> {
    const pipeline = await this.findOne(id, user);

    if (pipeline.status === PipelineStatus.COMPLETED || pipeline.status === PipelineStatus.CANCELLED) {
      throw new BadRequestException('Pipeline is already completed or cancelled');
    }

    await this.dataSource.transaction(async (manager) => {
      pipeline.status = PipelineStatus.CANCELLED;
      pipeline.completedAt = new Date();
      pipeline.failureReason = 'Cancelled by user';
      await manager.save(pipeline);
    });

    // Cancel current stage execution
    await this.cancelCurrentStage(pipeline);

    // Remove any pending queue jobs
    await this.pipelineQueue.remove(`pipeline-${id}-${pipeline.currentStage}`);

    this.logger.log(`Cancelled pipeline ${id}`);

    return this.findOne(id, user);
  }

  /**
   * Skip current stage and advance to next
   */
  async skipStage(id: string, user: User): Promise<Pipeline> {
    const pipeline = await this.findOne(id, user);

    if (pipeline.status !== PipelineStatus.RUNNING && pipeline.status !== PipelineStatus.PAUSED) {
      throw new BadRequestException('Can only skip stages for running or paused pipelines');
    }

    if (pipeline.currentStage === PipelineStage.COMPLETED) {
      throw new BadRequestException('Pipeline has already completed all stages');
    }

    this.logger.log(`Skipping stage ${pipeline.currentStage} for pipeline ${id}`);

    // Cancel current stage if running
    await this.cancelCurrentStage(pipeline);

    // Advance to next stage
    await this.advanceToNextStage(pipeline);

    return this.findOne(id, user);
  }

  /**
   * Delete a pipeline
   */
  async deletePipeline(id: string, user: User): Promise<void> {
    const pipeline = await this.findOne(id, user);

    if (pipeline.status === PipelineStatus.RUNNING) {
      throw new BadRequestException('Cannot delete a running pipeline. Cancel it first.');
    }

    await this.pipelineRepository.remove(pipeline);
    this.logger.log(`Deleted pipeline ${id}`);
  }

  /**
   * Execute a specific stage (called by processor)
   */
  async executeStage(pipelineId: string, stage: PipelineStage): Promise<void> {
    const pipeline = await this.pipelineRepository.findOne({
      where: { id: pipelineId },
      relations: ['strategyConfig', 'strategyConfig.algorithm', 'exchangeKey', 'user']
    });

    if (!pipeline) {
      throw new NotFoundException(`Pipeline ${pipelineId} not found`);
    }

    if (pipeline.status !== PipelineStatus.RUNNING) {
      this.logger.warn(`Pipeline ${pipelineId} is not running (status: ${pipeline.status})`);
      return;
    }

    this.logger.log(`Executing stage ${stage} for pipeline ${pipelineId}`);

    switch (stage) {
      case PipelineStage.OPTIMIZE:
        await this.executeOptimizationStage(pipeline);
        break;
      case PipelineStage.HISTORICAL:
        await this.executeHistoricalStage(pipeline);
        break;
      case PipelineStage.LIVE_REPLAY:
        await this.executeLiveReplayStage(pipeline);
        break;
      case PipelineStage.PAPER_TRADE:
        await this.executePaperTradingStage(pipeline);
        break;
      default:
        this.logger.warn(`Unknown stage ${stage} for pipeline ${pipelineId}`);
    }
  }

  /**
   * Handle optimization completion
   */
  async handleOptimizationComplete(
    runId: string,
    strategyConfigId: string,
    bestParameters: Record<string, unknown>,
    bestScore: number,
    improvement: number
  ): Promise<void> {
    // Find pipeline by optimizationRunId for uniqueness (strategyConfigId could match multiple pipelines)
    const pipeline = await this.pipelineRepository.findOne({
      where: {
        optimizationRunId: runId,
        currentStage: PipelineStage.OPTIMIZE,
        status: PipelineStatus.RUNNING
      },
      relations: ['user']
    });

    if (!pipeline) {
      this.logger.debug(`No active pipeline found for optimization run ${runId} (strategy ${strategyConfigId})`);
      return;
    }

    this.logger.log(`Optimization completed for pipeline ${pipeline.id}`);

    // Store optimization results
    const optimizationResult: OptimizationStageResult = {
      runId,
      status: 'COMPLETED',
      bestParameters,
      bestScore,
      baselineScore: bestScore / (1 + improvement / 100),
      improvement,
      combinationsTested: 0, // Will be updated from optimization run
      totalCombinations: 0,
      duration: 0,
      completedAt: new Date().toISOString()
    };

    pipeline.optimizationRunId = runId;
    pipeline.optimizedParameters = bestParameters;
    pipeline.stageResults = {
      ...pipeline.stageResults,
      optimization: optimizationResult
    };

    await this.pipelineRepository.save(pipeline);

    // Evaluate progression
    const { passed, failures } = this.evaluateOptimizationProgression(pipeline, improvement);

    if (passed) {
      await this.advanceToNextStage(pipeline);
    } else {
      await this.failPipeline(pipeline, `Optimization did not meet progression threshold: ${failures.join('; ')}`);
    }
  }

  /**
   * Handle optimization failure (stale watchdog or error).
   * Finds the pipeline linked to the optimization run and fails it.
   */
  async handleOptimizationFailed(runId: string, reason: string): Promise<void> {
    const pipeline = await this.pipelineRepository.findOne({
      where: {
        optimizationRunId: runId,
        currentStage: PipelineStage.OPTIMIZE,
        status: PipelineStatus.RUNNING
      },
      relations: ['user']
    });

    if (!pipeline) {
      this.logger.debug(`No active pipeline found for failed optimization run ${runId}`);
      return;
    }

    await this.failPipeline(pipeline, `Optimization failed: ${reason}`);
  }

  /**
   * Handle backtest completion
   */
  async handleBacktestComplete(
    backtestId: string,
    type: 'HISTORICAL' | 'LIVE_REPLAY',
    metrics: {
      sharpeRatio: number;
      totalReturn: number;
      maxDrawdown: number;
      winRate: number;
      totalTrades: number;
      profitFactor: number;
      volatility: number;
    }
  ): Promise<void> {
    // Find pipeline with this backtest
    const whereClause =
      type === 'HISTORICAL' ? { historicalBacktestId: backtestId } : { liveReplayBacktestId: backtestId };

    const pipeline = await this.pipelineRepository.findOne({
      where: {
        ...whereClause,
        status: PipelineStatus.RUNNING
      },
      relations: ['user']
    });

    if (!pipeline) {
      this.logger.debug(`No active pipeline found for backtest ${backtestId}`);
      return;
    }

    this.logger.log(`Backtest ${type} completed for pipeline ${pipeline.id}`);

    // Store backtest results
    if (type === 'HISTORICAL') {
      const result: HistoricalStageResult = {
        backtestId,
        status: 'COMPLETED',
        sharpeRatio: metrics.sharpeRatio,
        totalReturn: metrics.totalReturn,
        maxDrawdown: metrics.maxDrawdown,
        winRate: metrics.winRate,
        totalTrades: metrics.totalTrades,
        profitFactor: metrics.profitFactor,
        volatility: metrics.volatility,
        initialCapital: pipeline.stageConfig.historical.initialCapital,
        finalValue: pipeline.stageConfig.historical.initialCapital * (1 + metrics.totalReturn),
        annualizedReturn: metrics.totalReturn, // Simplified
        winningTrades: Math.round(metrics.totalTrades * metrics.winRate),
        losingTrades: Math.round(metrics.totalTrades * (1 - metrics.winRate)),
        duration: 0,
        completedAt: new Date().toISOString()
      };

      pipeline.stageResults = {
        ...pipeline.stageResults,
        historical: result
      };
    } else {
      const historicalReturn = pipeline.stageResults?.historical?.totalReturn ?? 0;
      const degradation =
        historicalReturn !== 0 ? ((historicalReturn - metrics.totalReturn) / Math.abs(historicalReturn)) * 100 : 0;

      const result: LiveReplayStageResult = {
        backtestId,
        status: 'COMPLETED',
        sharpeRatio: metrics.sharpeRatio,
        totalReturn: metrics.totalReturn,
        maxDrawdown: metrics.maxDrawdown,
        winRate: metrics.winRate,
        totalTrades: metrics.totalTrades,
        profitFactor: metrics.profitFactor,
        volatility: metrics.volatility,
        initialCapital: pipeline.stageConfig.liveReplay.initialCapital,
        finalValue: pipeline.stageConfig.liveReplay.initialCapital * (1 + metrics.totalReturn),
        annualizedReturn: metrics.totalReturn,
        winningTrades: Math.round(metrics.totalTrades * metrics.winRate),
        losingTrades: Math.round(metrics.totalTrades * (1 - metrics.winRate)),
        degradationFromHistorical: degradation,
        duration: 0,
        completedAt: new Date().toISOString()
      };

      pipeline.stageResults = {
        ...pipeline.stageResults,
        liveReplay: result
      };
    }

    if (type === 'HISTORICAL') {
      await this.pipelineRepository.save(pipeline);

      // AUTO-ADVANCE: Historical stage always advances to LIVE_REPLAY regardless of metrics.
      // The actual quality gate happens after LIVE_REPLAY using the scoring service.
      this.logger.log(`Pipeline ${pipeline.id}: HISTORICAL auto-advancing to LIVE_REPLAY`);
      await this.advanceToNextStage(pipeline);
    } else {
      // SCORE-BASED GATE at LIVE_REPLAY
      const scoreResult = await this.calculatePipelineScore(pipeline, metrics);

      // Store score on pipeline entity — single save persists both stageResults and score data
      pipeline.pipelineScore = scoreResult.overallScore;
      pipeline.scoreGrade = scoreResult.grade;
      pipeline.scoringRegime = scoreResult.regime;
      pipeline.scoreDetails = scoreResult.componentScores as unknown as Record<string, unknown>;
      pipeline.stageResults = {
        ...pipeline.stageResults,
        scoring: scoreResult
      };
      await this.pipelineRepository.save(pipeline);

      const minimumScore = pipeline.progressionRules.minimumPipelineScore ?? 30;
      if (scoreResult.overallScore >= minimumScore) {
        this.logger.log(
          `Pipeline ${pipeline.id}: LIVE_REPLAY score ${scoreResult.overallScore.toFixed(1)} >= ${minimumScore}, advancing`
        );
        await this.advanceToNextStage(pipeline);
      } else {
        await this.failPipeline(
          pipeline,
          `LIVE_REPLAY score ${scoreResult.overallScore.toFixed(1)} < minimum ${minimumScore}`
        );
      }
    }
  }

  /**
   * Handle paper trading completion
   */
  async handlePaperTradingComplete(
    sessionId: string,
    pipelineId: string,
    metrics: {
      initialCapital: number;
      currentPortfolioValue: number;
      totalReturn: number;
      totalReturnPercent: number;
      maxDrawdown: number;
      sharpeRatio?: number;
      winRate: number;
      totalTrades: number;
      winningTrades: number;
      losingTrades: number;
      totalFees: number;
      durationHours: number;
    },
    stoppedReason?: string
  ): Promise<void> {
    const pipeline = await this.pipelineRepository.findOne({
      where: { id: pipelineId },
      relations: ['user', 'strategyConfig']
    });

    if (!pipeline) {
      this.logger.debug(`Pipeline ${pipelineId} not found for paper trading completion`);
      return;
    }

    this.logger.log(`Paper trading completed for pipeline ${pipelineId}`);

    const liveReplayReturn = pipeline.stageResults?.liveReplay?.totalReturn ?? 0;
    const degradation =
      liveReplayReturn !== 0 ? ((liveReplayReturn - metrics.totalReturn) / Math.abs(liveReplayReturn)) * 100 : 0;

    const result: PaperTradingStageResult = {
      sessionId,
      status: stoppedReason === 'duration_reached' || stoppedReason === 'target_reached' ? 'COMPLETED' : 'STOPPED',
      sharpeRatio: metrics.sharpeRatio ?? 0,
      totalReturn: metrics.totalReturn,
      maxDrawdown: metrics.maxDrawdown,
      winRate: metrics.winRate,
      totalTrades: metrics.totalTrades,
      initialCapital: metrics.initialCapital,
      finalValue: metrics.currentPortfolioValue,
      totalFees: metrics.totalFees,
      degradationFromLiveReplay: degradation,
      stoppedReason,
      durationHours: metrics.durationHours,
      completedAt: new Date().toISOString()
    };

    pipeline.stageResults = {
      ...pipeline.stageResults,
      paperTrading: result
    };

    await this.pipelineRepository.save(pipeline);

    // Evaluate progression
    const thresholds = pipeline.progressionRules.paperTrading;
    const { passed, failures } = this.evaluateStageProgression(
      {
        sharpeRatio: metrics.sharpeRatio ?? 0,
        totalReturn: metrics.totalReturn,
        maxDrawdown: metrics.maxDrawdown,
        winRate: metrics.winRate,
        totalTrades: metrics.totalTrades
      },
      thresholds
    );

    if (passed) {
      // Pipeline completed successfully
      await this.completePipeline(pipeline);
    } else {
      await this.failPipeline(pipeline, `Paper trading did not meet thresholds: ${failures.join('; ')}`);
    }
  }

  /**
   * Evaluate optimization progression
   */
  private evaluateOptimizationProgression(
    pipeline: Pipeline,
    improvement: number
  ): { passed: boolean; failures: string[] } {
    const threshold = pipeline.progressionRules.optimization.minImprovement;
    const failures: string[] = [];
    if (improvement < threshold) {
      failures.push(`Improvement ${improvement.toFixed(2)}% < min ${threshold.toFixed(2)}%`);
    }
    return { passed: failures.length === 0, failures };
  }

  /**
   * Evaluate stage progression against thresholds
   */
  private evaluateStageProgression(
    metrics: {
      sharpeRatio: number;
      totalReturn: number;
      maxDrawdown: number;
      winRate: number;
      totalTrades: number;
    },
    thresholds: StageProgressionThresholds
  ): { passed: boolean; failures: string[] } {
    const failures: string[] = [];
    if (thresholds.minSharpeRatio !== undefined && metrics.sharpeRatio < thresholds.minSharpeRatio) {
      failures.push(`Sharpe ratio ${metrics.sharpeRatio.toFixed(3)} < min ${thresholds.minSharpeRatio.toFixed(3)}`);
    }
    if (thresholds.maxDrawdown !== undefined && metrics.maxDrawdown > thresholds.maxDrawdown) {
      failures.push(
        `Max drawdown ${(metrics.maxDrawdown * 100).toFixed(1)}% > max ${(thresholds.maxDrawdown * 100).toFixed(1)}%`
      );
    }
    if (thresholds.minWinRate !== undefined && metrics.winRate < thresholds.minWinRate) {
      failures.push(
        `Win rate ${(metrics.winRate * 100).toFixed(1)}% < min ${(thresholds.minWinRate * 100).toFixed(1)}%`
      );
    }
    if (thresholds.minTotalReturn !== undefined && metrics.totalReturn < thresholds.minTotalReturn) {
      failures.push(
        `Total return ${(metrics.totalReturn * 100).toFixed(1)}% < min ${(thresholds.minTotalReturn * 100).toFixed(1)}%`
      );
    }
    if (thresholds.minTotalTrades !== undefined && metrics.totalTrades < thresholds.minTotalTrades) {
      failures.push(`Total trades ${metrics.totalTrades} < min ${thresholds.minTotalTrades}`);
    }
    return { passed: failures.length === 0, failures };
  }

  /**
   * Advance pipeline to next stage
   */
  async advanceToNextStage(pipeline: Pipeline): Promise<void> {
    const stageOrder: PipelineStage[] = [
      PipelineStage.OPTIMIZE,
      PipelineStage.HISTORICAL,
      PipelineStage.LIVE_REPLAY,
      PipelineStage.PAPER_TRADE,
      PipelineStage.COMPLETED
    ];

    const currentIndex = stageOrder.indexOf(pipeline.currentStage);
    const nextStage = stageOrder[currentIndex + 1];

    const previousStage = pipeline.currentStage;
    pipeline.currentStage = nextStage;
    await this.pipelineRepository.save(pipeline);

    this.logger.log(`Pipeline ${pipeline.id} advanced from ${previousStage} to ${nextStage}`);

    // Emit stage transition event
    this.eventEmitter.emit(PIPELINE_EVENTS.PIPELINE_STAGE_TRANSITION, {
      pipelineId: pipeline.id,
      previousStage,
      newStage: nextStage,
      timestamp: new Date().toISOString()
    });

    if (nextStage === PipelineStage.COMPLETED) {
      await this.completePipeline(pipeline);
    } else {
      // Ensure user relation is loaded for queue job
      if (!pipeline.user?.id) {
        throw new Error(`Pipeline ${pipeline.id} missing user relation for stage advancement`);
      }

      // Queue next stage execution with unique job ID
      await this.pipelineQueue.add(
        'execute-stage',
        {
          pipelineId: pipeline.id,
          userId: pipeline.user.id,
          stage: nextStage
        } as PipelineJobData,
        {
          jobId: `pipeline-${pipeline.id}-${nextStage}-${Date.now()}`
        }
      );
    }
  }

  /**
   * Complete pipeline successfully
   */
  private async completePipeline(pipeline: Pipeline): Promise<void> {
    pipeline.status = PipelineStatus.COMPLETED;
    pipeline.currentStage = PipelineStage.COMPLETED;
    pipeline.completedAt = new Date();

    // Generate recommendation based on results
    pipeline.recommendation = this.generateRecommendation(pipeline.stageResults);

    await this.pipelineRepository.save(pipeline);

    this.logger.log(`Pipeline ${pipeline.id} completed with recommendation: ${pipeline.recommendation}`);

    this.eventEmitter.emit(PIPELINE_EVENTS.PIPELINE_COMPLETED, {
      pipelineId: pipeline.id,
      recommendation: pipeline.recommendation,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Fail pipeline with reason
   */
  private async failPipeline(pipeline: Pipeline, reason: string): Promise<void> {
    pipeline.status = PipelineStatus.FAILED;
    pipeline.completedAt = new Date();
    pipeline.failureReason = reason;
    pipeline.recommendation = DeploymentRecommendation.DO_NOT_DEPLOY;

    await this.pipelineRepository.save(pipeline);

    this.logger.warn(`Pipeline ${pipeline.id} failed: ${reason}`);

    this.eventEmitter.emit(PIPELINE_EVENTS.PIPELINE_FAILED, {
      pipelineId: pipeline.id,
      reason,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Generate deployment recommendation based on stage results.
   * Uses pipeline score when available (new score-based gating),
   * falls back to legacy metric checks for backward compatibility.
   */
  private generateRecommendation(stageResults?: PipelineStageResults): DeploymentRecommendation {
    if (!stageResults) {
      return DeploymentRecommendation.DO_NOT_DEPLOY;
    }

    // Use score-based recommendation if pipeline score is available
    const pipelineScore = stageResults.scoring?.overallScore;
    if (pipelineScore !== undefined) {
      if (pipelineScore >= 70) return DeploymentRecommendation.DEPLOY;
      if (pipelineScore >= 30) return DeploymentRecommendation.NEEDS_REVIEW;
      return DeploymentRecommendation.DO_NOT_DEPLOY;
    }

    // Fallback: legacy metric-based recommendation for older pipelines
    const optimizationOk = !stageResults.optimization || stageResults.optimization.status === 'COMPLETED';
    const allStagesPassed =
      optimizationOk &&
      stageResults.historical?.status === 'COMPLETED' &&
      stageResults.liveReplay?.status === 'COMPLETED' &&
      (stageResults.paperTrading?.status === 'COMPLETED' || stageResults.paperTrading?.status === 'STOPPED');

    if (!allStagesPassed) {
      return DeploymentRecommendation.DO_NOT_DEPLOY;
    }

    const historicalReturn = stageResults.historical?.totalReturn ?? 0;
    const paperTradingReturn = stageResults.paperTrading?.totalReturn ?? 0;

    const avgDegradation = Math.abs(
      ((historicalReturn - paperTradingReturn) / Math.max(Math.abs(historicalReturn), 0.01)) * 100
    );

    const finalSharpe = stageResults.paperTrading?.sharpeRatio ?? 0;
    const finalDrawdown = stageResults.paperTrading?.maxDrawdown ?? 1;
    const finalWinRate = stageResults.paperTrading?.winRate ?? 0;

    if (
      finalSharpe >= 1.0 &&
      finalDrawdown <= 0.25 &&
      finalWinRate >= 0.5 &&
      avgDegradation <= 20 &&
      paperTradingReturn > 0
    ) {
      return DeploymentRecommendation.DEPLOY;
    }

    if (finalSharpe >= 0.5 && finalDrawdown <= 0.4 && finalWinRate >= 0.4 && avgDegradation <= 40) {
      return DeploymentRecommendation.NEEDS_REVIEW;
    }

    return DeploymentRecommendation.DO_NOT_DEPLOY;
  }

  /**
   * Calculate pipeline score using the scoring service and market regime
   */
  private async calculatePipelineScore(
    pipeline: Pipeline,
    metrics: {
      sharpeRatio: number;
      totalReturn: number;
      maxDrawdown: number;
      winRate: number;
      totalTrades: number;
      profitFactor: number;
      volatility: number;
    }
  ): Promise<PipelineScoreResult> {
    // Compute WFA degradation between historical and live replay totalReturn
    const historicalReturn = pipeline.stageResults?.historical?.totalReturn ?? 0;
    const degradation =
      historicalReturn !== 0 ? ((historicalReturn - metrics.totalReturn) / Math.abs(historicalReturn)) * 100 : 0;

    // Fetch current BTC market regime (graceful fallback).
    // BTC is used as the crypto market bellwether; deriving the traded asset would
    // require loading additional backtest/marketDataSet relations for marginal benefit.
    let regimeType: MarketRegimeType | undefined;
    try {
      const regime = await this.marketRegimeService.getCurrentRegime('BTC');
      regimeType = regime?.regime;
    } catch (error) {
      this.logger.warn(`Failed to fetch market regime, using no modifier: ${error}`);
    }

    // Build scoring metrics — compute calmarRatio from live replay metrics
    const calmarRatio = metrics.maxDrawdown !== 0 ? metrics.totalReturn / Math.abs(metrics.maxDrawdown) : 0;

    const scoringMetrics = {
      sharpeRatio: metrics.sharpeRatio,
      calmarRatio,
      maxDrawdown: metrics.maxDrawdown,
      winRate: metrics.winRate,
      profitFactor: metrics.profitFactor,
      totalTrades: metrics.totalTrades,
      totalReturn: metrics.totalReturn,
      volatility: metrics.volatility
    };

    // Negative degradation means live replay outperformed historical; WFA degradation
    // only penalizes, so clamping to 0 is intentional.
    const result = this.scoringService.calculateScoreFromMetrics(scoringMetrics, Math.max(0, degradation), {
      marketRegime: regimeType
    });

    return {
      overallScore: result.overallScore,
      grade: result.grade,
      componentScores: result.componentScores,
      regimeModifier: result.regimeModifier,
      regime: regimeType ?? 'unknown',
      degradation,
      warnings: result.warnings,
      calculatedAt: new Date().toISOString()
    };
  }

  /**
   * Record that the optimization stage was skipped (e.g., when starting at HISTORICAL).
   * Writes a synthetic "SKIPPED" result so generateRecommendation() works correctly.
   */
  async recordOptimizationSkipped(pipelineId: string): Promise<void> {
    const pipeline = await this.pipelineRepository.findOne({ where: { id: pipelineId } });
    if (!pipeline) return;

    const skippedResult: OptimizationStageResult = {
      runId: 'skipped',
      status: 'COMPLETED',
      bestParameters: {},
      bestScore: 0,
      baselineScore: 0,
      improvement: 0,
      combinationsTested: 0,
      totalCombinations: 0,
      duration: 0,
      completedAt: new Date().toISOString()
    };

    pipeline.stageResults = {
      ...pipeline.stageResults,
      optimization: skippedResult
    };

    await this.pipelineRepository.save(pipeline);
    this.logger.log(`Recorded optimization skipped for pipeline ${pipelineId}`);
  }

  // Stage execution methods

  private async executeOptimizationStage(pipeline: Pipeline): Promise<void> {
    const config = pipeline.stageConfig.optimization;
    if (!config) {
      throw new Error(`Pipeline ${pipeline.id}: optimization stage config is missing`);
    }

    // Build ParameterSpace at runtime from strategy schema + constraints
    const strategy = await this.algorithmRegistry.getStrategyForAlgorithm(pipeline.strategyConfig.algorithmId);
    if (!strategy?.getConfigSchema) {
      throw new Error(
        `Pipeline ${pipeline.id}: strategy not found or has no config schema for algorithm ${pipeline.strategyConfig.algorithmId}`
      );
    }

    const schema = strategy.getConfigSchema();
    const constraints = strategy.getParameterConstraints?.() ?? [];
    const parameterSpace = buildParameterSpace(strategy.id, schema, constraints, pipeline.strategyConfig.version);

    if (parameterSpace.parameters.length === 0) {
      throw new Error(`Pipeline ${pipeline.id}: strategy has no optimizable parameters`);
    }

    // Start optimization run
    const run = await this.optimizationService.startOptimization(pipeline.strategyConfigId, parameterSpace, {
      method: 'random_search',
      maxIterations: config.maxCombinations,
      maxCombinations: config.maxCombinations,
      objective: {
        metric: config.objectiveMetric,
        minimize: false // Maximize the objective metric
      },
      walkForward: {
        trainDays: config.trainDays,
        testDays: config.testDays,
        stepDays: config.stepDays,
        method: 'rolling',
        minWindowsRequired: 3
      },
      earlyStop: config.earlyStop
        ? {
            enabled: true,
            patience: config.patience ?? 20,
            minImprovement: pipeline.progressionRules?.optimization?.minImprovement ?? 5
          }
        : undefined,
      parallelism: {
        maxConcurrentBacktests: 2,
        maxConcurrentWindows: 2
      },
      maxCoins: config.maxCoins
    });

    // Store optimization run reference
    pipeline.optimizationRunId = run.id;
    await this.pipelineRepository.save(pipeline);

    this.logger.log(`Started optimization run ${run.id} for pipeline ${pipeline.id}`);
  }

  private async executeHistoricalStage(pipeline: Pipeline): Promise<void> {
    const config = pipeline.stageConfig.historical;
    const marketDataSetId = config.marketDataSetId ?? (await this.backtestService.getDefaultDatasetId());
    if (!marketDataSetId) {
      throw new Error('No market data set configured and no auto-generated dataset available');
    }

    // Create historical backtest (createBacktest auto-queues execution)
    const backtest = await this.backtestService.createBacktest(pipeline.user as User, {
      name: `Pipeline ${pipeline.name} - Historical`,
      type: BacktestType.HISTORICAL,
      algorithmId: pipeline.strategyConfig.algorithmId,
      marketDataSetId,
      startDate: config.startDate,
      endDate: config.endDate,
      initialCapital: config.initialCapital,
      tradingFee: config.tradingFee ?? 0.001,
      strategyParams: pipeline.optimizedParameters as Record<string, any>
    });

    // Store backtest reference
    pipeline.historicalBacktestId = backtest.id;
    await this.pipelineRepository.save(pipeline);

    this.logger.log(`Started historical backtest ${backtest.id} for pipeline ${pipeline.id}`);
  }

  private async executeLiveReplayStage(pipeline: Pipeline): Promise<void> {
    const config = pipeline.stageConfig.liveReplay;
    const marketDataSetId = config.marketDataSetId ?? (await this.backtestService.getDefaultDatasetId());
    if (!marketDataSetId) {
      throw new Error('No market data set configured and no auto-generated dataset available');
    }

    // Create live replay backtest (createBacktest auto-queues execution)
    const backtest = await this.backtestService.createBacktest(pipeline.user as User, {
      name: `Pipeline ${pipeline.name} - Live Replay`,
      type: BacktestType.LIVE_REPLAY,
      algorithmId: pipeline.strategyConfig.algorithmId,
      marketDataSetId,
      startDate: config.startDate,
      endDate: config.endDate,
      initialCapital: config.initialCapital,
      tradingFee: config.tradingFee ?? 0.001,
      strategyParams: pipeline.optimizedParameters as Record<string, any>
    });

    // Store backtest reference
    pipeline.liveReplayBacktestId = backtest.id;
    await this.pipelineRepository.save(pipeline);

    this.logger.log(`Started live replay backtest ${backtest.id} for pipeline ${pipeline.id}`);
  }

  private async executePaperTradingStage(pipeline: Pipeline): Promise<void> {
    const config = pipeline.stageConfig.paperTrading;

    // Ensure user is loaded
    if (!pipeline.user?.id) {
      throw new Error(`Pipeline ${pipeline.id} missing user relation for paper trading stage`);
    }

    // Start paper trading session through the pipeline integration method
    const session = await this.paperTradingService.startFromPipeline({
      pipelineId: pipeline.id,
      algorithmId: pipeline.strategyConfig.algorithmId,
      exchangeKeyId: pipeline.exchangeKeyId,
      initialCapital: config.initialCapital,
      optimizedParameters: pipeline.optimizedParameters as Record<string, number>,
      duration: config.duration,
      stopConditions: config.stopConditions,
      userId: pipeline.user.id,
      name: `Pipeline ${pipeline.name} - Paper Trading`
    });

    // Store session reference
    pipeline.paperTradingSessionId = session.id;
    await this.pipelineRepository.save(pipeline);

    this.logger.log(`Started paper trading session ${session.id} for pipeline ${pipeline.id}`);
  }

  // Stage control methods

  private async pauseCurrentStage(pipeline: Pipeline): Promise<void> {
    switch (pipeline.currentStage) {
      case PipelineStage.OPTIMIZE:
        // Optimization runs cannot be paused mid-execution
        // The pause will prevent stage advancement until resumed
        this.logger.log(
          `Pipeline ${pipeline.id} paused during OPTIMIZE stage (optimization will complete but not advance)`
        );
        break;
      case PipelineStage.HISTORICAL:
      case PipelineStage.LIVE_REPLAY:
        if (pipeline.historicalBacktestId || pipeline.liveReplayBacktestId) {
          const backtestId =
            pipeline.currentStage === PipelineStage.HISTORICAL
              ? pipeline.historicalBacktestId
              : pipeline.liveReplayBacktestId;
          if (backtestId) {
            await this.backtestService.pauseBacktest(pipeline.user as User, backtestId);
          }
        }
        break;
      case PipelineStage.PAPER_TRADE:
        if (pipeline.paperTradingSessionId) {
          await this.paperTradingService.pause(pipeline.paperTradingSessionId, pipeline.user as User);
        }
        break;
    }
  }

  private async resumeCurrentStage(pipeline: Pipeline, user: User): Promise<void> {
    switch (pipeline.currentStage) {
      case PipelineStage.OPTIMIZE:
        // If optimization was running when paused, it will continue on its own
        // If optimization hasn't started yet, re-queue it
        if (!pipeline.optimizationRunId) {
          await this.pipelineQueue.add(
            'execute-stage',
            {
              pipelineId: pipeline.id,
              userId: user.id,
              stage: pipeline.currentStage
            } as PipelineJobData,
            {
              jobId: `pipeline-${pipeline.id}-${pipeline.currentStage}-${Date.now()}`
            }
          );
        } else {
          this.logger.log(
            `Pipeline ${pipeline.id} resumed - optimization run ${pipeline.optimizationRunId} still in progress`
          );
        }
        break;
      case PipelineStage.HISTORICAL:
      case PipelineStage.LIVE_REPLAY:
        if (pipeline.historicalBacktestId || pipeline.liveReplayBacktestId) {
          const backtestId =
            pipeline.currentStage === PipelineStage.HISTORICAL
              ? pipeline.historicalBacktestId
              : pipeline.liveReplayBacktestId;
          if (backtestId) {
            await this.backtestService.resumeBacktest(user, backtestId);
          }
        }
        break;
      case PipelineStage.PAPER_TRADE:
        if (pipeline.paperTradingSessionId) {
          await this.paperTradingService.resume(pipeline.paperTradingSessionId, user);
        }
        break;
      default:
        // Re-queue stage execution with unique job ID
        await this.pipelineQueue.add(
          'execute-stage',
          {
            pipelineId: pipeline.id,
            userId: user.id,
            stage: pipeline.currentStage
          } as PipelineJobData,
          {
            jobId: `pipeline-${pipeline.id}-${pipeline.currentStage}-${Date.now()}`
          }
        );
    }
  }

  private async cancelCurrentStage(pipeline: Pipeline): Promise<void> {
    switch (pipeline.currentStage) {
      case PipelineStage.OPTIMIZE:
        if (pipeline.optimizationRunId) {
          await this.optimizationService.cancelOptimization(pipeline.optimizationRunId);
        }
        break;
      case PipelineStage.HISTORICAL:
      case PipelineStage.LIVE_REPLAY: {
        const backtestId =
          pipeline.currentStage === PipelineStage.HISTORICAL
            ? pipeline.historicalBacktestId
            : pipeline.liveReplayBacktestId;
        if (backtestId) {
          await this.backtestService.cancelBacktest(pipeline.user as User, backtestId);
        }
        break;
      }
      case PipelineStage.PAPER_TRADE:
        if (pipeline.paperTradingSessionId) {
          await this.paperTradingService.stop(
            pipeline.paperTradingSessionId,
            pipeline.user as User,
            'pipeline_cancelled'
          );
        }
        break;
    }
  }
}
