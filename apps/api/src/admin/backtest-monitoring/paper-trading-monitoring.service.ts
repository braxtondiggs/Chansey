import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository, SelectQueryBuilder } from 'typeorm';

import {
  PaginatedPaperTradingSessionsDto,
  PaperTradingFiltersDto,
  PaperTradingMonitoringDto,
  PaperTradingSessionListItemDto
} from './dto/paper-trading-analytics.dto';
import { calculatePaperTradingProgress, countRecentActivity } from './monitoring-shared.util';

import {
  PaperTradingSessionSummary,
  PaperTradingSymbolBreakdown
} from '../../order/paper-trading/entities/paper-trading-session-summary.entity';
import {
  PaperTradingSession,
  PaperTradingStatus
} from '../../order/paper-trading/entities/paper-trading-session.entity';
import {
  PaperTradingSignalDirection,
  PaperTradingSignalType
} from '../../order/paper-trading/entities/paper-trading-signal.entity';

type DateRange = { start: Date; end: Date } | null;

@Injectable()
export class PaperTradingMonitoringService {
  constructor(
    @InjectRepository(PaperTradingSession) private readonly paperSessionRepo: Repository<PaperTradingSession>,
    @InjectRepository(PaperTradingSessionSummary)
    private readonly summaryRepo: Repository<PaperTradingSessionSummary>
  ) {}

