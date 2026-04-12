import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, FindOptionsWhere, Repository } from 'typeorm';

import { PipelineEventHandlerService } from './pipeline-event-handler.service';
import { PipelineProgressionService } from './pipeline-progression.service';
import { PipelineStageExecutionService } from './pipeline-stage-execution.service';

import { toErrorInfo } from '../../shared/error.util';
import { StrategyConfig } from '../../strategy/entities/strategy-config.entity';
import { User } from '../../users/users.entity';
import { CreatePipelineInput, PipelineFiltersDto } from '../dto';
import { Pipeline } from '../entities/pipeline.entity';
import {
  DEFAULT_PROGRESSION_RULES,
  OptimizationStageResult,
  PipelineProgressionRules,
  PipelineStage,
  PipelineStatus
} from '../interfaces';

@Injectable()
export class PipelineOrchestratorService {
  private readonly logger = new Logger(PipelineOrchestratorService.name);

  constructor(
    @InjectRepository(Pipeline)
    private readonly pipelineRepository: Repository<Pipeline>,
    @InjectRepository(StrategyConfig)
    private readonly strategyConfigRepository: Repository<StrategyConfig>,
    private readonly dataSource: DataSource,
    private readonly stageExecutionService: PipelineStageExecutionService,
    private readonly eventHandlerService: PipelineEventHandlerService,
    private readonly progressionService: PipelineProgressionService
  ) {}

  async createPipeline(dto: CreatePipelineInput, user: User): Promise<Pipeline> {
    const strategyConfig = await this.strategyConfigRepository.findOne({
      where: { id: dto.strategyConfigId }
    });
    if (!strategyConfig) {
      throw new NotFoundException(`Strategy config ${dto.strategyConfigId} not found`);
    }

    const progressionRules: PipelineProgressionRules = dto.progressionRules ?? {
      ...DEFAULT_PROGRESSION_RULES
    };

    const pipeline = this.pipelineRepository.create({
      name: dto.name,
      description: dto.description,
      status: PipelineStatus.PENDING,
      currentStage: dto.initialStage ?? PipelineStage.OPTIMIZE,
      strategyConfigId: dto.strategyConfigId,
      stageConfig: dto.stageConfig,
      progressionRules,
      user
    });

    const savedPipeline = await this.pipelineRepository.save(pipeline);
    this.logger.log(`Created pipeline ${savedPipeline.id} for strategy ${dto.strategyConfigId}`);
    return this.findOne(savedPipeline.id, user);
  }

  async findOne(id: string, user: User): Promise<Pipeline> {
    const pipeline = await this.pipelineRepository.findOne({
      where: { id, user: { id: user.id } },
      relations: ['strategyConfig', 'user']
    });

    if (!pipeline) {
      throw new NotFoundException(`Pipeline ${id} not found`);
    }

    return pipeline;
  }

  private buildFilterWhere(filters: PipelineFiltersDto, userId?: string): FindOptionsWhere<Pipeline> {
    const where: FindOptionsWhere<Pipeline> = userId ? { user: { id: userId } } : {};

    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.currentStage) {
      where.currentStage = filters.currentStage;
    }
    if (filters.strategyConfigId) {
      where.strategyConfigId = filters.strategyConfigId;
    }

