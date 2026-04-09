import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository, SelectQueryBuilder } from 'typeorm';

import {
  OptimizationAnalyticsDto,
  OptimizationFiltersDto,
  OptimizationRunListItemDto,
  PaginatedOptimizationRunsDto
} from './dto/optimization-analytics.dto';
import { RecentActivityDto } from './dto/overview.dto';
import { countRecentActivity } from './monitoring-shared.util';

import { OptimizationResult } from '../../optimization/entities/optimization-result.entity';
import { OptimizationRun, OptimizationStatus } from '../../optimization/entities/optimization-run.entity';

type DateRange = { start: Date; end: Date } | null;

@Injectable()
export class OptimizationAnalyticsService {
  constructor(
    @InjectRepository(OptimizationRun) private readonly optimizationRunRepo: Repository<OptimizationRun>,
    @InjectRepository(OptimizationResult) private readonly optimizationResultRepo: Repository<OptimizationResult>
  ) {}

  /**
   * Get optimization analytics for the admin dashboard
   */
  async getOptimizationAnalytics(filters: OptimizationFiltersDto): Promise<OptimizationAnalyticsDto> {
    const dateRange = this.getOptDateRange(filters);

    const [statusCounts, totalRuns, recentActivity, avgMetrics, topStrategies, resultSummary] = await Promise.all([
      this.getOptStatusCounts(filters, dateRange),
      this.getOptTotalRuns(filters, dateRange),
      this.getOptRecentActivity(),
      this.getOptAvgMetrics(filters, dateRange),
      this.getOptTopStrategies(filters, dateRange),
      this.getOptResultSummary(filters, dateRange)
    ]);

    return {
      statusCounts,
      totalRuns,
      recentActivity,
      avgImprovement: avgMetrics.avgImprovement,
      avgBestScore: avgMetrics.avgBestScore,
      avgCombinationsTested: avgMetrics.avgCombinationsTested,
      topStrategies,
      resultSummary
    };
  }