  /**
   * Get paper trading monitoring analytics for the admin dashboard.
   *
   * Session-level aggregates (statusCounts, totalSessions, avgMetrics, topAlgorithms)
   * are still computed on the small indexed sessions table. Order + signal
   * analytics are computed over the per-session summary rows instead of scanning
   * paper_trading_orders / paper_trading_signals on every tab load.
   */
  async getPaperTradingMonitoring(filters: PaperTradingFiltersDto): Promise<PaperTradingMonitoringDto> {
    const dateRange = this.getPtDateRange(filters);

    const [sessionAggregate, summaryAggregate, recentActivity] = await Promise.all([
      this.getPtSessionAggregate(filters, dateRange),
      this.getPtSummaryAggregate(filters, dateRange),
      countRecentActivity(this.paperSessionRepo)
    ]);

    return {
      statusCounts: sessionAggregate.statusCounts,
      totalSessions: sessionAggregate.totalSessions,
      recentActivity,
      avgMetrics: sessionAggregate.avgMetrics,
      topAlgorithms: sessionAggregate.topAlgorithms,
      orderAnalytics: summaryAggregate.orderAnalytics,
      signalAnalytics: summaryAggregate.signalAnalytics
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
      createdAt: s.createdAt.toISOString(),
      stoppedReason: s.stoppedReason ?? null
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

  private async getPtSessionAggregate(
    filters: PaperTradingFiltersDto,
    dateRange: DateRange
  ): Promise<{
    statusCounts: Record<PaperTradingStatus, number>;
    totalSessions: number;
    avgMetrics: { sharpeRatio: number; totalReturn: number; maxDrawdown: number; winRate: number };
    topAlgorithms: PaperTradingMonitoringDto['topAlgorithms'];
  }> {
    const qb = this.paperSessionRepo.createQueryBuilder('s');

    for (const st of Object.values(PaperTradingStatus)) {
      qb.setParameter(`ptStatusVal_${st}`, st);
    }
    qb.setParameter('ptCompleted', PaperTradingStatus.COMPLETED);
    qb.setParameter('ptActive', PaperTradingStatus.ACTIVE);

    const statusFilter = filters.status ? ' AND s.status = :totalStatusFilter' : '';
    if (filters.status) qb.setParameter('totalStatusFilter', filters.status);

    const topAlgoScopeParts: string[] = ['s2."algorithmId" IS NOT NULL'];
    topAlgoScopeParts.push(`s2.status IN (:ptCompleted, :ptActive)`);
    if (dateRange) {
      topAlgoScopeParts.push(`s2."createdAt" BETWEEN :start AND :end`);
    }
    const topAlgoScope = topAlgoScopeParts.join(' AND ');

    const topAlgorithmsSubquery = `COALESCE((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t."avgSharpe" DESC NULLS LAST)
      FROM (
        SELECT a.id AS "algorithmId", a.name AS "algorithmName",
               COUNT(*)::int AS "sessionCount",
               AVG(s2."totalReturn") AS "avgReturn",
               AVG(s2."sharpeRatio") AS "avgSharpe"
        FROM paper_trading_sessions s2
        INNER JOIN algorithm a ON a.id = s2."algorithmId"
        WHERE ${topAlgoScope}
        GROUP BY a.id, a.name
        ORDER BY AVG(s2."sharpeRatio") DESC NULLS LAST
        LIMIT 10
      ) t
    ), '[]'::jsonb)`;

    const selects: Array<[string, string]> = [];
    for (const st of Object.values(PaperTradingStatus)) {
      selects.push([`COUNT(*) FILTER (WHERE s.status = :ptStatusVal_${st})`, `status_${st}`]);
    }
    selects.push([statusFilter ? `COUNT(*) FILTER (WHERE 1=1 ${statusFilter})` : 'COUNT(*)', 'total_sessions']);
    const metricsFilter = `s.status IN (:ptCompleted, :ptActive)`;
    selects.push([`AVG(s.sharpeRatio) FILTER (WHERE ${metricsFilter})`, 'avg_sharpe']);
    selects.push([`AVG(s.totalReturn) FILTER (WHERE ${metricsFilter})`, 'avg_return']);
    selects.push([`AVG(s.maxDrawdown) FILTER (WHERE ${metricsFilter})`, 'avg_drawdown']);
    selects.push([`AVG(s.winRate) FILTER (WHERE ${metricsFilter})`, 'avg_win_rate']);
    selects.push([topAlgorithmsSubquery, 'top_algorithms']);

    qb.select(selects[0][0], selects[0][1]);
    for (let i = 1; i < selects.length; i++) {
      qb.addSelect(selects[i][0], selects[i][1]);
    }

    if (dateRange) {
      qb.andWhere('s.createdAt BETWEEN :start AND :end', dateRange);
    }
    if (filters.algorithmId) {
      qb.andWhere('s.algorithm = :algorithmId', { algorithmId: filters.algorithmId });
    }

    const row = (await qb.getRawOne<Record<string, string | null>>()) ?? {};

    const statusCounts = Object.values(PaperTradingStatus).reduce(
      (acc, st) => {
        acc[st] = parseInt(row[`status_${st}`] ?? '0', 10) || 0;
        return acc;
      },
      {} as Record<PaperTradingStatus, number>
    );

    const topAlgorithms = this.parseTopAlgorithms(row.top_algorithms);

    return {
      statusCounts,
      totalSessions: parseInt(row.total_sessions ?? '0', 10) || 0,
      avgMetrics: {
        sharpeRatio: parseFloat(row.avg_sharpe ?? '0') || 0,
        totalReturn: parseFloat(row.avg_return ?? '0') || 0,
        maxDrawdown: parseFloat(row.avg_drawdown ?? '0') || 0,
        winRate: parseFloat(row.avg_win_rate ?? '0') || 0
      },
      topAlgorithms
    };
  }

  private parseTopAlgorithms(raw: unknown): PaperTradingMonitoringDto['topAlgorithms'] {
    if (!raw) return [];
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((r) => ({
      algorithmId: r.algorithmId,
      algorithmName: r.algorithmName,
      sessionCount: Number(r.sessionCount) || 0,
      avgReturn: Number(r.avgReturn) || 0,
      avgSharpe: Number(r.avgSharpe) || 0
    }));
  }

  /**
   * Load per-session summaries constrained to the filtered session scope and
   * merge in-memory into the order + signal analytics DTOs. Fills the same
   * output shape as the previous cross-table scalar subqueries.
   */
  private async getPtSummaryAggregate(
    filters: PaperTradingFiltersDto,
    dateRange: DateRange
  ): Promise<Pick<PaperTradingMonitoringDto, 'orderAnalytics' | 'signalAnalytics'>> {
    const sessionScopeQb = this.paperSessionRepo.createQueryBuilder('s').select('s.id');
    this.applyPtFilters(sessionScopeQb, filters, dateRange);

    // Skip the summary query entirely when no sessions match. Counting is cheaper
    // than materializing ids, and it sidesteps the 65k parameter cap that an
    // `IN (:...sessionIds)` expansion would hit on large admin filters.
    const sessionCount = await sessionScopeQb.clone().getCount();
    if (sessionCount === 0) {
      return {
        orderAnalytics: {
          totalOrders: 0,
          buyCount: 0,
          sellCount: 0,
          totalVolume: 0,
          totalFees: 0,
          avgSlippageBps: 0,
          totalPnL: 0,
          bySymbol: []
        },
        signalAnalytics: {
          totalSignals: 0,
          processedRate: 0,
          avgConfidence: 0,
          byType: Object.values(PaperTradingSignalType).reduce(
            (acc, t) => {
              acc[t] = 0;
              return acc;
            },
            {} as Record<PaperTradingSignalType, number>
          ),
          byDirection: Object.values(PaperTradingSignalDirection).reduce(
            (acc, d) => {
              acc[d] = 0;
              return acc;
            },
            {} as Record<PaperTradingSignalDirection, number>
          )
        }
      };
    }

    const summaries = await this.summaryRepo
      .createQueryBuilder('ps')
      .where(`ps."sessionId" IN (${sessionScopeQb.getQuery()})`)
      .setParameters(sessionScopeQb.getParameters())
      .getMany();

    let totalOrders = 0;
    let buyCount = 0;
    let sellCount = 0;
    let totalVolume = 0;
    let totalFees = 0;
    let totalPnL = 0;
    let slippageSum = 0;
    let slippageCount = 0;
    const symbolMap = new Map<string, PaperTradingSymbolBreakdown>();

    let totalSignals = 0;
    let processedCount = 0;
    let confidenceSum = 0;
    let confidenceCount = 0;
    const byType: Record<string, number> = {};
    const byDirection: Record<string, number> = {};

    for (const s of summaries) {
      totalOrders += s.totalOrders;
      buyCount += s.buyCount;
      sellCount += s.sellCount;
      totalVolume += Number(s.totalVolume) || 0;
      totalFees += Number(s.totalFees) || 0;
      totalPnL += Number(s.totalPnL) || 0;
      slippageSum += Number(s.slippageSumBps) || 0;
      slippageCount += s.slippageCount;

      for (const sym of s.ordersBySymbol ?? []) {
        let target = symbolMap.get(sym.symbol);
        if (!target) {
          target = { symbol: sym.symbol, orderCount: 0, totalVolume: 0, totalPnL: 0 };
          symbolMap.set(sym.symbol, target);
        }
        target.orderCount += sym.orderCount;
        target.totalVolume += sym.totalVolume;
        target.totalPnL += sym.totalPnL;
      }

      totalSignals += s.totalSignals;
      processedCount += s.processedCount;
      confidenceSum += Number(s.confidenceSum) || 0;
      confidenceCount += s.confidenceCount;
      for (const k of Object.keys(s.signalsByType ?? {})) {
        byType[k] = (byType[k] ?? 0) + (s.signalsByType[k] ?? 0);
      }
      for (const k of Object.keys(s.signalsByDirection ?? {})) {
        byDirection[k] = (byDirection[k] ?? 0) + (s.signalsByDirection[k] ?? 0);
      }
    }

    const bySymbol = Array.from(symbolMap.values())
      .sort((a, b) => b.totalVolume - a.totalVolume)
      .slice(0, 10);

    return {
      orderAnalytics: {
        totalOrders,
        buyCount,
        sellCount,
        totalVolume,
        totalFees,
        avgSlippageBps: slippageCount > 0 ? slippageSum / slippageCount : 0,
        totalPnL,
        bySymbol
      },
      signalAnalytics: {
        totalSignals,
        processedRate: totalSignals > 0 ? processedCount / totalSignals : 0,
        avgConfidence: confidenceCount > 0 ? confidenceSum / confidenceCount : 0,
        byType: Object.values(PaperTradingSignalType).reduce(
          (acc, t) => {
            acc[t] = Number(byType[t]) || 0;
            return acc;
          },
          {} as Record<PaperTradingSignalType, number>
        ),
        byDirection: Object.values(PaperTradingSignalDirection).reduce(
          (acc, d) => {
            acc[d] = Number(byDirection[d]) || 0;
            return acc;
          },
          {} as Record<PaperTradingSignalDirection, number>
        )
      }
    };
  }
}
