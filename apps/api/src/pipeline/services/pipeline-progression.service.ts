import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { MarketRegimeType } from '@chansey/api-interfaces';

import { PipelineStageExecutionService } from './pipeline-stage-execution.service';

import { MarketRegimeService } from '../../market-regime/market-regime.service';
import { CorrelationScoringService } from '../../scoring/correlation-scoring.service';
import { ScoringService } from '../../scoring/scoring.service';
import { DegradationCalculator } from '../../scoring/walk-forward/degradation.calculator';
import { Pipeline } from '../entities/pipeline.entity';
import {
  DeploymentRecommendation,
  PIPELINE_EVENTS,
  PipelineScoreResult,
  PipelineStage,
  PipelineStageResults,
  PipelineStatus,
  StageProgressionThresholds
} from '../interfaces';

@Injectable()
export class PipelineProgressionService {
  private readonly logger = new Logger(PipelineProgressionService.name);

  constructor(
    @InjectRepository(Pipeline)
    private readonly pipelineRepository: Repository<Pipeline>,
    private readonly stageExecutionService: PipelineStageExecutionService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => ScoringService))
    private readonly scoringService: ScoringService,
    @Inject(forwardRef(() => MarketRegimeService))
    private readonly marketRegimeService: MarketRegimeService,
    @Inject(forwardRef(() => DegradationCalculator))
    private readonly degradationCalculator: DegradationCalculator,
    @Inject(forwardRef(() => CorrelationScoringService))
    private readonly correlationScoringService: CorrelationScoringService
  ) {}

  evaluateOptimizationProgression(
    pipeline: Pipeline,
    improvement: number,
    bestScore: number
  ): { passed: boolean; failures: string[] } {
    const minImprovement = pipeline.progressionRules.optimization.minImprovement;
    const minAbsoluteScore = pipeline.progressionRules.optimization.minAbsoluteScore ?? 0;
    const failures: string[] = [];

    if (bestScore < minAbsoluteScore) {
      failures.push(
        `Best test score ${bestScore.toFixed(2)} < minimum ${minAbsoluteScore.toFixed(2)} ` +
          `— all tested combinations lost money in walk-forward testing`
      );
    }
    if (improvement < minImprovement) {
      failures.push(`Improvement ${improvement.toFixed(2)}% < min ${minImprovement.toFixed(2)}%`);
    }
    return { passed: failures.length === 0, failures };
  }

  evaluateStageProgression(
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

  async calculatePipelineScore(
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
    const historical = pipeline.stageResults?.historical;
    const degradation = historical
      ? this.degradationCalculator.calculateFromValues({
          sharpeRatio: { train: historical.sharpeRatio, test: metrics.sharpeRatio },
          totalReturn: { train: historical.totalReturn, test: metrics.totalReturn },
          maxDrawdown: { train: historical.maxDrawdown, test: metrics.maxDrawdown },
          winRate: { train: historical.winRate, test: metrics.winRate },
          ...(historical.profitFactor != null
            ? { profitFactor: { train: historical.profitFactor, test: metrics.profitFactor } }
            : {}),
          ...(historical.volatility != null
            ? { volatility: { train: historical.volatility, test: metrics.volatility } }
            : {})
        })
      : 0;

    let regimeType: MarketRegimeType | undefined;
    try {
      const regime = await this.marketRegimeService.getCurrentRegime('BTC');
      regimeType = regime?.regime;
    } catch (error) {
      this.logger.warn(`Failed to fetch market regime, using no modifier: ${error}`);
    }

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

    let correlationValue = 0;
    try {
      correlationValue = await this.correlationScoringService.calculateMaxCorrelation(
        pipeline.strategyConfigId,
        pipeline.user.id
      );
    } catch (error) {
      this.logger.warn(`Failed to calculate correlation for strategy ${pipeline.strategyConfigId}: ${error}`);
    }

    const result = this.scoringService.calculateScoreFromMetrics(
      scoringMetrics,
      this.toEffectiveDegradation(degradation),
      { marketRegime: regimeType, correlationValue }
    );

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

  generateRecommendation(stageResults?: PipelineStageResults): DeploymentRecommendation {
    if (!stageResults) {
      return DeploymentRecommendation.DO_NOT_DEPLOY;
    }

    const pipelineScore = stageResults.scoring?.overallScore;
    if (pipelineScore !== undefined) {
      if (pipelineScore >= 70) return DeploymentRecommendation.DEPLOY;
      if (pipelineScore >= 30) return DeploymentRecommendation.NEEDS_REVIEW;
      return DeploymentRecommendation.DO_NOT_DEPLOY;
    }

    const optimizationOk = !stageResults.optimization || stageResults.optimization.status === 'COMPLETED';
    const allStagesPassed =
      optimizationOk &&
      stageResults.historical?.status === 'COMPLETED' &&
      stageResults.liveReplay?.status === 'COMPLETED' &&
      (stageResults.paperTrading?.status === 'COMPLETED' || stageResults.paperTrading?.status === 'STOPPED');

    if (!allStagesPassed) {
      return DeploymentRecommendation.DO_NOT_DEPLOY;
    }

    const hist = stageResults.historical;
    const paper = stageResults.paperTrading;

    const avgDegradation =
      hist && paper
        ? this.toEffectiveDegradation(
            this.degradationCalculator.calculateFromValues({
              sharpeRatio: { train: hist.sharpeRatio, test: paper.sharpeRatio ?? 0 },
              totalReturn: { train: hist.totalReturn, test: paper.totalReturn ?? 0 },
              maxDrawdown: { train: hist.maxDrawdown, test: paper.maxDrawdown ?? 0 },
              winRate: { train: hist.winRate, test: paper.winRate ?? 0 }
            })
          )
        : 0;

    const finalSharpe = stageResults.paperTrading?.sharpeRatio ?? 0;
    const finalDrawdown = stageResults.paperTrading?.maxDrawdown ?? 1;
    const finalWinRate = stageResults.paperTrading?.winRate ?? 0;

    if (
      finalSharpe >= 1.0 &&
      finalDrawdown <= 0.25 &&
      finalWinRate >= 0.5 &&
      avgDegradation <= 20 &&
      (paper?.totalReturn ?? 0) > 0
    ) {
      return DeploymentRecommendation.DEPLOY;
    }

    if (finalSharpe >= 0.5 && finalDrawdown <= 0.4 && finalWinRate >= 0.4 && avgDegradation <= 40) {
      return DeploymentRecommendation.NEEDS_REVIEW;
    }

    return DeploymentRecommendation.DO_NOT_DEPLOY;
  }

  async advanceToNextStage(pipeline: Pipeline): Promise<void> {
    const stageOrder: PipelineStage[] = [
      PipelineStage.OPTIMIZE,
      PipelineStage.HISTORICAL,
      PipelineStage.LIVE_REPLAY,
      PipelineStage.PAPER_TRADE,
      PipelineStage.COMPLETED
    ];

    const currentIndex = stageOrder.indexOf(pipeline.currentStage);
    if (currentIndex === -1) {
      throw new Error(`Pipeline ${pipeline.id}: unknown stage '${pipeline.currentStage}', cannot advance`);
    }
    if (currentIndex >= stageOrder.length - 1) {
      throw new Error(`Pipeline ${pipeline.id}: already at final stage '${pipeline.currentStage}', cannot advance`);
    }

    const nextStage = stageOrder[currentIndex + 1];

    const previousStage = pipeline.currentStage;
    pipeline.currentStage = nextStage;
    pipeline.stageTransitionedAt = new Date();
    await this.pipelineRepository.save(pipeline);

    this.logger.log(`Pipeline ${pipeline.id} advanced from ${previousStage} to ${nextStage}`);

    this.eventEmitter.emit(PIPELINE_EVENTS.PIPELINE_STAGE_TRANSITION, {
      pipelineId: pipeline.id,
      previousStage,
      newStage: nextStage,
      timestamp: new Date().toISOString()
    });

    if (nextStage === PipelineStage.COMPLETED) {
      await this.completePipeline(pipeline);
    } else if (pipeline.status === PipelineStatus.RUNNING) {
      if (!pipeline.user?.id) {
        throw new Error(`Pipeline ${pipeline.id} missing user relation for stage advancement`);
      }

      await this.stageExecutionService.enqueueStageJob(pipeline, nextStage, pipeline.user.id);
    } else {
      this.logger.log(
        `Pipeline ${pipeline.id} advanced to ${nextStage} without enqueueing because status is ${pipeline.status} — will enqueue on resume`
      );
    }
  }

  async completePipeline(pipeline: Pipeline): Promise<void> {
    pipeline.status = PipelineStatus.COMPLETED;
    pipeline.currentStage = PipelineStage.COMPLETED;
    pipeline.completedAt = new Date();
    pipeline.stageTransitionedAt = new Date();
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
   * Converts raw degradation to an effective value for scoring.
   * Positive (overfitting): full penalty.
   * Negative (inconsistency): half penalty — large swings are unreliable regardless of direction.
   */
  private toEffectiveDegradation(raw: number): number {
    return raw >= 0 ? raw : Math.abs(raw) * 0.5;
  }

  /**
   * Mark a pipeline as FAILED due to an infrastructure error — worker crash,
   * enqueue failure, or watchdog reap. These indicate something is broken and
   * someone should investigate. For business-rule rejections (threshold gates,
   * zero trades, low scores), use `rejectPipeline()` instead.
   */
  async failPipeline(pipeline: Pipeline, reason: string): Promise<void> {
    pipeline.status = PipelineStatus.FAILED;
    pipeline.completedAt = new Date();
    pipeline.failureReason = reason;
    pipeline.recommendation = DeploymentRecommendation.DO_NOT_DEPLOY;

    await this.pipelineRepository.save(pipeline);

    this.logger.error(`Pipeline ${pipeline.id} failed: ${reason}`);

    this.eventEmitter.emit(PIPELINE_EVENTS.PIPELINE_FAILED, {
      pipelineId: pipeline.id,
      reason,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Mark a pipeline as REJECTED because the strategy completed its stage
   * cleanly but did not meet promotion thresholds (e.g. optimization
   * improvement too low, zero trades, score below minimum, paper-trading
   * metrics below gates). This is a valid outcome — the strategy just did not
   * qualify — and should not trigger infrastructure alerts. For real failures,
   * use `failPipeline()`.
   */
  async rejectPipeline(pipeline: Pipeline, reason: string): Promise<void> {
    pipeline.status = PipelineStatus.REJECTED;
    pipeline.completedAt = new Date();
    pipeline.failureReason = reason;
    pipeline.recommendation = DeploymentRecommendation.DO_NOT_DEPLOY;

    await this.pipelineRepository.save(pipeline);

    this.logger.log(`Pipeline ${pipeline.id} rejected: ${reason}`);

    this.eventEmitter.emit(PIPELINE_EVENTS.PIPELINE_REJECTED, {
      pipelineId: pipeline.id,
      reason,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Mark a pipeline as COMPLETED with an INCONCLUSIVE_RETRY recommendation.
   *
   * Used when the paper-trading stage terminated early due to signal starvation
   * — the strategy is not a fit for the current market regime, but this is a
   * neutral outcome (not a bug / not a failure). The orchestrator will retry
   * on its next cycle with fresh optimization parameters.
   */
  async markInconclusiveAndComplete(pipeline: Pipeline, reason: string): Promise<void> {
    pipeline.status = PipelineStatus.COMPLETED;
    pipeline.currentStage = PipelineStage.COMPLETED;
    pipeline.completedAt = new Date();
    pipeline.stageTransitionedAt = new Date();
    pipeline.recommendation = DeploymentRecommendation.INCONCLUSIVE_RETRY;
    pipeline.pipelineScore = null;
    pipeline.scoreGrade = null;
    pipeline.failureReason = null;

    await this.pipelineRepository.save(pipeline);

    this.logger.log(`Pipeline ${pipeline.id} marked inconclusive: ${reason}`);

    this.eventEmitter.emit(PIPELINE_EVENTS.PIPELINE_COMPLETED, {
      pipelineId: pipeline.id,
      recommendation: pipeline.recommendation,
      inconclusive: true,
      reason,
      timestamp: new Date().toISOString()
    });
  }
}