  /**
   * Get paginated list of optimization runs with progress information
   */
  async listOptimizationRuns(
    filters: OptimizationFiltersDto,
    page = 1,
    limit = 10
  ): Promise<PaginatedOptimizationRunsDto> {
    const dateRange = this.getOptDateRange(filters);
    const skip = (page - 1) * limit;

    const qb = this.optimizationRunRepo
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.strategyConfig', 'sc')
      .innerJoinAndSelect('sc.algorithm', 'a');

    this.applyOptFilters(qb, filters, dateRange);

    qb.orderBy('r.createdAt', 'DESC').skip(skip).take(limit);

    const [runs, total] = await qb.getManyAndCount();

    const data: OptimizationRunListItemDto[] = runs.map((r) => {
      let progressPercent = 0;
      if (r.status === OptimizationStatus.COMPLETED) {
        progressPercent = 100;
      } else if (r.status === OptimizationStatus.RUNNING && r.totalCombinations > 0) {
        progressPercent = Math.round((r.combinationsTested / r.totalCombinations) * 100);
      }

      return {
        id: r.id,
        strategyName: r.strategyConfig?.name || 'Unknown',
        algorithmName: r.strategyConfig?.algorithm?.name || 'Unknown',
        status: r.status,
        combinationsTested: r.combinationsTested,
        totalCombinations: r.totalCombinations,
        progressPercent,
        improvement: r.improvement ?? null,
        bestScore: r.bestScore ?? null,
        createdAt: r.createdAt.toISOString()
      };
    });

    const totalPages = Math.ceil(total / limit);
    return { data, total, page, limit, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private getOptDateRange(filters: OptimizationFiltersDto): DateRange {
    if (!filters.startDate && !filters.endDate) return null;
    return {
      start: filters.startDate ? new Date(filters.startDate) : new Date(0),
      end: filters.endDate ? new Date(filters.endDate) : new Date()
    };
  }

  private applyOptFilters(
    qb: SelectQueryBuilder<OptimizationRun>,
    filters: OptimizationFiltersDto,
    dateRange: DateRange
  ): void {
    if (dateRange) {
      qb.andWhere('r.createdAt BETWEEN :start AND :end', dateRange);
    }
    if (filters.status) {
      qb.andWhere('r.status = :status', { status: filters.status });
    }
  }

  /** Status filter intentionally omitted — returns full status breakdown */
  private async getOptStatusCounts(
    filters: OptimizationFiltersDto,
    dateRange: DateRange
  ): Promise<Record<OptimizationStatus, number>> {
    const qb = this.optimizationRunRepo
      .createQueryBuilder('r')
      .select('r.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('r.status');

    if (dateRange) {
      qb.where('r.createdAt BETWEEN :start AND :end', dateRange);
    }

    const results = await qb.getRawMany();
    const counts = Object.values(OptimizationStatus).reduce(
      (acc, s) => {
        acc[s] = 0;
        return acc;
      },
      {} as Record<OptimizationStatus, number>
    );

    for (const row of results) {
      counts[row.status as OptimizationStatus] = parseInt(row.count, 10);
    }

    return counts;
  }

  private async getOptTotalRuns(filters: OptimizationFiltersDto, dateRange: DateRange): Promise<number> {
    const qb = this.optimizationRunRepo.createQueryBuilder('r');
    this.applyOptFilters(qb, filters, dateRange);
    return qb.getCount();
  }

  private async getOptRecentActivity(): Promise<RecentActivityDto> {
    return countRecentActivity(this.optimizationRunRepo);
  }

  private async getOptAvgMetrics(
    filters: OptimizationFiltersDto,
    dateRange: DateRange
  ): Promise<{ avgImprovement: number; avgBestScore: number; avgCombinationsTested: number }> {
    const qb = this.optimizationRunRepo
      .createQueryBuilder('r')
      .select('AVG(r.improvement)', 'avgImprovement')
      .addSelect('AVG(r.bestScore)', 'avgBestScore')
      .addSelect('AVG(r.combinationsTested)', 'avgCombinationsTested')
      .where('r.status = :completed', { completed: OptimizationStatus.COMPLETED });

    if (dateRange) {
      qb.andWhere('r.createdAt BETWEEN :start AND :end', dateRange);
    }

    const result = await qb.getRawOne();
    return {
      avgImprovement: parseFloat(result?.avgImprovement) || 0,
      avgBestScore: parseFloat(result?.avgBestScore) || 0,
      avgCombinationsTested: parseFloat(result?.avgCombinationsTested) || 0
    };
  }

  private async getOptTopStrategies(
    filters: OptimizationFiltersDto,
    dateRange: DateRange
  ): Promise<OptimizationAnalyticsDto['topStrategies']> {
    const qb = this.optimizationRunRepo
      .createQueryBuilder('r')
      .innerJoin('r.strategyConfig', 'sc')
      .innerJoin('sc.algorithm', 'a')
      .select('a.id', 'algorithmId')
      .addSelect('a.name', 'algorithmName')
      .addSelect('COUNT(*)', 'runCount')
      .addSelect('AVG(r.improvement)', 'avgImprovement')
      .addSelect('AVG(r.bestScore)', 'avgBestScore')
      .where('r.status = :completed', { completed: OptimizationStatus.COMPLETED })
      .groupBy('a.id')
      .addGroupBy('a.name')
      .having('COUNT(*) >= 1')
      .orderBy('AVG(r.bestScore)', 'DESC')
      .limit(10);

    if (dateRange) {
      qb.andWhere('r.createdAt BETWEEN :start AND :end', dateRange);
    }

    const results = await qb.getRawMany();
    return results.map((r) => ({
      algorithmId: r.algorithmId,
      algorithmName: r.algorithmName,
      runCount: parseInt(r.runCount, 10),
      avgImprovement: parseFloat(r.avgImprovement) || 0,
      avgBestScore: parseFloat(r.avgBestScore) || 0
    }));
  }

  private async getOptResultSummary(
    filters: OptimizationFiltersDto,
    dateRange: DateRange
  ): Promise<OptimizationAnalyticsDto['resultSummary']> {
    const runSubQuery = this.optimizationRunRepo
      .createQueryBuilder('r')
      .select('r.id')
      .where('r.status = :completed', { completed: OptimizationStatus.COMPLETED });

    if (dateRange) {
      runSubQuery.andWhere('r.createdAt BETWEEN :start AND :end', dateRange);
    }

    const qb = this.optimizationResultRepo
      .createQueryBuilder('res')
      .select('AVG(res.avgTrainScore)', 'avgTrainScore')
      .addSelect('AVG(res.avgTestScore)', 'avgTestScore')
      .addSelect('AVG(res.avgDegradation)', 'avgDegradation')
      .addSelect('AVG(res.consistencyScore)', 'avgConsistency')
      .addSelect('AVG(CASE WHEN res.overfittingWindows > 0 THEN 1.0 ELSE 0.0 END)', 'overfittingRate')
      .where(`res.optimizationRunId IN (${runSubQuery.getQuery()})`)
      .setParameters(runSubQuery.getParameters());

    const result = await qb.getRawOne();
    return {
      avgTrainScore: parseFloat(result?.avgTrainScore) || 0,
      avgTestScore: parseFloat(result?.avgTestScore) || 0,
      avgDegradation: parseFloat(result?.avgDegradation) || 0,
      avgConsistency: parseFloat(result?.avgConsistency) || 0,
      overfittingRate: parseFloat(result?.overfittingRate) || 0
    };
  }
}
