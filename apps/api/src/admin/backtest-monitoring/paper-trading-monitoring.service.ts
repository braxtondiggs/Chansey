import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository, SelectQueryBuilder } from 'typeorm';

import { RecentActivityDto } from './dto/overview.dto';
import {
  PaginatedPaperTradingSessionsDto,
  PaperTradingFiltersDto,
  PaperTradingMonitoringDto,
  PaperTradingSessionListItemDto
} from './dto/paper-trading-analytics.dto';
import { calculatePaperTradingProgress, countRecentActivity } from './monitoring-shared.util';

import {
  PaperTradingOrder,
  PaperTradingOrderSide
} from '../../order/paper-trading/entities/paper-trading-order.entity';
import {
  PaperTradingSession,
  PaperTradingStatus
} from '../../order/paper-trading/entities/paper-trading-session.entity';
import {
  PaperTradingSignal,
  PaperTradingSignalDirection,
  PaperTradingSignalType
} from '../../order/paper-trading/entities/paper-trading-signal.entity';

type DateRange = { start: Date; end: Date } | null;

@Injectable()
export class PaperTradingMonitoringService {
  constructor(
    @InjectRepository(PaperTradingSession) private readonly paperSessionRepo: Repository<PaperTradingSession>,
    @InjectRepository(PaperTradingOrder) private readonly paperOrderRepo: Repository<PaperTradingOrder>,
    @InjectRepository(PaperTradingSignal) private readonly paperSignalRepo: Repository<PaperTradingSignal>
  ) {}

  /**
   * Get paper trading monitoring analytics for the admin dashboard
   */
  async getPaperTradingMonitoring(filters: PaperTradingFiltersDto): Promise<PaperTradingMonitoringDto> {
    const dateRange = this.getPtDateRange(filters);

    const [statusCounts, totalSessions, recentActivity, avgMetrics, topAlgorithms, orderAnalytics, signalAnalytics] =
      await Promise.all([
        this.getPtStatusCounts(filters, dateRange),
        this.getPtTotalSessions(filters, dateRange),
        this.getPtRecentActivity(),
        this.getPtAvgMetrics(filters, dateRange),
        this.getPtTopAlgorithms(filters, dateRange),
        this.getPtOrderAnalytics(filters, dateRange),
        this.getPtSignalAnalytics(filters, dateRange)
      ]);

    return {
      statusCounts,
      totalSessions,
      recentActivity,
      avgMetrics,
      topAlgorithms,
      orderAnalytics,
      signalAnalytics
    };
  }

