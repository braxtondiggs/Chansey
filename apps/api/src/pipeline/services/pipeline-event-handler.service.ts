import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { PipelineProgressionService } from './pipeline-progression.service';

import { Pipeline } from '../entities/pipeline.entity';
import {
  HistoricalStageResult,
  LiveReplayStageResult,
  OptimizationStageResult,
  PaperTradingStageResult,
  PipelineStage,
  PipelineStatus
} from '../interfaces';

@Injectable()
export class PipelineEventHandlerService {
  private readonly logger = new Logger(PipelineEventHandlerService.name);

  constructor(
    @InjectRepository(Pipeline)
    private readonly pipelineRepository: Repository<Pipeline>,
    private readonly progressionService: PipelineProgressionService
  ) {}

  async handleOptimizationComplete(
    runId: string,
    strategyConfigId: string,
    bestParameters: Record<string, unknown>,
    bestScore: number,
    improvement: number
  ): Promise<void> {
    const pipeline = await this.pipelineRepository.findOne({
      where: {
        optimizationRunId: runId,
        currentStage: PipelineStage.OPTIMIZE,
        status: In([PipelineStatus.RUNNING, PipelineStatus.PAUSED])
      },
      relations: ['user']
    });

    if (!pipeline) {
      this.logger.debug(`No active pipeline found for optimization run ${runId} (strategy ${strategyConfigId})`);
      return;
    }

    this.logger.log(`Optimization completed for pipeline ${pipeline.id}`);

    const optimizationResult: OptimizationStageResult = {
      runId,
      status: 'COMPLETED',
      bestParameters,
      bestScore,
      baselineScore: improvement <= -100 ? 0 : bestScore / (1 + improvement / 100),
      improvement,
      combinationsTested: 0,
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

    const { passed, failures } = this.progressionService.evaluateOptimizationProgression(pipeline, improvement);

    if (!passed) {
      await this.progressionService.failPipeline(
        pipeline,
        `Optimization did not meet progression threshold: ${failures.join('; ')}`
      );
      return;
    }

    if (pipeline.status !== PipelineStatus.RUNNING) {
      this.logger.log(
        `Pipeline ${pipeline.id}: OPTIMIZE completed while PAUSED — results persisted, advancement deferred until resume`
      );
      return;
    }

    await this.progressionService.advanceToNextStage(pipeline);
  }

  async handleOptimizationFailed(runId: string, reason: string): Promise<void> {
    const pipeline = await this.pipelineRepository.findOne({
      where: {
        optimizationRunId: runId,
        currentStage: PipelineStage.OPTIMIZE,
        status: In([PipelineStatus.RUNNING, PipelineStatus.PAUSED])
      },
      relations: ['user']
    });

    if (!pipeline) {
      this.logger.debug(`No active pipeline found for failed optimization run ${runId}`);
      return;
    }

    await this.progressionService.failPipeline(pipeline, `Optimization failed: ${reason}`);
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
    const whereClause =
      type === 'HISTORICAL' ? { historicalBacktestId: backtestId } : { liveReplayBacktestId: backtestId };

    const pipeline = await this.pipelineRepository.findOne({
      where: {
        ...whereClause,
        status: In([PipelineStatus.RUNNING, PipelineStatus.PAUSED])
      },
      relations: ['user']
    });

    if (!pipeline) {
      this.logger.debug(`No active pipeline found for backtest ${backtestId}`);
      return;
    }

    this.logger.log(`Backtest ${type} completed for pipeline ${pipeline.id}`);

    if (metrics.totalTrades === 0) {
      await this.progressionService.failPipeline(
        pipeline,
        `${type} backtest produced 0 trades — cannot advance pipeline`
      );
      return;
    }

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
        annualizedReturn: metrics.totalReturn,
        winningTrades: metrics.winningTrades,
        losingTrades: metrics.losingTrades,
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
        winningTrades: metrics.winningTrades,
        losingTrades: metrics.losingTrades,
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

      if (pipeline.status !== PipelineStatus.RUNNING) {
        this.logger.log(
          `Pipeline ${pipeline.id}: HISTORICAL completed while PAUSED — results persisted, advancement deferred until resume`
        );
        return;
      }

      this.logger.log(`Pipeline ${pipeline.id}: HISTORICAL auto-advancing to LIVE_REPLAY`);
      await this.progressionService.advanceToNextStage(pipeline);
    } else {
      const scoreResult = await this.progressionService.calculatePipelineScore(pipeline, metrics);

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
      if (scoreResult.overallScore < minimumScore) {
        await this.progressionService.failPipeline(
          pipeline,
          `LIVE_REPLAY score ${scoreResult.overallScore.toFixed(1)} < minimum ${minimumScore}`
        );
        return;
      }

      if (pipeline.status !== PipelineStatus.RUNNING) {
        this.logger.log(
          `Pipeline ${pipeline.id}: LIVE_REPLAY completed while PAUSED — results persisted, advancement deferred until resume`
        );
        return;
      }

      this.logger.log(
        `Pipeline ${pipeline.id}: LIVE_REPLAY score ${scoreResult.overallScore.toFixed(1)} >= ${minimumScore}, advancing`
      );
      await this.progressionService.advanceToNextStage(pipeline);
    }
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
      status:
        stoppedReason === 'duration_reached' ||
        stoppedReason === 'target_reached' ||
        stoppedReason === 'min_trades_reached'
          ? 'COMPLETED'
          : 'STOPPED',
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

    const thresholds = pipeline.progressionRules.paperTrading;
    const { passed, failures } = this.progressionService.evaluateStageProgression(
      {
        sharpeRatio: metrics.sharpeRatio ?? 0,
        totalReturn: metrics.totalReturn,
        maxDrawdown: metrics.maxDrawdown,
        winRate: metrics.winRate,
        totalTrades: metrics.totalTrades
      },
      thresholds
    );

    if (!passed) {
      await this.progressionService.failPipeline(
        pipeline,
        `Paper trading did not meet thresholds: ${failures.join('; ')}`
      );
      return;
    }

    if (pipeline.status !== PipelineStatus.RUNNING) {
      this.logger.log(
        `Pipeline ${pipeline.id}: PAPER_TRADE completed while PAUSED — results persisted, advancement deferred until resume`
      );
      return;
    }

    await this.progressionService.completePipeline(pipeline);
  }
}
