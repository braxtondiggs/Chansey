import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository, SelectQueryBuilder } from 'typeorm';

import {
  OptimizationAnalyticsDto,
  OptimizationFiltersDto,
  OptimizationRunListItemDto,
  PaginatedOptimizationRunsDto
} from './dto/optimization-analytics.dto';
import { countRecentActivity } from './monitoring-shared.util';

import { OptimizationRunSummary } from '../../optimization/entities/optimization-run-summary.entity';
import { OptimizationRun, OptimizationStatus } from '../../optimization/entities/optimization-run.entity';

type DateRange = { start: Date; end: Date } | null;

@Injectable()
export class OptimizationAnalyticsService {
  constructor(@InjectRepository(OptimizationRun) private readonly optimizationRunRepo: Repository<OptimizationRun>) {}

  /**
   * Get optimization analytics for the admin dashboard
   */
  async getOptimizationAnalytics(filters: OptimizationFiltersDto): Promise<OptimizationAnalyticsDto> {
    const dateRange = this.getOptDateRange(filters);

    const [aggregate, topStrategies, recentActivity] = await Promise.all([
      this.getOptAggregate(filters, dateRange),
      this.getOptTopStrategies(filters, dateRange),
      countRecentActivity(this.optimizationRunRepo)
    ]);

    return {
      statusCounts: aggregate.statusCounts,
      totalRuns: aggregate.totalRuns,
      recentActivity,
      avgImprovement: aggregate.avgImprovement,
      avgBestScore: aggregate.avgBestScore,
      avgCombinationsTested: aggregate.avgCombinationsTested,
      topStrategies,
      resultSummary: aggregate.resultSummary
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

  /**
   * Fan-in statusCounts + totalRuns + avgMetrics + resultSummary by joining the
   * optimization_run_summaries table. Per-COMBO aggregates are pre-rolled per-run
   * and then cross-run averaged here, weighted by resultCount so that short runs
   * don't skew the dashboard toward their mean.
   */
  private async getOptAggregate(
    filters: OptimizationFiltersDto,
    dateRange: DateRange
  ): Promise<{
    statusCounts: Record<OptimizationStatus, number>;
    totalRuns: number;
    avgImprovement: number;
    avgBestScore: number;
    avgCombinationsTested: number;
    resultSummary: OptimizationAnalyticsDto['resultSummary'];
  }> {
    const qb = this.optimizationRunRepo
      .createQueryBuilder('r')
      .leftJoin(OptimizationRunSummary, 'rs', 'rs."optimizationRunId" = r.id');

    qb.setParameter('completedStatus', OptimizationStatus.COMPLETED);

    const statusFilter = filters.status ? ' AND r.status = :totalStatusFilter' : '';
    if (filters.status) qb.setParameter('totalStatusFilter', filters.status);

    const selects: Array<[string, string]> = [];
    for (const status of Object.values(OptimizationStatus)) {
      const paramKey = `optStatusVal_${status}`;
      qb.setParameter(paramKey, status);
      selects.push([`COUNT(*) FILTER (WHERE r.status = :${paramKey})`, `status_${status}`]);
    }
    selects.push([statusFilter ? `COUNT(*) FILTER (WHERE 1=1 ${statusFilter})` : 'COUNT(*)', 'total_runs']);
    selects.push([`AVG(r.improvement) FILTER (WHERE r.status = :completedStatus)`, 'avg_improvement']);
    selects.push([`AVG(r."bestScore") FILTER (WHERE r.status = :completedStatus)`, 'avg_best_score']);
    selects.push([`AVG(r."combinationsTested") FILTER (WHERE r.status = :completedStatus)`, 'avg_combinations_tested']);

    // Weighted averages across completed runs using per-run resultCount. Falls back
    // to unweighted AVG of summary.avg* when resultCount is 0 (shouldn't happen,
    // but keep the numerator safe).
    const weightedCompleted = `(rs.id IS NOT NULL AND r.status = :completedStatus)`;
    selects.push([
      `SUM(CASE WHEN ${weightedCompleted} THEN rs."avgTrainScore" * rs."resultCount" ELSE 0 END) / NULLIF(SUM(CASE WHEN ${weightedCompleted} THEN rs."resultCount" ELSE 0 END), 0)`,
      'avg_train_score'
    ]);
    selects.push([
      `SUM(CASE WHEN ${weightedCompleted} THEN rs."avgTestScore" * rs."resultCount" ELSE 0 END) / NULLIF(SUM(CASE WHEN ${weightedCompleted} THEN rs."resultCount" ELSE 0 END), 0)`,
      'avg_test_score'
    ]);
    selects.push([
      `SUM(CASE WHEN ${weightedCompleted} THEN rs."avgDegradation" * rs."resultCount" ELSE 0 END) / NULLIF(SUM(CASE WHEN ${weightedCompleted} THEN rs."resultCount" ELSE 0 END), 0)`,
      'avg_degradation'
    ]);
    selects.push([
      `SUM(CASE WHEN ${weightedCompleted} THEN rs."avgConsistency" * rs."resultCount" ELSE 0 END) / NULLIF(SUM(CASE WHEN ${weightedCompleted} THEN rs."resultCount" ELSE 0 END), 0)`,
      'avg_consistency'
    ]);
    selects.push([
      `SUM(CASE WHEN ${weightedCompleted} THEN rs."overfittingCount" ELSE 0 END)::decimal / NULLIF(SUM(CASE WHEN ${weightedCompleted} THEN rs."resultCount" ELSE 0 END), 0)`,
      'overfitting_rate'
    ]);

    qb.select(selects[0][0], selects[0][1]);
    for (let i = 1; i < selects.length; i++) {
      qb.addSelect(selects[i][0], selects[i][1]);
    }

    if (dateRange) {
      qb.andWhere('r.createdAt BETWEEN :start AND :end', dateRange);
    }

    const row = (await qb.getRawOne<Record<string, string | null>>()) ?? {};

    const statusCounts = Object.values(OptimizationStatus).reduce(
      (acc, s) => {
        acc[s] = parseInt(row[`status_${s}`] ?? '0', 10) || 0;
        return acc;
      },
      {} as Record<OptimizationStatus, number>
    );

    return {
      statusCounts,
      totalRuns: parseInt(row.total_runs ?? '0', 10) || 0,
      avgImprovement: parseFloat(row.avg_improvement ?? '0') || 0,
      avgBestScore: parseFloat(row.avg_best_score ?? '0') || 0,
      avgCombinationsTested: parseFloat(row.avg_combinations_tested ?? '0') || 0,
      resultSummary: {
        avgTrainScore: parseFloat(row.avg_train_score ?? '0') || 0,
        avgTestScore: parseFloat(row.avg_test_score ?? '0') || 0,
        avgDegradation: parseFloat(row.avg_degradation ?? '0') || 0,
        avgConsistency: parseFloat(row.avg_consistency ?? '0') || 0,
        overfittingRate: parseFloat(row.overfitting_rate ?? '0') || 0
      }
    };
  }

  private async getOptTopStrategies(
    _filters: OptimizationFiltersDto,
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
}
