import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { BacktestMonitoringQueryService } from './backtest-monitoring-query.service';
import {
  BacktestListItemDto,
  BacktestListQueryDto,
  BacktestSortField,
  PaginatedBacktestListDto,
  SortOrder
} from './dto/backtest-listing.dto';
import { BacktestFiltersDto, BacktestOverviewDto } from './dto/overview.dto';
import { applyBacktestFilters, calculateProgress, getDateRange } from './monitoring-shared.util';

import { Backtest } from '../../order/backtest/backtest.entity';

/** Whitelist mapping for safe sort column access (prevents SQL injection) */
const SORT_COLUMN_MAP: Record<BacktestSortField, string> = {
  [BacktestSortField.CREATED_AT]: 'b.createdAt',
  [BacktestSortField.UPDATED_AT]: 'b.updatedAt',
  [BacktestSortField.SHARPE_RATIO]: 'b.sharpeRatio',
  [BacktestSortField.TOTAL_RETURN]: 'b.totalReturn',
  [BacktestSortField.MAX_DRAWDOWN]: 'b.maxDrawdown',
  [BacktestSortField.WIN_RATE]: 'b.winRate',
  [BacktestSortField.TOTAL_TRADES]: 'b.totalTrades',
  [BacktestSortField.NAME]: 'b.name',
  [BacktestSortField.STATUS]: 'b.status'
};

@Injectable()
export class BacktestMonitoringAnalyticsService {
  constructor(
    @InjectRepository(Backtest) private readonly backtestRepo: Repository<Backtest>,
    private readonly queryService: BacktestMonitoringQueryService
  ) {}

  /**
   * Get overview metrics for the backtest monitoring dashboard
   */
  async getOverview(filters: BacktestFiltersDto): Promise<BacktestOverviewDto> {
    const dateRange = getDateRange(filters);

    const [statusCounts, typeDistribution, averageMetrics, recentActivity, topAlgorithms, totalBacktests] =
      await Promise.all([
        this.queryService.getStatusCounts(filters, dateRange),
        this.queryService.getTypeDistribution(filters, dateRange),
        this.queryService.getAverageMetrics(filters, dateRange),
        this.queryService.getRecentActivity(),
        this.queryService.getTopAlgorithms(filters, dateRange),
        this.queryService.getTotalBacktests(filters, dateRange)
      ]);

    return {
      statusCounts,
      typeDistribution,
      averageMetrics,
      recentActivity,
      topAlgorithms,
      totalBacktests
    };
  }

  /**
   * Get paginated list of backtests
   */
  async getBacktests(query: BacktestListQueryDto): Promise<PaginatedBacktestListDto> {
    const { page = 1, limit = 20, sortBy = BacktestSortField.CREATED_AT, sortOrder = SortOrder.DESC, search } = query;

    const dateRange = getDateRange(query);
    const skip = (page - 1) * limit;

    const qb = this.backtestRepo
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.algorithm', 'a')
      .leftJoinAndSelect('b.user', 'u');

    applyBacktestFilters(qb, query, dateRange);

    if (search) {
      qb.andWhere('b.name ILIKE :search', { search: `%${search}%` });
    }

    const total = await qb.getCount();

    // Apply sorting and pagination (using whitelist to prevent SQL injection)
    const sortColumn = SORT_COLUMN_MAP[sortBy] || SORT_COLUMN_MAP[BacktestSortField.CREATED_AT];
    qb.orderBy(sortColumn, sortOrder).skip(skip).take(limit);

    const backtests = await qb.getMany();

    const data: BacktestListItemDto[] = backtests.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      status: b.status,
      type: b.type,
      algorithmId: b.algorithm?.id || '',
      algorithmName: b.algorithm?.name || 'Unknown',
      userId: b.user?.id || '',
      userEmail: b.user?.email,
      initialCapital: b.initialCapital,
      finalValue: b.finalValue,
      totalReturn: b.totalReturn,
      sharpeRatio: b.sharpeRatio,
      maxDrawdown: b.maxDrawdown,
      totalTrades: b.totalTrades,
      winRate: b.winRate,
      startDate: b.startDate.toISOString(),
      endDate: b.endDate.toISOString(),
      createdAt: b.createdAt.toISOString(),
      completedAt: b.completedAt?.toISOString(),
      errorMessage: b.errorMessage,
      progressPercent: calculateProgress(b)
    }));

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1
    };
  }
}
