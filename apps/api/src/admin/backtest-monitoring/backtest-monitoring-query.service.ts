import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { AverageMetricsDto, BacktestFiltersDto, RecentActivityDto, TopAlgorithmDto } from './dto/overview.dto';
import { applyBacktestFilters, countRecentActivity, DateRange } from './monitoring-shared.util';

import { Backtest, BacktestStatus, BacktestType } from '../../order/backtest/backtest.entity';

export interface AggregatedOverview {
  statusCounts: Record<BacktestStatus, number>;
  typeDistribution: Record<BacktestType, number>;
  averageMetrics: AverageMetricsDto;
  totalBacktests: number;
}

/**
 * Aggregation query helpers for the backtest overview dashboard.
 *
 * Each method runs a single GROUP BY / aggregate query against the `backtest`
 * table. Composed by `BacktestMonitoringAnalyticsService.getOverview()`.
 */
@Injectable()
export class BacktestMonitoringQueryService {
  constructor(@InjectRepository(Backtest) private readonly backtestRepo: Repository<Backtest>) {}

  /**
   * Fan-in of getStatusCounts + getTypeDistribution + getAverageMetrics + getTotalBacktests
   * into a single SQL round trip using conditional aggregates (FILTER clauses).
   * Reduces admin dashboard pool footprint from 4 connections → 1 on this path.
   */
  async getOverviewAggregated(filters: BacktestFiltersDto, dateRange: DateRange): Promise<AggregatedOverview> {
    const qb = this.backtestRepo.createQueryBuilder('b');

    const typeFilter = filters.type ? ' AND b.type = :typeFilter' : '';
    const statusFilter = filters.status ? ' AND b.status = :statusFilter' : '';
    const completedCondition = `b.status = :completedStatus${typeFilter}`;

    qb.setParameter('completedStatus', BacktestStatus.COMPLETED);
    if (filters.type) qb.setParameter('typeFilter', filters.type);
    if (filters.status) qb.setParameter('statusFilter', filters.status);

    const selects: Array<[string, string]> = [];

    // Status counts — applies dateRange + algorithmId + type (omits status)
    for (const status of Object.values(BacktestStatus)) {
      const paramKey = `statusVal_${status}`;
      qb.setParameter(paramKey, status);
      selects.push([`COUNT(*) FILTER (WHERE b.status = :${paramKey}${typeFilter})`, `status_${status}`]);
    }

    // Type distribution — applies dateRange + algorithmId + status (omits type)
    for (const type of Object.values(BacktestType)) {
      const paramKey = `typeVal_${type}`;
      qb.setParameter(paramKey, type);
      selects.push([`COUNT(*) FILTER (WHERE b.type = :${paramKey}${statusFilter})`, `type_${type}`]);
    }

    // Average metrics — forces status=COMPLETED + type filter
    selects.push([`AVG(b.sharpeRatio) FILTER (WHERE ${completedCondition})`, 'avg_sharpe']);
    selects.push([`AVG(b.totalReturn) FILTER (WHERE ${completedCondition})`, 'avg_return']);
    selects.push([`AVG(b.maxDrawdown) FILTER (WHERE ${completedCondition})`, 'avg_drawdown']);
    selects.push([`AVG(b.winRate) FILTER (WHERE ${completedCondition})`, 'avg_win_rate']);

    // Total — applies all filters including status + type
    const totalClauses = [statusFilter, typeFilter].filter(Boolean).join('').trim();
    const totalSelect = totalClauses ? `COUNT(*) FILTER (WHERE 1=1 ${totalClauses})` : 'COUNT(*)';
    selects.push([totalSelect, 'total_count']);

    qb.select(selects[0][0], selects[0][1]);
    for (let i = 1; i < selects.length; i++) {
      qb.addSelect(selects[i][0], selects[i][1]);
    }

    if (dateRange) {
      qb.andWhere('b.createdAt BETWEEN :start AND :end', dateRange);
    }
    if (filters.algorithmId) {
      qb.andWhere('b.algorithmId = :algorithmId', { algorithmId: filters.algorithmId });
    }

    const row = (await qb.getRawOne<Record<string, string | null>>()) ?? {};

    const statusCounts = Object.values(BacktestStatus).reduce(
      (acc, s) => {
        acc[s] = parseInt(row[`status_${s}`] ?? '0', 10) || 0;
        return acc;
      },
      {} as Record<BacktestStatus, number>
    );

    const typeDistribution = Object.values(BacktestType).reduce(
      (acc, t) => {
        acc[t] = parseInt(row[`type_${t}`] ?? '0', 10) || 0;
        return acc;
      },
      {} as Record<BacktestType, number>
    );

    return {
      statusCounts,
      typeDistribution,
      averageMetrics: {
        sharpeRatio: parseFloat(row.avg_sharpe ?? '0') || 0,
        totalReturn: parseFloat(row.avg_return ?? '0') || 0,
        maxDrawdown: parseFloat(row.avg_drawdown ?? '0') || 0,
        winRate: parseFloat(row.avg_win_rate ?? '0') || 0
      },
      totalBacktests: parseInt(row.total_count ?? '0', 10) || 0
    };
  }

