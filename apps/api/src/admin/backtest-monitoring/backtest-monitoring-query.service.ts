import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { AverageMetricsDto, BacktestFiltersDto, RecentActivityDto, TopAlgorithmDto } from './dto/overview.dto';
import { applyBacktestFilters, countRecentActivity, DateRange } from './monitoring-shared.util';

import { Backtest, BacktestStatus, BacktestType } from '../../order/backtest/backtest.entity';

/**
 * Aggregation query helpers for the backtest overview dashboard.
 *
 * Each method runs a single GROUP BY / aggregate query against the `backtest`
 * table. Composed by `BacktestMonitoringAnalyticsService.getOverview()`.
 */
@Injectable()
export class BacktestMonitoringQueryService {
  constructor(@InjectRepository(Backtest) private readonly backtestRepo: Repository<Backtest>) {}

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
