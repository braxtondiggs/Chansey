import { type ObjectLiteral, type Repository, type SelectQueryBuilder } from 'typeorm';

import { type BacktestFiltersDto, type RecentActivityDto } from './dto/overview.dto';
import { type SignalAnalyticsDto } from './dto/signal-analytics.dto';
import { type TradeAnalyticsDto } from './dto/trade-analytics.dto';

import { type Coin } from '../../coin/coin.entity';
import { type Backtest, BacktestStatus } from '../../order/backtest/backtest.entity';
import {
  type PaperTradingSession,
  PaperTradingStatus
} from '../../order/paper-trading/entities/paper-trading-session.entity';

/** UUID v4 pattern (case-insensitive) */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DateRange = { start: Date; end: Date } | null;

export function getDateRange(filters: BacktestFiltersDto): DateRange {
  if (!filters.startDate && !filters.endDate) {
    return null;
  }

  return {
    start: filters.startDate ? new Date(filters.startDate) : new Date(0),
    end: filters.endDate ? new Date(filters.endDate) : new Date()
  };
}

export function applyBacktestFilters(
  qb: SelectQueryBuilder<Backtest>,
  filters: BacktestFiltersDto,
  dateRange: DateRange
): void {
  if (dateRange) {
    qb.andWhere('b.createdAt BETWEEN :start AND :end', dateRange);
  }

  if (filters.algorithmId) {
    qb.andWhere('b.algorithmId = :algorithmId', { algorithmId: filters.algorithmId });
  }

  if (filters.status) {
    qb.andWhere('b.status = :status', { status: filters.status });
  }

  if (filters.type) {
    qb.andWhere('b.type = :type', { type: filters.type });
  }
}

export async function getFilteredBacktestIds(
  backtestRepo: Repository<Backtest>,
  filters: BacktestFiltersDto,
  dateRange: DateRange
): Promise<string[]> {
  const qb = backtestRepo.createQueryBuilder('b').select('b.id');
  applyBacktestFilters(qb, filters, dateRange);
  const results = await qb.getRawMany();
  return results.map((r) => r.b_id);
}

export function calculateProgress(backtest: Backtest): number {
  if (backtest.status === BacktestStatus.COMPLETED) return 100;
  if (backtest.status === BacktestStatus.FAILED || backtest.status === BacktestStatus.CANCELLED) return 0;
  if (backtest.totalTimestampCount === 0) return 0;
  return Math.round((backtest.processedTimestampCount / backtest.totalTimestampCount) * 100);
}

export function calculatePaperTradingProgress(session: PaperTradingSession): number {
  if (session.status === PaperTradingStatus.COMPLETED) return 100;
  if (session.status === PaperTradingStatus.FAILED || session.status === PaperTradingStatus.STOPPED) return 0;
  if (session.status !== PaperTradingStatus.ACTIVE) return 0;
  if (!session.startedAt || !session.duration) return 0;

  const durationMs = parseDuration(session.duration);
  if (durationMs <= 0) return 0;

  const elapsedMs = Date.now() - session.startedAt.getTime();
  return Math.min(100, Math.max(0, Math.round((elapsedMs / durationMs) * 100)));
}

export function formatDuration(ms: number): string {
  if (ms === 0) return '0m';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhdwMy])$/);
  if (!match) return 0;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    M: 30 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000
  };

  return value * (multipliers[unit] ?? 0);
}

export async function countRecentActivity(repo: Repository<ObjectLiteral>): Promise<RecentActivityDto> {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const row = await repo
    .createQueryBuilder('r')
    .select('COUNT(*) FILTER (WHERE r."createdAt" >= :d1)', 'last24h')
    .addSelect('COUNT(*) FILTER (WHERE r."createdAt" >= :d7)', 'last7d')
    .addSelect('COUNT(*) FILTER (WHERE r."createdAt" >= :d30)', 'last30d')
    .setParameters({ d1: yesterday, d7: lastWeek, d30: lastMonth })
    .getRawOne<{ last24h: string; last7d: string; last30d: string }>();

  return {
    last24h: parseInt(row?.last24h ?? '0', 10),
    last7d: parseInt(row?.last7d ?? '0', 10),
    last30d: parseInt(row?.last30d ?? '0', 10)
  };
}

export interface InstrumentSymbolResolver {
  /** Returns the resolved symbol for an id, or the original value if not a known UUID. */
  resolve(id: string | null | undefined): string | undefined;
}

/**
 * Batch-resolve instrument UUIDs to coin symbols.
 * Non-UUID values (already symbols) are skipped during the DB query, but the
 * returned resolver still passes them through unchanged.
 */
export async function resolveInstrumentSymbols(
  coinRepo: Repository<Coin>,
  instruments: Set<string>
): Promise<InstrumentSymbolResolver> {
  const uuids = [...instruments].filter((v) => UUID_RE.test(v));
  const map = new Map<string, string>();

  if (uuids.length > 0) {
    const coins = await coinRepo
      .createQueryBuilder('c')
      .select(['c.id', 'c.symbol'])
      .where('c.id IN (:...ids)', { ids: uuids })
      .getMany();

    for (const coin of coins) {
      map.set(coin.id.toLowerCase(), coin.symbol.toUpperCase());
    }
  }

  return {
    resolve(id: string | null | undefined): string | undefined {
      if (id === null || id === undefined) return undefined;
      return map.get(id.toLowerCase()) ?? id;
    }
  };
}

export function getEmptySignalAnalytics(): SignalAnalyticsDto {
  return {
    overall: {
      totalSignals: 0,
      entryCount: 0,
      exitCount: 0,
      adjustmentCount: 0,
      riskControlCount: 0,
      avgConfidence: 0
    },
    byConfidenceBucket: [],
    bySignalType: [],
    byDirection: [],
    byInstrument: []
  };
}

export function getEmptyTradeAnalytics(): TradeAnalyticsDto {
  return {
    summary: {
      totalTrades: 0,
      totalVolume: 0,
      totalFees: 0,
      buyCount: 0,
      sellCount: 0
    },
    profitability: {
      winCount: 0,
      lossCount: 0,
      winRate: 0,
      profitFactor: 0,
      largestWin: 0,
      largestLoss: 0,
      expectancy: 0,
      avgWin: 0,
      avgLoss: 0,
      totalRealizedPnL: 0
    },
    duration: {
      avgHoldTimeMs: 0,
      avgHoldTime: 'N/A',
      medianHoldTimeMs: 0,
      medianHoldTime: 'N/A',
      maxHoldTimeMs: 0,
      maxHoldTime: 'N/A',
      minHoldTimeMs: 0,
      minHoldTime: 'N/A'
    },
    slippage: {
      avgBps: 0,
      totalImpact: 0,
      p95Bps: 0,
      maxBps: 0,
      fillCount: 0
    },
    byInstrument: []
  };
}
