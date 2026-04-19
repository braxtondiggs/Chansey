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
import { calculatePaperTradingProgress } from './monitoring-shared.util';

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
   * Get paper trading monitoring analytics for the admin dashboard.
   *
   * Fans the previously 7 parallel queries (sessions × 4, orders × 2, signals × 3) into
   * 3 round trips — one per physical table — by using conditional aggregates and scalar
   * subqueries within each query. This collapses the admin dashboard's Promise.all
   * connection footprint from ≥8 → 3.
   */
  async getPaperTradingMonitoring(filters: PaperTradingFiltersDto): Promise<PaperTradingMonitoringDto> {
    const dateRange = this.getPtDateRange(filters);

    const [sessionAggregate, orderAnalytics, signalAnalytics] = await Promise.all([
      this.getPtSessionAggregate(filters, dateRange),
      this.getPtOrderAnalytics(filters, dateRange),
      this.getPtSignalAnalytics(filters, dateRange)
    ]);

    return {
      statusCounts: sessionAggregate.statusCounts,
      totalSessions: sessionAggregate.totalSessions,
      recentActivity: sessionAggregate.recentActivity,
      avgMetrics: sessionAggregate.avgMetrics,
      topAlgorithms: sessionAggregate.topAlgorithms,
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

  /**
   * Fan-in of statusCounts + totalSessions + recentActivity + avgMetrics + topAlgorithms
   * into a single query using conditional aggregates and a scalar subquery for top
   * algorithms (GROUP BY + ORDER BY + LIMIT, can't be a plain FILTER clause).
   */
  private async getPtSessionAggregate(
    filters: PaperTradingFiltersDto,
    dateRange: DateRange
  ): Promise<{
    statusCounts: Record<PaperTradingStatus, number>;
    totalSessions: number;
    recentActivity: RecentActivityDto;
    avgMetrics: { sharpeRatio: number; totalReturn: number; maxDrawdown: number; winRate: number };
    topAlgorithms: PaperTradingMonitoringDto['topAlgorithms'];
  }> {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const qb = this.paperSessionRepo.createQueryBuilder('s');

    // Status values for FILTER conditionals
    for (const st of Object.values(PaperTradingStatus)) {
      qb.setParameter(`ptStatusVal_${st}`, st);
    }
    qb.setParameter('ptCompleted', PaperTradingStatus.COMPLETED);
    qb.setParameter('ptActive', PaperTradingStatus.ACTIVE);
    qb.setParameter('ptRecent24h', yesterday);
    qb.setParameter('ptRecent7d', lastWeek);
    qb.setParameter('ptRecent30d', lastMonth);

    const statusFilter = filters.status ? ' AND s.status = :totalStatusFilter' : '';
    if (filters.status) qb.setParameter('totalStatusFilter', filters.status);

    // Derive the scope string for the top-algorithms scalar subquery.
    // Uses the SAME filter semantics as getPtTopAlgorithms (ignores filters.status).
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
    // Status counts (status filter omitted)
    for (const st of Object.values(PaperTradingStatus)) {
      selects.push([`COUNT(*) FILTER (WHERE s.status = :ptStatusVal_${st})`, `status_${st}`]);
    }
    // Total sessions (all filters)
    selects.push([statusFilter ? `COUNT(*) FILTER (WHERE 1=1 ${statusFilter})` : 'COUNT(*)', 'total_sessions']);
    // Recent activity
    selects.push([`COUNT(*) FILTER (WHERE s."createdAt" >= :ptRecent24h)`, 'recent_24h']);
    selects.push([`COUNT(*) FILTER (WHERE s."createdAt" >= :ptRecent7d)`, 'recent_7d']);
    selects.push([`COUNT(*) FILTER (WHERE s."createdAt" >= :ptRecent30d)`, 'recent_30d']);
    // Avg metrics (COMPLETED or ACTIVE)
    const metricsFilter = `s.status IN (:ptCompleted, :ptActive)`;
    selects.push([`AVG(s.sharpeRatio) FILTER (WHERE ${metricsFilter})`, 'avg_sharpe']);
    selects.push([`AVG(s.totalReturn) FILTER (WHERE ${metricsFilter})`, 'avg_return']);
    selects.push([`AVG(s.maxDrawdown) FILTER (WHERE ${metricsFilter})`, 'avg_drawdown']);
    selects.push([`AVG(s.winRate) FILTER (WHERE ${metricsFilter})`, 'avg_win_rate']);
    // Top algorithms (scalar subquery)
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
      recentActivity: {
        last24h: parseInt(row.recent_24h ?? '0', 10) || 0,
        last7d: parseInt(row.recent_7d ?? '0', 10) || 0,
        last30d: parseInt(row.recent_30d ?? '0', 10) || 0
      },
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
   * Fan-in orders summary + bySymbol into one round trip using a scalar subquery for
   * the per-symbol breakdown. The session scope filter is applied once and reused via
   * a shared parameter bag.
   */
  private async getPtOrderAnalytics(
    filters: PaperTradingFiltersDto,
    dateRange: DateRange
  ): Promise<PaperTradingMonitoringDto['orderAnalytics']> {
    const sessionSubQuery = this.paperSessionRepo.createQueryBuilder('s').select('s.id');
    this.applyPtFilters(sessionSubQuery, filters, dateRange);

    const subSql = sessionSubQuery.getQuery();
    const subParams = sessionSubQuery.getParameters();

    const bySymbolSubquery = `COALESCE((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t."totalVolume" DESC)
      FROM (
        SELECT o2.symbol AS "symbol",
               COUNT(*)::int AS "orderCount",
               COALESCE(SUM(o2."totalValue"), 0) AS "totalVolume",
               COALESCE(SUM(o2."realizedPnL"), 0) AS "totalPnL"
        FROM paper_trading_orders o2
        WHERE o2."sessionId" IN (${subSql})
        GROUP BY o2.symbol
        ORDER BY COALESCE(SUM(o2."totalValue"), 0) DESC
        LIMIT 10
      ) t
    ), '[]'::jsonb)`;

    const summary = await this.paperOrderRepo
      .createQueryBuilder('o')
      .select('COUNT(*)', 'totalOrders')
      .addSelect(`COUNT(*) FILTER (WHERE o.side = :buySide)`, 'buyCount')
      .addSelect(`COUNT(*) FILTER (WHERE o.side = :sellSide)`, 'sellCount')
      .addSelect('COALESCE(SUM(o.totalValue), 0)', 'totalVolume')
      .addSelect('COALESCE(SUM(o.fee), 0)', 'totalFees')
      .addSelect('AVG(o.slippageBps)', 'avgSlippageBps')
      .addSelect('COALESCE(SUM(o.realizedPnL), 0)', 'totalPnL')
      .addSelect(bySymbolSubquery, 'bySymbol')
      .where(`o.sessionId IN (${subSql})`)
      .setParameters(subParams)
      .setParameter('buySide', PaperTradingOrderSide.BUY)
      .setParameter('sellSide', PaperTradingOrderSide.SELL)
      .getRawOne<Record<string, string | null>>();

    const rawBySymbol = summary?.bySymbol;
    const parsedBySymbol: Array<{ symbol: string; orderCount: number; totalVolume: number; totalPnL: number }> =
      (() => {
        if (!rawBySymbol) return [];
        const parsed = typeof rawBySymbol === 'string' ? JSON.parse(rawBySymbol) : rawBySymbol;
        if (!Array.isArray(parsed)) return [];
        return parsed.map((r: Record<string, unknown>) => ({
          symbol: String(r.symbol),
          orderCount: Number(r.orderCount) || 0,
          totalVolume: Number(r.totalVolume) || 0,
          totalPnL: Number(r.totalPnL) || 0
        }));
      })();

    return {
      totalOrders: parseInt(summary?.totalOrders ?? '0', 10) || 0,
      buyCount: parseInt(summary?.buyCount ?? '0', 10) || 0,
      sellCount: parseInt(summary?.sellCount ?? '0', 10) || 0,
      totalVolume: parseFloat(summary?.totalVolume ?? '0') || 0,
      totalFees: parseFloat(summary?.totalFees ?? '0') || 0,
      avgSlippageBps: parseFloat(summary?.avgSlippageBps ?? '0') || 0,
      totalPnL: parseFloat(summary?.totalPnL ?? '0') || 0,
      bySymbol: parsedBySymbol
    };
  }

  /**
   * Fan-in signals overall + byType + byDirection into one round trip via scalar
   * subqueries for the two grouped breakdowns.
   */
  private async getPtSignalAnalytics(
    filters: PaperTradingFiltersDto,
    dateRange: DateRange
  ): Promise<PaperTradingMonitoringDto['signalAnalytics']> {
    const sessionSubQuery = this.paperSessionRepo.createQueryBuilder('s').select('s.id');
    this.applyPtFilters(sessionSubQuery, filters, dateRange);

    const subSql = sessionSubQuery.getQuery();
    const subParams = sessionSubQuery.getParameters();

    const byTypeSubquery = `COALESCE((
      SELECT jsonb_object_agg("signalType", cnt)
      FROM (
        SELECT sig2."signalType" AS "signalType", COUNT(*)::int AS cnt
        FROM paper_trading_signals sig2
        WHERE sig2."sessionId" IN (${subSql})
        GROUP BY sig2."signalType"
      ) t
    ), '{}'::jsonb)`;

    const byDirectionSubquery = `COALESCE((
      SELECT jsonb_object_agg(direction, cnt)
      FROM (
        SELECT sig3.direction AS direction, COUNT(*)::int AS cnt
        FROM paper_trading_signals sig3
        WHERE sig3."sessionId" IN (${subSql})
        GROUP BY sig3.direction
      ) t
    ), '{}'::jsonb)`;

    const row = await this.paperSignalRepo
      .createQueryBuilder('sig')
      .select('COUNT(*)', 'totalSignals')
      .addSelect('AVG(CASE WHEN sig.processed = true THEN 1.0 ELSE 0.0 END)', 'processedRate')
      .addSelect('AVG(sig.confidence)', 'avgConfidence')
      .addSelect(byTypeSubquery, 'byType')
      .addSelect(byDirectionSubquery, 'byDirection')
      .where(`sig.sessionId IN (${subSql})`)
      .setParameters(subParams)
      .getRawOne<Record<string, string | null>>();

    const parsedByType: Record<string, number> = (() => {
      const raw = row?.byType;
      if (!raw) return {};
      return typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, number>);
    })();

    const parsedByDirection: Record<string, number> = (() => {
      const raw = row?.byDirection;
      if (!raw) return {};
      return typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, number>);
    })();

    const byType = Object.values(PaperTradingSignalType).reduce(
      (acc, t) => {
        acc[t] = Number(parsedByType[t]) || 0;
        return acc;
      },
      {} as Record<PaperTradingSignalType, number>
    );

    const byDirection = Object.values(PaperTradingSignalDirection).reduce(
      (acc, d) => {
        acc[d] = Number(parsedByDirection[d]) || 0;
        return acc;
      },
      {} as Record<PaperTradingSignalDirection, number>
    );

    return {
      totalSignals: parseInt(row?.totalSignals ?? '0', 10) || 0,
      processedRate: parseFloat(row?.processedRate ?? '0') || 0,
      avgConfidence: parseFloat(row?.avgConfidence ?? '0') || 0,
      byType,
      byDirection
    };
  }
}