    return where;
  }

  async findAll(user: User, filters: PipelineFiltersDto): Promise<{ data: Pipeline[]; total: number }> {
    const where = this.buildFilterWhere(filters, user.id);

    const [data, total] = await this.pipelineRepository.findAndCount({
      where,
      relations: ['strategyConfig'],
      order: { createdAt: 'DESC' },
      take: filters.limit ?? 20,
      skip: filters.offset ?? 0
    });

    return { data, total };
  }

  async findAllAdmin(filters: PipelineFiltersDto): Promise<{ data: Pipeline[]; total: number }> {
    const where = this.buildFilterWhere(filters);

    const [data, total] = await this.pipelineRepository.findAndCount({
      where,
      relations: ['strategyConfig', 'user'],
      order: { createdAt: 'DESC' },
      take: filters.limit ?? 20,
      skip: filters.offset ?? 0
    });

    return { data, total };
  }

  async findOneAdmin(id: string): Promise<Pipeline> {
    const pipeline = await this.pipelineRepository.findOne({
      where: { id },
      relations: ['strategyConfig', 'user']
    });

    if (!pipeline) {
      throw new NotFoundException(`Pipeline ${id} not found`);
    }

    return pipeline;
  }

  private async cancelPipelineInternal(pipeline: Pipeline, reason: string): Promise<void> {
    if (pipeline.status === PipelineStatus.COMPLETED || pipeline.status === PipelineStatus.CANCELLED) {
      throw new BadRequestException('Pipeline is already completed or cancelled');
    }

    // Best-effort downstream cancel first — we want the real workload stopped
    // before we mark the pipeline cancelled, but we must not let a downstream
    // failure block the status flip.
    try {
      await this.stageExecutionService.cancelCurrentStage(pipeline);
    } catch (err) {
      this.logger.error(
        `Pipeline ${pipeline.id}: downstream cancelCurrentStage failed; proceeding with status flip`,
        toErrorInfo(err)
      );
    }

    await this.dataSource.transaction(async (manager) => {
      pipeline.status = PipelineStatus.CANCELLED;
      pipeline.completedAt = new Date();
      pipeline.failureReason = reason;
      await manager.save(pipeline);
    });

    await this.stageExecutionService.removeStageJob(pipeline.id, pipeline.currentStage);
  }

  async cancelPipelineAdmin(id: string): Promise<Pipeline> {
    const pipeline = await this.findOneAdmin(id);
    await this.cancelPipelineInternal(pipeline, 'Cancelled by admin');
    this.logger.log(`Admin cancelled pipeline ${id}`);
    return this.findOneAdmin(id);
  }

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

    pipeline.status = PipelineStatus.RUNNING;
    pipeline.startedAt = pipeline.startedAt ?? new Date();
    await this.pipelineRepository.save(pipeline);

    try {
      await this.stageExecutionService.enqueueStageJob(pipeline, pipeline.currentStage, user.id);
    } catch (error) {
      // Enqueue failed after commit — mark pipeline FAILED so it doesn't sit RUNNING forever
      const err = toErrorInfo(error);
      this.logger.error(`Failed to enqueue stage job for pipeline ${id}: ${err.message}`);
      await this.pipelineRepository.update(id, {
        status: PipelineStatus.FAILED,
        failureReason: `Failed to enqueue stage job: ${err.message}`,
        completedAt: new Date()
      });
      throw error;
    }

    this.logger.log(`Started pipeline ${id} at stage ${pipeline.currentStage}`);
    return this.findOne(id, user);
  }

  async pausePipeline(id: string, user: User): Promise<Pipeline> {
    const pipeline = await this.findOne(id, user);

    if (pipeline.status !== PipelineStatus.RUNNING) {
      throw new BadRequestException('Can only pause a running pipeline');
    }

    pipeline.status = PipelineStatus.PAUSED;
    await this.pipelineRepository.save(pipeline);

    await this.stageExecutionService.pauseCurrentStage(pipeline);

    this.logger.log(`Paused pipeline ${id} at stage ${pipeline.currentStage}`);
    return this.findOne(id, user);
  }

  async resumePipeline(id: string, user: User): Promise<Pipeline> {
    const pipeline = await this.findOne(id, user);

    if (pipeline.status !== PipelineStatus.PAUSED) {
      throw new BadRequestException('Can only resume a paused pipeline');
    }

    pipeline.status = PipelineStatus.RUNNING;
    await this.pipelineRepository.save(pipeline);

    await this.stageExecutionService.resumeCurrentStage(pipeline, user);

    this.logger.log(`Resumed pipeline ${id} at stage ${pipeline.currentStage}`);
    return this.findOne(id, user);
  }

  async cancelPipeline(id: string, user: User): Promise<Pipeline> {
    const pipeline = await this.findOne(id, user);
    await this.cancelPipelineInternal(pipeline, 'Cancelled by user');
    this.logger.log(`Cancelled pipeline ${id}`);
    return this.findOne(id, user);
  }

  async skipStage(id: string, user: User): Promise<Pipeline> {
    const pipeline = await this.findOne(id, user);

    if (pipeline.status !== PipelineStatus.RUNNING && pipeline.status !== PipelineStatus.PAUSED) {
      throw new BadRequestException('Can only skip stages for running or paused pipelines');
    }

    if (pipeline.currentStage === PipelineStage.COMPLETED) {
      throw new BadRequestException('Pipeline has already completed all stages');
    }

    this.logger.log(`Skipping stage ${pipeline.currentStage} for pipeline ${id}`);

    await this.stageExecutionService.cancelCurrentStage(pipeline);
    await this.progressionService.advanceToNextStage(pipeline);

    return this.findOne(id, user);
  }

  async deletePipeline(id: string, user: User): Promise<void> {
    const pipeline = await this.findOne(id, user);

    if (pipeline.status === PipelineStatus.RUNNING) {
      throw new BadRequestException('Cannot delete a running pipeline. Cancel it first.');
    }

    await this.pipelineRepository.remove(pipeline);
    this.logger.log(`Deleted pipeline ${id}`);
  }

  /**
   * Record that the optimization stage was skipped (e.g., when starting at HISTORICAL).
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

  // Thin delegators — preserve public API

  async executeStage(pipelineId: string, stage: PipelineStage): Promise<void> {
    return this.stageExecutionService.executeStage(pipelineId, stage);
  }

  async handleOptimizationComplete(
    runId: string,
    strategyConfigId: string,
    bestParameters: Record<string, unknown>,
    bestScore: number,
    improvement: number
  ): Promise<void> {
    return this.eventHandlerService.handleOptimizationComplete(
      runId,
      strategyConfigId,
      bestParameters,
      bestScore,
      improvement
    );
  }

  async handleOptimizationFailed(runId: string, reason: string): Promise<void> {
    return this.eventHandlerService.handleOptimizationFailed(runId, reason);
  }

  async handleBacktestComplete(
    backtestId: string,
    type: 'HISTORICAL' | 'LIVE_REPLAY',
    metrics: {
      sharpeRatio: number;
      totalReturn: number;
      maxDrawdown: number;
      winRate: number;
      totalTrades: number;
      winningTrades: number;
      losingTrades: number;
      profitFactor: number;
      volatility: number;
    }
  ): Promise<void> {
    return this.eventHandlerService.handleBacktestComplete(backtestId, type, metrics);
  }

  async handleBacktestFailed(backtestId: string, type: 'HISTORICAL' | 'LIVE_REPLAY', reason: string): Promise<void> {
    return this.eventHandlerService.handleBacktestFailed(backtestId, type, reason);
  }

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
    return this.eventHandlerService.handlePaperTradingComplete(sessionId, pipelineId, metrics, stoppedReason);
  }
}
