import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { Backtest, BacktestStatus } from '../../order/backtest/backtest.entity';
import { AlgorithmPerformance } from '../algorithm-performance.entity';
import { Algorithm } from '../algorithm.entity';

/**
 * AlgorithmScoreService
 *
 * Calculates an auto-computed performance score (1-10) for each algorithm
 * by aggregating live performance and backtest data across all users.
 */
@Injectable()
export class AlgorithmScoreService {
  private readonly logger = new Logger(AlgorithmScoreService.name);

  constructor(
    @InjectRepository(Algorithm) private readonly algorithmRepo: Repository<Algorithm>,
    @InjectRepository(AlgorithmPerformance) private readonly performanceRepo: Repository<AlgorithmPerformance>,
    @InjectRepository(Backtest) private readonly backtestRepo: Repository<Backtest>
  ) {}

  /**
   * Recalculate scores for all algorithms and persist to the weight column.
   */
  async recalculateAllScores(): Promise<void> {
    const [algorithms, allLiveGrouped, allBacktestGrouped] = await Promise.all([
      this.algorithmRepo.find(),
      this.getAllLiveScoresGrouped(),
      this.getAllBacktestScoresGrouped()
    ]);

    let updated = 0;

    const updates = algorithms.map((algorithm) => {
      const liveScores = allLiveGrouped.get(algorithm.id) ?? [];
      const backtestScores = allBacktestGrouped.get(algorithm.id) ?? [];
      const score = this.calculateScoreFromData(liveScores, backtestScores);

      if (score !== algorithm.weight) {
        updated++;
        return this.algorithmRepo.update(algorithm.id, { weight: score });
      }
      return Promise.resolve();
    });

    await Promise.all(updates);

    this.logger.log(`Recalculated scores for ${algorithms.length} algorithms (${updated} updated)`);
  }

  /**
   * Calculate a 1-10 performance score for a single algorithm.
   *
   * Combines live performance data (via AlgorithmPerformance) and
   * completed backtest results, then maps the raw 0-1 score to 1-10.
   */
  async calculateScore(algorithmId: string): Promise<number> {
    const liveScores = await this.getLiveScores(algorithmId);
    const backtestScores = await this.getBacktestScores(algorithmId);

    return this.calculateScoreFromData(liveScores, backtestScores);
  }

  /**
   * Pure function: compute a 1-10 score from pre-fetched live and backtest scores.
   */
  private calculateScoreFromData(liveScores: number[], backtestScores: number[]): number {
    const totalDataPoints = liveScores.length + backtestScores.length;

    // Confidence threshold: need at least 2 data points
    if (totalDataPoints < 2) {
      return 5;
    }

    const liveMedian = liveScores.length > 0 ? this.median(liveScores) : null;
    const backtestMedian = backtestScores.length > 0 ? this.median(backtestScores) : null;

    let rawScore: number;
    if (liveMedian !== null && backtestMedian !== null) {
      rawScore = 0.6 * liveMedian + 0.4 * backtestMedian;
    } else if (liveMedian !== null) {
      rawScore = liveMedian;
    } else {
      rawScore = backtestMedian ?? 0;
    }

    return Math.max(1, Math.min(10, Math.round(rawScore * 10)));
  }

  /**
   * Get all live risk-adjusted scores grouped by algorithm ID.
   * Single query fetching all active activation performance records.
   */
  private async getAllLiveScoresGrouped(): Promise<Map<string, number[]>> {
    const records = await this.performanceRepo
      .createQueryBuilder('perf')
      .innerJoinAndSelect('perf.algorithmActivation', 'activation')
      .where('activation.isActive = true')
      .orderBy('perf.calculatedAt', 'DESC')
      .getMany();

    const latestPerActivation = this.getLatestPerActivation(records);

    const grouped = new Map<string, number[]>();
    for (const record of latestPerActivation) {
      const algorithmId = record.algorithmActivation.algorithmId;
      const scores = grouped.get(algorithmId) ?? [];
      scores.push(record.getRiskAdjustedScore());
      grouped.set(algorithmId, scores);
    }

    return grouped;
  }

  /**
   * Get all backtest risk-adjusted scores grouped by algorithm ID.
   * Single query fetching all completed backtests.
   */
  private async getAllBacktestScoresGrouped(): Promise<Map<string, number[]>> {
    const backtests = await this.backtestRepo.find({
      where: { status: BacktestStatus.COMPLETED },
      relations: ['algorithm']
    });

    const grouped = new Map<string, number[]>();
    for (const bt of backtests) {
      const algorithmId = bt.algorithm.id;
      const scores = grouped.get(algorithmId) ?? [];
      scores.push(this.calculateBacktestRiskAdjustedScore(bt));
      grouped.set(algorithmId, scores);
    }

    return grouped;
  }

  /**
   * Get risk-adjusted scores from live AlgorithmPerformance records.
   * Takes the latest record per active activation.
   */
  private async getLiveScores(algorithmId: string): Promise<number[]> {
    // Get the latest performance record per active activation for this algorithm
    const records = await this.performanceRepo
      .createQueryBuilder('perf')
      .innerJoin('perf.algorithmActivation', 'activation')
      .where('activation.algorithmId = :algorithmId', { algorithmId })
      .andWhere('activation.isActive = true')
      .orderBy('perf.calculatedAt', 'DESC')
      .getMany();

    const latestPerActivation = this.getLatestPerActivation(records);

    return latestPerActivation.map((r) => r.getRiskAdjustedScore());
  }

  /**
   * Get risk-adjusted scores from completed backtests.
   */
  private async getBacktestScores(algorithmId: string): Promise<number[]> {
    const backtests = await this.backtestRepo.find({
      where: {
        algorithm: { id: algorithmId },
        status: BacktestStatus.COMPLETED
      }
    });

    return backtests.map((bt) => this.calculateBacktestRiskAdjustedScore(bt));
  }

  /**
   * Calculate a risk-adjusted score for a backtest using the same formula
   * as AlgorithmPerformance.getRiskAdjustedScore():
   *   40% ROI + 30% Sharpe + 30% WinRate, each normalized to 0-1.
   */
  private calculateBacktestRiskAdjustedScore(backtest: Backtest): number {
    const normalizedRoi = Math.max(0, Math.min(((backtest.totalReturn ?? 0) + 100) / 200, 1));
    const normalizedSharpe = Math.max(0, Math.min(((backtest.sharpeRatio ?? 0) + 3) / 6, 1));
    const normalizedWinRate = Math.max(0, Math.min(backtest.winRate ?? 0, 1));

    return normalizedRoi * 0.4 + normalizedSharpe * 0.3 + normalizedWinRate * 0.3;
  }

  /**
   * Deduplicate performance records to keep only the latest per activation.
   */
  private getLatestPerActivation(records: AlgorithmPerformance[]): AlgorithmPerformance[] {
    const map = new Map<string, AlgorithmPerformance>();
    for (const record of records) {
      if (!map.has(record.algorithmActivationId)) {
        map.set(record.algorithmActivationId, record);
      }
      // Records are already ordered DESC by calculatedAt, so first seen is latest
    }
    return Array.from(map.values());
  }

  /**
   * Calculate the median of an array of numbers.
   */
  private median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
}