  async getStatusCounts(filters: BacktestFiltersDto, dateRange: DateRange): Promise<Record<BacktestStatus, number>> {
    const qb = this.backtestRepo
      .createQueryBuilder('b')
      .select('b.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('b.status');

    if (dateRange) {
      qb.where('b.createdAt BETWEEN :start AND :end', dateRange);
    }

    if (filters.algorithmId) {
      qb.andWhere('b.algorithmId = :algorithmId', { algorithmId: filters.algorithmId });
    }

    if (filters.type) {
      qb.andWhere('b.type = :type', { type: filters.type });
    }

    const results = await qb.getRawMany();

    const counts = Object.values(BacktestStatus).reduce(
      (acc, status) => {
        acc[status] = 0;
        return acc;
      },
      {} as Record<BacktestStatus, number>
    );

    for (const row of results) {
      counts[row.status as BacktestStatus] = parseInt(row.count, 10);
    }

    return counts;
  }

  async getTypeDistribution(filters: BacktestFiltersDto, dateRange: DateRange): Promise<Record<BacktestType, number>> {
    const qb = this.backtestRepo
      .createQueryBuilder('b')
      .select('b.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .groupBy('b.type');

    if (dateRange) {
      qb.where('b.createdAt BETWEEN :start AND :end', dateRange);
    }

    if (filters.algorithmId) {
      qb.andWhere('b.algorithmId = :algorithmId', { algorithmId: filters.algorithmId });
    }

    if (filters.status) {
      qb.andWhere('b.status = :status', { status: filters.status });
    }

    const results = await qb.getRawMany();

    const distribution = Object.values(BacktestType).reduce(
      (acc, type) => {
        acc[type] = 0;
        return acc;
      },
      {} as Record<BacktestType, number>
    );

    for (const row of results) {
      distribution[row.type as BacktestType] = parseInt(row.count, 10);
    }

    return distribution;
  }

  async getAverageMetrics(filters: BacktestFiltersDto, dateRange: DateRange): Promise<AverageMetricsDto> {
    const qb = this.backtestRepo
      .createQueryBuilder('b')
      .select('AVG(b.sharpeRatio)', 'avgSharpe')
      .addSelect('AVG(b.totalReturn)', 'avgReturn')
      .addSelect('AVG(b.maxDrawdown)', 'avgDrawdown')
      .addSelect('AVG(b.winRate)', 'avgWinRate')
      .where('b.status = :completed', { completed: BacktestStatus.COMPLETED });

    if (dateRange) {
      qb.andWhere('b.createdAt BETWEEN :start AND :end', dateRange);
    }

    if (filters.algorithmId) {
      qb.andWhere('b.algorithmId = :algorithmId', { algorithmId: filters.algorithmId });
    }

    if (filters.type) {
      qb.andWhere('b.type = :type', { type: filters.type });
    }

    const result = await qb.getRawOne();

    return {
      sharpeRatio: parseFloat(result?.avgSharpe) || 0,
      totalReturn: parseFloat(result?.avgReturn) || 0,
      maxDrawdown: parseFloat(result?.avgDrawdown) || 0,
      winRate: parseFloat(result?.avgWinRate) || 0
    };
  }

  async getTopAlgorithms(filters: BacktestFiltersDto, dateRange: DateRange): Promise<TopAlgorithmDto[]> {
    const qb = this.backtestRepo
      .createQueryBuilder('b')
      .innerJoin('b.algorithm', 'a')
      .select('a.id', 'id')
      .addSelect('a.name', 'name')
      .addSelect('AVG(b.sharpeRatio)', 'avgSharpe')
      .addSelect('AVG(b.totalReturn)', 'avgReturn')
      .addSelect('COUNT(*)', 'backtestCount')
      .where('b.status = :completed', { completed: BacktestStatus.COMPLETED })
      .andWhere('b.sharpeRatio IS NOT NULL')
      .groupBy('a.id')
      .addGroupBy('a.name')
      .having('COUNT(*) >= 3')
      .orderBy('AVG(b.sharpeRatio)', 'DESC')
      .limit(10);

    if (dateRange) {
      qb.andWhere('b.createdAt BETWEEN :start AND :end', dateRange);
    }

    if (filters.type) {
      qb.andWhere('b.type = :type', { type: filters.type });
    }

    const results = await qb.getRawMany();

    return results.map((r) => ({
      id: r.id,
      name: r.name,
      avgSharpe: parseFloat(r.avgSharpe) || 0,
      backtestCount: parseInt(r.backtestCount, 10),
      avgReturn: parseFloat(r.avgReturn) || 0
    }));
  }

  async getTotalBacktests(filters: BacktestFiltersDto, dateRange: DateRange): Promise<number> {
    const qb = this.backtestRepo.createQueryBuilder('b');
    applyBacktestFilters(qb, filters, dateRange);
    return qb.getCount();
  }

  getRecentActivity(): Promise<RecentActivityDto> {
    return countRecentActivity(this.backtestRepo);
  }
}