  /**
   * Get paginated list of paper trading sessions with progress information
   */
  async listPaperTradingSessions(
    filters: PaperTradingFiltersDto,
    page = 1,
    limit = 10
  ): Promise<PaginatedPaperTradingSessionsDto> {
    const dateRange = this.getPtDateRange(filters);
    const skip = (page - 1) * limit;

    const qb = this.paperSessionRepo.createQueryBuilder('s').innerJoinAndSelect('s.algorithm', 'a');

    this.applyPtFilters(qb, filters, dateRange);

    qb.orderBy('s.createdAt', 'DESC').skip(skip).take(limit);

    const [sessions, total] = await qb.getManyAndCount();

    const data: PaperTradingSessionListItemDto[] = sessions.map((s) => ({
      id: s.id,
      name: s.name,
      algorithmName: s.algorithm?.name || 'Unknown',
      status: s.status,
      progressPercent: calculatePaperTradingProgress(s),
      totalReturn: s.totalReturn ?? null,
      sharpeRatio: s.sharpeRatio ?? null,
      duration: s.duration || 'N/A',
      startedAt: s.startedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString()
    }));

    const totalPages = Math.ceil(total / limit);
    return { data, total, page, limit, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private getPtDateRange(filters: PaperTradingFiltersDto): DateRange {
    if (!filters.startDate && !filters.endDate) return null;
    return {
      start: filters.startDate ? new Date(filters.startDate) : new Date(0),
      end: filters.endDate ? new Date(filters.endDate) : new Date()
    };
  }

  private applyPtFilters(
    qb: SelectQueryBuilder<PaperTradingSession>,
    filters: PaperTradingFiltersDto,
    dateRange: DateRange
  ): void {
    if (dateRange) {
      qb.andWhere('s.createdAt BETWEEN :start AND :end', dateRange);
    }
    if (filters.algorithmId) {
      qb.andWhere('s.algorithm = :algorithmId', { algorithmId: filters.algorithmId });
    }
    if (filters.status) {
      qb.andWhere('s.status = :status', { status: filters.status });
    }
  }

  /** Status filter intentionally omitted — returns full status breakdown */
  private async getPtStatusCounts(
    filters: PaperTradingFiltersDto,
    dateRange: DateRange
  ): Promise<Record<PaperTradingStatus, number>> {
    const qb = this.paperSessionRepo
      .createQueryBuilder('s')
      .select('s.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('s.status');

    if (dateRange) {
      qb.where('s.createdAt BETWEEN :start AND :end', dateRange);
    }
    if (filters.algorithmId) {
      qb.andWhere('s.algorithm = :algorithmId', { algorithmId: filters.algorithmId });
    }

    const results = await qb.getRawMany();
    const counts = Object.values(PaperTradingStatus).reduce(
      (acc, st) => {
        acc[st] = 0;
        return acc;
      },
      {} as Record<PaperTradingStatus, number>
    );

    for (const row of results) {
      counts[row.status as PaperTradingStatus] = parseInt(row.count, 10);
    }

    return counts;
  }

  private async getPtTotalSessions(filters: PaperTradingFiltersDto, dateRange: DateRange): Promise<number> {
    const qb = this.paperSessionRepo.createQueryBuilder('s');
    this.applyPtFilters(qb, filters, dateRange);
    return qb.getCount();
  }

  private async getPtRecentActivity(): Promise<RecentActivityDto> {
    return countRecentActivity(this.paperSessionRepo);
  }

  private async getPtAvgMetrics(
    filters: PaperTradingFiltersDto,
    dateRange: DateRange
  ): Promise<{ sharpeRatio: number; totalReturn: number; maxDrawdown: number; winRate: number }> {
    const qb = this.paperSessionRepo
      .createQueryBuilder('s')
      .select('AVG(s.sharpeRatio)', 'avgSharpe')
      .addSelect('AVG(s.totalReturn)', 'avgReturn')
      .addSelect('AVG(s.maxDrawdown)', 'avgDrawdown')
      .addSelect('AVG(s.winRate)', 'avgWinRate')
      .where('s.status IN (:...statuses)', {
        statuses: [PaperTradingStatus.COMPLETED, PaperTradingStatus.ACTIVE]
      });

    if (dateRange) {
      qb.andWhere('s.createdAt BETWEEN :start AND :end', dateRange);
    }
    if (filters.algorithmId) {
      qb.andWhere('s.algorithm = :algorithmId', { algorithmId: filters.algorithmId });
    }

    const result = await qb.getRawOne();
    return {
      sharpeRatio: parseFloat(result?.avgSharpe) || 0,
      totalReturn: parseFloat(result?.avgReturn) || 0,
      maxDrawdown: parseFloat(result?.avgDrawdown) || 0,
      winRate: parseFloat(result?.avgWinRate) || 0
    };
  }

  private async getPtTopAlgorithms(
    filters: PaperTradingFiltersDto,
    dateRange: DateRange
  ): Promise<PaperTradingMonitoringDto['topAlgorithms']> {
    const qb = this.paperSessionRepo
      .createQueryBuilder('s')
      .innerJoin('s.algorithm', 'a')
      .select('a.id', 'algorithmId')
      .addSelect('a.name', 'algorithmName')
      .addSelect('COUNT(*)', 'sessionCount')
      .addSelect('AVG(s.totalReturn)', 'avgReturn')
      .addSelect('AVG(s.sharpeRatio)', 'avgSharpe')
      .where('s.status IN (:...statuses)', {
        statuses: [PaperTradingStatus.COMPLETED, PaperTradingStatus.ACTIVE]
      })
      .groupBy('a.id')
      .addGroupBy('a.name')
      .orderBy('AVG(s.sharpeRatio)', 'DESC', 'NULLS LAST')
      .limit(10);

    if (dateRange) {
      qb.andWhere('s.createdAt BETWEEN :start AND :end', dateRange);
    }

    const results = await qb.getRawMany();
    return results.map((r) => ({
      algorithmId: r.algorithmId,
      algorithmName: r.algorithmName,
      sessionCount: parseInt(r.sessionCount, 10),
      avgReturn: parseFloat(r.avgReturn) || 0,
      avgSharpe: parseFloat(r.avgSharpe) || 0
    }));
  }

  private async getPtOrderAnalytics(
    filters: PaperTradingFiltersDto,
    dateRange: DateRange
  ): Promise<PaperTradingMonitoringDto['orderAnalytics']> {
    const sessionSubQuery = this.paperSessionRepo.createQueryBuilder('s').select('s.id');
    this.applyPtFilters(sessionSubQuery, filters, dateRange);

    const subSql = sessionSubQuery.getQuery();
    const subParams = sessionSubQuery.getParameters();

    const [summary, bySymbol] = await Promise.all([
      this.paperOrderRepo
        .createQueryBuilder('o')
        .select('COUNT(*)', 'totalOrders')
        .addSelect(`COUNT(*) FILTER (WHERE o.side = :buySide)`, 'buyCount')
        .addSelect(`COUNT(*) FILTER (WHERE o.side = :sellSide)`, 'sellCount')
        .addSelect('COALESCE(SUM(o.totalValue), 0)', 'totalVolume')
        .addSelect('COALESCE(SUM(o.fee), 0)', 'totalFees')
        .addSelect('AVG(o.slippageBps)', 'avgSlippageBps')
        .addSelect('COALESCE(SUM(o.realizedPnL), 0)', 'totalPnL')
        .where(`o.sessionId IN (${subSql})`)
        .setParameters(subParams)
        .setParameter('buySide', PaperTradingOrderSide.BUY)
        .setParameter('sellSide', PaperTradingOrderSide.SELL)
        .getRawOne(),
      this.paperOrderRepo
        .createQueryBuilder('o')
        .select('o.symbol', 'symbol')
        .addSelect('COUNT(*)', 'orderCount')
        .addSelect('COALESCE(SUM(o.totalValue), 0)', 'totalVolume')
        .addSelect('COALESCE(SUM(o.realizedPnL), 0)', 'totalPnL')
        .where(`o.sessionId IN (${subSql})`)
        .setParameters(subParams)
        .groupBy('o.symbol')
        .orderBy('COALESCE(SUM(o.totalValue), 0)', 'DESC')
        .limit(10)
        .getRawMany()
    ]);

    return {
      totalOrders: parseInt(summary?.totalOrders, 10) || 0,
      buyCount: parseInt(summary?.buyCount, 10) || 0,
      sellCount: parseInt(summary?.sellCount, 10) || 0,
      totalVolume: parseFloat(summary?.totalVolume) || 0,
      totalFees: parseFloat(summary?.totalFees) || 0,
      avgSlippageBps: parseFloat(summary?.avgSlippageBps) || 0,
      totalPnL: parseFloat(summary?.totalPnL) || 0,
      bySymbol: bySymbol.map((r) => ({
        symbol: r.symbol,
        orderCount: parseInt(r.orderCount, 10),
        totalVolume: parseFloat(r.totalVolume) || 0,
        totalPnL: parseFloat(r.totalPnL) || 0
      }))
    };
  }

  private async getPtSignalAnalytics(
    filters: PaperTradingFiltersDto,
    dateRange: DateRange
  ): Promise<PaperTradingMonitoringDto['signalAnalytics']> {
    const sessionSubQuery = this.paperSessionRepo.createQueryBuilder('s').select('s.id');
    this.applyPtFilters(sessionSubQuery, filters, dateRange);

    const subSql = sessionSubQuery.getQuery();
    const subParams = sessionSubQuery.getParameters();

    const [overallResult, typeResults, directionResults] = await Promise.all([
      this.paperSignalRepo
        .createQueryBuilder('sig')
        .select('COUNT(*)', 'totalSignals')
        .addSelect('AVG(CASE WHEN sig.processed = true THEN 1.0 ELSE 0.0 END)', 'processedRate')
        .addSelect('AVG(sig.confidence)', 'avgConfidence')
        .where(`sig.sessionId IN (${subSql})`)
        .setParameters(subParams)
        .getRawOne(),
      this.paperSignalRepo
        .createQueryBuilder('sig')
        .select('sig.signalType', 'signalType')
        .addSelect('COUNT(*)', 'count')
        .where(`sig.sessionId IN (${subSql})`)
        .setParameters(subParams)
        .groupBy('sig.signalType')
        .getRawMany(),
      this.paperSignalRepo
        .createQueryBuilder('sig')
        .select('sig.direction', 'direction')
        .addSelect('COUNT(*)', 'count')
        .where(`sig.sessionId IN (${subSql})`)
        .setParameters(subParams)
        .groupBy('sig.direction')
        .getRawMany()
    ]);

    const byType = Object.values(PaperTradingSignalType).reduce(
      (acc, t) => {
        acc[t] = 0;
        return acc;
      },
      {} as Record<PaperTradingSignalType, number>
    );
    for (const row of typeResults) {
      byType[row.signalType as PaperTradingSignalType] = parseInt(row.count, 10);
    }

    const byDirection = Object.values(PaperTradingSignalDirection).reduce(
      (acc, d) => {
        acc[d] = 0;
        return acc;
      },
      {} as Record<PaperTradingSignalDirection, number>
    );
    for (const row of directionResults) {
      byDirection[row.direction as PaperTradingSignalDirection] = parseInt(row.count, 10);
    }

    return {
      totalSignals: parseInt(overallResult?.totalSignals, 10) || 0,
      processedRate: parseFloat(overallResult?.processedRate) || 0,
      avgConfidence: parseFloat(overallResult?.avgConfidence) || 0,
      byType,
      byDirection
    };
  }
}
