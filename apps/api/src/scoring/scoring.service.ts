import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { ComponentScores, GRADE_RANGES, StrategyGrade } from '@chansey/api-interfaces';

import { CalmarRatioCalculator } from './metrics/calmar-ratio.calculator';
import { ProfitFactorCalculator } from './metrics/profit-factor.calculator';
import { StabilityCalculator } from './metrics/stability.calculator';
import { WinRateCalculator } from './metrics/win-rate.calculator';
import { SCORING_WEIGHTS } from './scoring.weights';

import { CorrelationCalculator } from '../common/metrics/correlation.calculator';
import { DrawdownCalculator } from '../common/metrics/drawdown.calculator';
import { SharpeRatioCalculator } from '../common/metrics/sharpe-ratio.calculator';
import { BacktestRun } from '../strategy/entities/backtest-run.entity';
import { StrategyScore } from '../strategy/entities/strategy-score.entity';

/**
 * Unified Scoring Service
 * Calculates comprehensive scores for strategies based on multiple factors
 * Weights based on research.md framework
 */
@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(
    @InjectRepository(StrategyScore)
    private readonly strategyScoreRepo: Repository<StrategyScore>,
    private readonly sharpeCalculator: SharpeRatioCalculator,
    private readonly drawdownCalculator: DrawdownCalculator,
    private readonly correlationCalculator: CorrelationCalculator,
    private readonly calmarCalculator: CalmarRatioCalculator,
    private readonly winRateCalculator: WinRateCalculator,
    private readonly profitFactorCalculator: ProfitFactorCalculator,
    private readonly stabilityCalculator: StabilityCalculator
  ) {}

  /**
   * Calculate comprehensive strategy score
   */
  async calculateScore(
    strategyConfigId: string,
    backtestRun: BacktestRun,
    wfaDegradation: number
  ): Promise<StrategyScore> {
    const results = backtestRun.results;
    if (!results) {
      throw new Error('Backtest results not available');
    }

    // Calculate component scores
    const componentScores = this.calculateComponentScores(results, wfaDegradation);

    // Calculate overall weighted score
    const overallScore = this.calculateOverallScore(componentScores);

    // Calculate percentile (requires comparison with other strategies)
    const percentile = await this.calculatePercentile(strategyConfigId, overallScore);

    // Determine grade
    const grade = this.determineGrade(overallScore);

    // Check promotion eligibility
    const promotionEligible = this.checkPromotionEligibility(overallScore, componentScores, results);

    // Generate warnings
    const warnings = this.generateWarnings(componentScores, results, wfaDegradation);

    // Create and save score
    const score = this.strategyScoreRepo.create({
      strategyConfigId,
      overallScore,
      componentScores,
      percentile,
      grade,
      promotionEligible,
      warnings,
      effectiveDate: new Date().toISOString().split('T')[0],
      backtestRunIds: [backtestRun.id]
    });

    const saved = await this.strategyScoreRepo.save(score);

    this.logger.log(
      `Score calculated for strategy ${strategyConfigId}: ${overallScore.toFixed(2)}/100 (Grade ${grade})`
    );

    return saved;
  }

  /**
   * Calculate component scores for all metrics
   */
  private calculateComponentScores(results: any, wfaDegradation: number): ComponentScores {
    // Sharpe Ratio (25% weight)
    const sharpeScore = this.scoreMetric(results.sharpeRatio, {
      excellent: 2.0,
      good: 1.0,
      acceptable: 0.5,
      poor: 0
    });

    // Calmar Ratio (15% weight)
    const calmarScore = this.scoreMetric(results.calmarRatio || 0, {
      excellent: 2.0,
      good: 1.0,
      acceptable: 0.5,
      poor: 0
    });

    // Win Rate (10% weight) - expects decimal (0.0-1.0)
    const winRateScore = this.scoreMetric(results.winRate, {
      excellent: 0.6,
      good: 0.5,
      acceptable: 0.45,
      poor: 0
    });

    // Profit Factor (10% weight)
    const profitFactorScore = this.scoreMetric(results.profitFactor || 1, {
      excellent: 2.0,
      good: 1.5,
      acceptable: 1.2,
      poor: 1.0
    });

    // WFA Degradation (20% weight) - inverse scoring (lower is better)
    const wfaScore = this.scoreMetricInverse(wfaDegradation, {
      excellent: 10,
      good: 20,
      acceptable: 30,
      poor: 50
    });

    // Stability (10% weight) - based on trade distribution
    const stabilityScore = this.scoreMetric(results.totalTrades, {
      excellent: 100,
      good: 50,
      acceptable: 30,
      poor: 10
    });

    // Correlation (10% weight) - will be calculated separately with other strategies
    const correlationScore = 100; // Default to perfect score, updated later

    return {
      sharpeRatio: {
        value: results.sharpeRatio,
        score: sharpeScore,
        weight: SCORING_WEIGHTS.sharpeRatio,
        percentile: 0 // Updated later
      },
      calmarRatio: {
        value: results.calmarRatio || 0,
        score: calmarScore,
        weight: SCORING_WEIGHTS.calmarRatio,
        percentile: 0
      },
      winRate: {
        value: results.winRate,
        score: winRateScore,
        weight: SCORING_WEIGHTS.winRate,
        percentile: 0
      },
      profitFactor: {
        value: results.profitFactor || 1,
        score: profitFactorScore,
        weight: SCORING_WEIGHTS.profitFactor,
        percentile: 0
      },
      wfaDegradation: {
        value: wfaDegradation,
        score: wfaScore,
        weight: SCORING_WEIGHTS.wfaDegradation,
        percentile: 0
      },
      stability: {
        value: results.totalTrades,
        score: stabilityScore,
        weight: SCORING_WEIGHTS.stability,
        percentile: 0
      },
      correlation: {
        value: 0,
        score: correlationScore,
        weight: SCORING_WEIGHTS.correlation,
        percentile: 0
      }
    };
  }

  /**
   * Score a metric based on thresholds (higher is better)
   */
  private scoreMetric(
    value: number,
    thresholds: { excellent: number; good: number; acceptable: number; poor: number }
  ): number {
    if (value >= thresholds.excellent) return 100;
    if (value >= thresholds.good) return 75;
    if (value >= thresholds.acceptable) return 50;
    if (value >= thresholds.poor) return 25;
    return 0;
  }

  /**
   * Score a metric inversely (lower is better)
   */
  private scoreMetricInverse(
    value: number,
    thresholds: { excellent: number; good: number; acceptable: number; poor: number }
  ): number {
    if (value <= thresholds.excellent) return 100;
    if (value <= thresholds.good) return 75;
    if (value <= thresholds.acceptable) return 50;
    if (value <= thresholds.poor) return 25;
    return 0;
  }

  /**
   * Calculate weighted overall score
   */
  private calculateOverallScore(componentScores: ComponentScores): number {
    const weightedSum =
      componentScores.sharpeRatio.score * componentScores.sharpeRatio.weight +
      componentScores.calmarRatio.score * componentScores.calmarRatio.weight +
      componentScores.winRate.score * componentScores.winRate.weight +
      componentScores.profitFactor.score * componentScores.profitFactor.weight +
      componentScores.wfaDegradation.score * componentScores.wfaDegradation.weight +
      componentScores.stability.score * componentScores.stability.weight +
      componentScores.correlation.score * componentScores.correlation.weight;

    return Math.round(weightedSum * 100) / 100; // Round to 2 decimals
  }

  /**
   * Calculate percentile rank among all strategies
   */
  private async calculatePercentile(strategyConfigId: string, overallScore: number): Promise<number> {
    // Get all strategy scores
    const allScores = await this.strategyScoreRepo
      .createQueryBuilder('score')
      .select('score.overallScore', 'overallScore')
      .where('score.strategyConfigId != :id', { id: strategyConfigId })
      .getRawMany();

    if (allScores.length === 0) return 100; // First strategy

    const scores = allScores.map((s) => parseFloat(s.overallScore));
    const lowerScores = scores.filter((s) => s < overallScore).length;

    return (lowerScores / scores.length) * 100;
  }

  /**
   * Determine letter grade based on score
   */
  private determineGrade(score: number): StrategyGrade {
    if (score >= GRADE_RANGES.A.min) return StrategyGrade.A;
    if (score >= GRADE_RANGES.B.min) return StrategyGrade.B;
    if (score >= GRADE_RANGES.C.min) return StrategyGrade.C;
    if (score >= GRADE_RANGES.D.min) return StrategyGrade.D;
    return StrategyGrade.F;
  }

  /**
   * Check if strategy is eligible for promotion
   */
  private checkPromotionEligibility(score: number, componentScores: ComponentScores, results: any): boolean {
    // Minimum score threshold (70)
    if (score < 70) return false;

    // Minimum trades (30)
    if (results.totalTrades < 30) return false;

    // Maximum drawdown (40%)
    if (Math.abs(results.maxDrawdown) > 40) return false;

    // WFA degradation (< 30%)
    if (componentScores.wfaDegradation.value > 30) return false;

    // Positive returns required
    if (results.totalReturn <= 0) return false;

    return true;
  }

  /**
   * Generate warnings for concerning metrics
   */
  private generateWarnings(componentScores: ComponentScores, results: any, wfaDegradation: number): string[] {
    const warnings: string[] = [];

    if (componentScores.sharpeRatio.value < 0.5) {
      warnings.push('Low Sharpe ratio indicates poor risk-adjusted returns');
    }

    if (results.totalTrades < 30) {
      warnings.push('Insufficient trade count for statistical significance');
    }

    if (Math.abs(results.maxDrawdown) > 40) {
      warnings.push('High maximum drawdown exceeds 40% threshold');
    }

    if (wfaDegradation > 30) {
      warnings.push('High walk-forward degradation suggests overfitting');
    }

    if (results.winRate < 0.45) {
      warnings.push('Low win rate below 45% threshold');
    }

    if (results.volatility > 1.5) {
      warnings.push('High volatility exceeds 150% annualized threshold');
    }

    return warnings;
  }

  /**
   * Get latest score for strategy
   */
  async getLatestScore(strategyConfigId: string): Promise<StrategyScore | null> {
    return this.strategyScoreRepo.findOne({
      where: { strategyConfigId },
      order: { calculatedAt: 'DESC' }
    });
  }

  /**
   * Get top strategies by score
   */
  async getTopStrategies(limit = 10): Promise<StrategyScore[]> {
    return this.strategyScoreRepo.find({
      order: { overallScore: 'DESC' },
      take: limit,
      relations: ['strategyConfig']
    });
  }
}
