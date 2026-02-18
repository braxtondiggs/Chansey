import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { Pipeline } from '../entities/pipeline.entity';
import {
  DeploymentRecommendation,
  PipelineStage,
  PipelineStageResults,
  PipelineSummaryReport,
  PipelineWarning,
  StageComparison
} from '../interfaces';

@Injectable()
export class PipelineReportService {
  private readonly logger = new Logger(PipelineReportService.name);

  constructor(
    @InjectRepository(Pipeline)
    private readonly pipelineRepository: Repository<Pipeline>
  ) {}

  /**
   * Generate comprehensive summary report for a completed pipeline
   */
  async generateSummaryReport(pipelineId: string): Promise<PipelineSummaryReport> {
    const pipeline = await this.pipelineRepository.findOne({
      where: { id: pipelineId },
      relations: ['strategyConfig']
    });

    if (!pipeline) {
      throw new NotFoundException(`Pipeline ${pipelineId} not found`);
    }

    const stageResults = pipeline.stageResults;
    if (!stageResults) {
      throw new Error('Pipeline has no stage results');
    }

    const stageComparison = this.buildStageComparison(stageResults);
    const averageMetrics = this.calculateAverageMetrics(stageResults);
    const consistencyScore = this.calculateConsistencyScore(stageComparison);
    const { warnings, warningDetails } = this.detectWarnings(stageResults, stageComparison);
    const recommendation = this.generateRecommendation(stageResults, consistencyScore, warnings);
    const confidenceScore = this.calculateConfidenceScore(stageResults, consistencyScore, warnings);

    const totalDurationHours =
      pipeline.completedAt && pipeline.startedAt
        ? (pipeline.completedAt.getTime() - pipeline.startedAt.getTime()) / (1000 * 60 * 60)
        : 0;

    const report: PipelineSummaryReport = {
      pipelineId,
      strategyConfigId: pipeline.strategyConfigId,
      strategyName: pipeline.strategyConfig?.name ?? 'Unknown Strategy',
      recommendation,
      confidenceScore,
      deployableParameters: pipeline.optimizedParameters ?? {},
      stageComparison,
      averageMetrics,
      consistencyScore,
      pipelineScore: pipeline.pipelineScore != null ? Number(pipeline.pipelineScore) : undefined,
      scoreGrade: pipeline.scoreGrade ?? undefined,
      scoringRegime: pipeline.scoringRegime ?? undefined,
      warnings,
      warningDetails,
      totalDurationHours,
      generatedAt: new Date().toISOString()
    };

    // Save report to pipeline
    pipeline.summaryReport = report;
    pipeline.recommendation = recommendation;
    await this.pipelineRepository.save(pipeline);

    this.logger.log(
      `Generated summary report for pipeline ${pipelineId}: ${recommendation} ` + `(confidence: ${confidenceScore}%)`
    );

    return report;
  }

  /**
   * Build stage comparison array
   */
  private buildStageComparison(stageResults: PipelineStageResults): StageComparison[] {
    const comparisons: StageComparison[] = [];
    let previousReturn: number | null = null;

    // Historical stage
    if (stageResults.historical) {
      comparisons.push({
        stage: PipelineStage.HISTORICAL,
        sharpeRatio: stageResults.historical.sharpeRatio,
        totalReturn: stageResults.historical.totalReturn,
        maxDrawdown: stageResults.historical.maxDrawdown,
        winRate: stageResults.historical.winRate
      });
      previousReturn = stageResults.historical.totalReturn;
    }

    // Live replay stage
    if (stageResults.liveReplay) {
      const degradation =
        previousReturn !== null && previousReturn !== 0
          ? ((previousReturn - stageResults.liveReplay.totalReturn) / Math.abs(previousReturn)) * 100
          : undefined;

      comparisons.push({
        stage: PipelineStage.LIVE_REPLAY,
        sharpeRatio: stageResults.liveReplay.sharpeRatio,
        totalReturn: stageResults.liveReplay.totalReturn,
        maxDrawdown: stageResults.liveReplay.maxDrawdown,
        winRate: stageResults.liveReplay.winRate,
        degradationFromPrevious: degradation
      });
      previousReturn = stageResults.liveReplay.totalReturn;
    }

    // Paper trading stage
    if (stageResults.paperTrading) {
      const degradation =
        previousReturn !== null && previousReturn !== 0
          ? ((previousReturn - stageResults.paperTrading.totalReturn) / Math.abs(previousReturn)) * 100
          : undefined;

      comparisons.push({
        stage: PipelineStage.PAPER_TRADE,
        sharpeRatio: stageResults.paperTrading.sharpeRatio,
        totalReturn: stageResults.paperTrading.totalReturn,
        maxDrawdown: stageResults.paperTrading.maxDrawdown,
        winRate: stageResults.paperTrading.winRate,
        degradationFromPrevious: degradation
      });
    }

    return comparisons;
  }

  /**
   * Calculate average metrics across execution stages
   */
  private calculateAverageMetrics(stageResults: PipelineStageResults): {
    sharpeRatio: number;
    totalReturn: number;
    maxDrawdown: number;
    winRate: number;
  } {
    const metrics = [stageResults.historical, stageResults.liveReplay, stageResults.paperTrading].filter(Boolean);

    if (metrics.length === 0) {
      return { sharpeRatio: 0, totalReturn: 0, maxDrawdown: 0, winRate: 0 };
    }

    return {
      sharpeRatio: metrics.reduce((sum, m) => sum + (m?.sharpeRatio ?? 0), 0) / metrics.length,
      totalReturn: metrics.reduce((sum, m) => sum + (m?.totalReturn ?? 0), 0) / metrics.length,
      maxDrawdown: metrics.reduce((sum, m) => sum + (m?.maxDrawdown ?? 0), 0) / metrics.length,
      winRate: metrics.reduce((sum, m) => sum + (m?.winRate ?? 0), 0) / metrics.length
    };
  }

  /**
   * Calculate consistency score based on metric variance across stages
   * Higher score = more consistent performance
   */
  private calculateConsistencyScore(stageComparison: StageComparison[]): number {
    if (stageComparison.length < 2) {
      return 100; // Single stage is perfectly consistent
    }

    // Calculate variance for each metric
    const sharpeValues = stageComparison.map((s) => s.sharpeRatio);
    const returnValues = stageComparison.map((s) => s.totalReturn);

    const sharpeVariance = this.calculateVariance(sharpeValues);
    const returnVariance = this.calculateVariance(returnValues);

    // Normalize variances to 0-50 range each (total 0-100)
    // Lower variance = higher consistency score
    const sharpeScore = Math.max(0, 50 - sharpeVariance * 25);
    const returnScore = Math.max(0, 50 - returnVariance * 100);

    return Math.round(sharpeScore + returnScore);
  }

  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  }

  /**
   * Detect warnings and anomalies in results
   */
  private detectWarnings(
    stageResults: PipelineStageResults,
    stageComparison: StageComparison[]
  ): { warnings: PipelineWarning[]; warningDetails: string[] } {
    const warnings: PipelineWarning[] = [];
    const warningDetails: string[] = [];

    // Check for high degradation
    for (const stage of stageComparison) {
      if (stage.degradationFromPrevious !== undefined && stage.degradationFromPrevious > 30) {
        warnings.push('HIGH_DEGRADATION');
        warningDetails.push(
          `${stage.stage} showed ${stage.degradationFromPrevious.toFixed(1)}% degradation from previous stage`
        );
      }
    }

    // Check for low trade count
    const totalTrades = [
      stageResults.historical?.totalTrades,
      stageResults.liveReplay?.totalTrades,
      stageResults.paperTrading?.totalTrades
    ].filter((t): t is number => t !== undefined);

    if (totalTrades.length > 0) {
      const minTrades = Math.min(...totalTrades);
      if (minTrades < 10) {
        warnings.push('LOW_TRADE_COUNT');
        warningDetails.push(`Minimum trade count across stages is only ${minTrades}`);
      }
    }

    // Check for high drawdown
    const drawdowns = stageComparison.map((s) => s.maxDrawdown);
    if (drawdowns.length > 0) {
      const maxDrawdown = Math.max(...drawdowns);
      if (maxDrawdown > 0.3) {
        warnings.push('HIGH_DRAWDOWN');
        warningDetails.push(`Maximum drawdown of ${(maxDrawdown * 100).toFixed(1)}% detected`);
      }
    }

    // Check for poor win rate
    const winRates = stageComparison.map((s) => s.winRate);
    if (winRates.length > 0) {
      const minWinRate = Math.min(...winRates);
      if (minWinRate < 0.4) {
        warnings.push('POOR_WIN_RATE');
        warningDetails.push(`Minimum win rate of ${(minWinRate * 100).toFixed(1)}% detected`);
      }
    }

    // Check for negative return
    const finalReturn = stageResults.paperTrading?.totalReturn ?? 0;
    if (finalReturn < 0) {
      warnings.push('NEGATIVE_RETURN');
      warningDetails.push(`Paper trading finished with negative return of ${(finalReturn * 100).toFixed(2)}%`);
    }

    // Check for inconsistent metrics (potential overfitting)
    const sharpeValues = stageComparison.map((s) => s.sharpeRatio);
    if (sharpeValues.length >= 2) {
      const sharpeVariance = this.calculateVariance(sharpeValues);
      if (sharpeVariance > 0.5 && sharpeValues[0] > sharpeValues[sharpeValues.length - 1] + 0.5) {
        warnings.push('OVERFITTING_SUSPECTED');
        warningDetails.push('Sharpe ratio declined significantly across stages, suggesting possible overfitting');
      }
    }

    // Check for inconsistent metrics across stages
    if (this.calculateConsistencyScore(stageComparison) < 50) {
      warnings.push('INCONSISTENT_METRICS');
      warningDetails.push('Performance metrics varied significantly across stages');
    }

    return { warnings, warningDetails };
  }

  /**
   * Generate deployment recommendation
   */
  private generateRecommendation(
    stageResults: PipelineStageResults,
    consistencyScore: number,
    warnings: PipelineWarning[]
  ): DeploymentRecommendation {
    // Automatic DO_NOT_DEPLOY conditions
    const criticalWarnings: PipelineWarning[] = ['NEGATIVE_RETURN', 'OVERFITTING_SUSPECTED'];

    if (warnings.some((w) => criticalWarnings.includes(w))) {
      return DeploymentRecommendation.DO_NOT_DEPLOY;
    }

    // Get final metrics from paper trading
    const pt = stageResults.paperTrading;
    if (!pt) {
      return DeploymentRecommendation.DO_NOT_DEPLOY;
    }

    // Strong performance = DEPLOY
    if (
      pt.sharpeRatio >= 1.0 &&
      pt.maxDrawdown <= 0.25 &&
      pt.winRate >= 0.5 &&
      pt.totalReturn > 0.05 &&
      consistencyScore >= 70 &&
      warnings.length === 0
    ) {
      return DeploymentRecommendation.DEPLOY;
    }

    // Acceptable performance = NEEDS_REVIEW
    if (
      pt.sharpeRatio >= 0.5 &&
      pt.maxDrawdown <= 0.4 &&
      pt.winRate >= 0.4 &&
      pt.totalReturn >= 0 &&
      consistencyScore >= 40
    ) {
      return DeploymentRecommendation.NEEDS_REVIEW;
    }

    return DeploymentRecommendation.DO_NOT_DEPLOY;
  }

  /**
   * Calculate confidence score for the recommendation
   */
  private calculateConfidenceScore(
    stageResults: PipelineStageResults,
    consistencyScore: number,
    warnings: PipelineWarning[]
  ): number {
    let score = 50; // Base score

    // Add points for good metrics
    const pt = stageResults.paperTrading;
    if (pt) {
      if (pt.sharpeRatio >= 1.5) score += 15;
      else if (pt.sharpeRatio >= 1.0) score += 10;
      else if (pt.sharpeRatio >= 0.5) score += 5;

      if (pt.totalReturn >= 0.2) score += 10;
      else if (pt.totalReturn >= 0.1) score += 5;

      if (pt.maxDrawdown <= 0.15) score += 10;
      else if (pt.maxDrawdown <= 0.25) score += 5;

      if (pt.totalTrades >= 50) score += 5;
    }

    // Add points for consistency
    score += Math.round(consistencyScore / 5);

    // Subtract points for warnings
    score -= warnings.length * 10;

    // Clamp to 0-100
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Get pipeline report (if already generated)
   */
  async getReport(pipelineId: string): Promise<PipelineSummaryReport | null> {
    const pipeline = await this.pipelineRepository.findOne({
      where: { id: pipelineId },
      relations: ['strategyConfig']
    });

    if (!pipeline) {
      throw new NotFoundException(`Pipeline ${pipelineId} not found`);
    }

    if (pipeline.summaryReport) {
      return pipeline.summaryReport;
    }

    // Generate if pipeline is completed but no report exists
    if (pipeline.currentStage === PipelineStage.COMPLETED && pipeline.stageResults) {
      return this.generateSummaryReport(pipelineId);
    }

    return null;
  }
}
