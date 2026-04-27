import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { SignalStatus } from '@chansey/api-interfaces';

import { LiveTradeFiltersDto } from './dto/filters.dto';
import { SignalConversionPanelDto, SignalRejectionReasonDto } from './dto/overview.dto';
import { DateRange, toInt, toNumber } from './live-trade-monitoring.utils';

import {
  PaperTradingSignal,
  PaperTradingSignalStatus
} from '../../order/paper-trading/entities/paper-trading-signal.entity';
import { LiveTradingSignal } from '../../strategy/entities/live-trading-signal.entity';

const TOP_REJECTION_REASONS_LIMIT = 5;
const PLACED_LIVE_STATUSES = [SignalStatus.PLACED, SignalStatus.PROCESSED];
const PLACED_PAPER_STATUSES = [PaperTradingSignalStatus.SIMULATED];

interface RawConversionRow {
  totalSignals: string | number;
  placedSignals: string | number;
}

interface RawReasonRow {
  reasonCode: string | null;
  count: string | number;
}

interface RawAlgorithmConversionRow {
  algorithmId: string;
  totalSignals: string | number;
  placedSignals: string | number;
}

export interface AlgorithmConversionRow {
  algorithmId: string;
  totalSignals: number;
  placedSignals: number;
  conversionPct: number;
}

export interface ConversionMetrics extends SignalConversionPanelDto {
  perAlgorithm: AlgorithmConversionRow[];
}

@Injectable()
export class LiveTradeSignalConversionService {
  constructor(
    @InjectRepository(LiveTradingSignal)
    private readonly liveSignalRepo: Repository<LiveTradingSignal>,
    @InjectRepository(PaperTradingSignal)
    private readonly paperSignalRepo: Repository<PaperTradingSignal>
  ) {}

  /**
   * Aggregate signal → trade conversion across live + paper trading.
   *
   * Live trading signals are usually empty at this stage of the platform — we
   * still source from paper trading because it is the validation gate before
   * live promotion, and operators need to see filter-chain saturation as
   * early as possible.
   */
  async getConversionMetrics(filters: LiveTradeFiltersDto, dateRange: DateRange): Promise<ConversionMetrics> {
    const [liveTotals, paperTotals, liveReasons, paperReasons, livePerAlgo, paperPerAlgo] = await Promise.all([
      this.getLiveTotals(filters, dateRange),
      this.getPaperTotals(filters, dateRange),
      this.getLiveRejectionReasons(filters, dateRange),
      this.getPaperRejectionReasons(filters, dateRange),
      this.getLivePerAlgorithm(filters, dateRange),
      this.getPaperPerAlgorithm(filters, dateRange)
    ]);

    const totalSignals = liveTotals.totalSignals + paperTotals.totalSignals;
    const placedSignals = liveTotals.placedSignals + paperTotals.placedSignals;
    const rejectedSignals = Math.max(0, totalSignals - placedSignals);
    const conversionPct = totalSignals > 0 ? (placedSignals / totalSignals) * 100 : 0;

    const reasonCounts = new Map<string, number>();
    for (const row of [...liveReasons, ...paperReasons]) {
      const code = row.reasonCode ?? 'UNKNOWN';
      reasonCounts.set(code, (reasonCounts.get(code) ?? 0) + toInt(row.count));
    }

    const topRejectionReasons: SignalRejectionReasonDto[] = Array.from(reasonCounts.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, TOP_REJECTION_REASONS_LIMIT)
      .map(([reasonCode, count]) => ({
        reasonCode,
        count,
        pct: totalSignals > 0 ? (count / totalSignals) * 100 : 0
      }));

    const perAlgorithm = this.mergePerAlgorithm(livePerAlgo, paperPerAlgo);

    return {
      totalSignals,
      placedSignals,
      rejectedSignals,
      conversionPct,
      topRejectionReasons,
      perAlgorithm
    };
  }

  private async getLiveTotals(
    filters: LiveTradeFiltersDto,
    dateRange: DateRange
  ): Promise<{ totalSignals: number; placedSignals: number }> {
    const qb = this.liveSignalRepo.createQueryBuilder('ls').leftJoin('ls.algorithmActivation', 'aa');

    this.applyLiveFilters(qb, filters, dateRange);

    const result: RawConversionRow | undefined = await qb
      .select('COUNT(*)', 'totalSignals')
      .addSelect(`COUNT(*) FILTER (WHERE ls.status IN (:...placedStatuses))`, 'placedSignals')
      .setParameter('placedStatuses', PLACED_LIVE_STATUSES)
      .getRawOne();

    return {
      totalSignals: toInt(result?.totalSignals),
      placedSignals: toInt(result?.placedSignals)
    };
  }

  private async getPaperTotals(
    filters: LiveTradeFiltersDto,
    dateRange: DateRange
  ): Promise<{ totalSignals: number; placedSignals: number }> {
    const qb = this.paperSignalRepo.createQueryBuilder('ps').leftJoin('ps.session', 'sess');

    this.applyPaperFilters(qb, filters, dateRange);

    const result: RawConversionRow | undefined = await qb
      .select('COUNT(*)', 'totalSignals')
      .addSelect(`COUNT(*) FILTER (WHERE ps.status IN (:...placedStatuses))`, 'placedSignals')
      .setParameter('placedStatuses', PLACED_PAPER_STATUSES)
      .getRawOne();

    return {
      totalSignals: toInt(result?.totalSignals),
      placedSignals: toInt(result?.placedSignals)
    };
  }

  private async getLiveRejectionReasons(filters: LiveTradeFiltersDto, dateRange: DateRange): Promise<RawReasonRow[]> {
    const qb = this.liveSignalRepo.createQueryBuilder('ls').leftJoin('ls.algorithmActivation', 'aa');

    this.applyLiveFilters(qb, filters, dateRange);

    return qb
      .andWhere('ls.status NOT IN (:...placedStatuses)', { placedStatuses: PLACED_LIVE_STATUSES })
      .select('ls.reasonCode', 'reasonCode')
      .addSelect('COUNT(*)', 'count')
      .groupBy('ls.reasonCode')
      .getRawMany<RawReasonRow>();
  }

  private async getPaperRejectionReasons(filters: LiveTradeFiltersDto, dateRange: DateRange): Promise<RawReasonRow[]> {
    const qb = this.paperSignalRepo.createQueryBuilder('ps').leftJoin('ps.session', 'sess');

    this.applyPaperFilters(qb, filters, dateRange);

    return qb
      .andWhere('ps.status NOT IN (:...placedStatuses)', { placedStatuses: PLACED_PAPER_STATUSES })
      .select('ps.rejectionCode', 'reasonCode')
      .addSelect('COUNT(*)', 'count')
      .groupBy('ps.rejectionCode')
      .getRawMany<RawReasonRow>();
  }

  private async getLivePerAlgorithm(
    filters: LiveTradeFiltersDto,
    dateRange: DateRange
  ): Promise<RawAlgorithmConversionRow[]> {
    const qb = this.liveSignalRepo.createQueryBuilder('ls').innerJoin('ls.algorithmActivation', 'aa');

    this.applyLiveFilters(qb, filters, dateRange);

    return qb
      .select('aa.algorithmId', 'algorithmId')
      .addSelect('COUNT(*)', 'totalSignals')
      .addSelect(`COUNT(*) FILTER (WHERE ls.status IN (:...placedStatuses))`, 'placedSignals')
      .setParameter('placedStatuses', PLACED_LIVE_STATUSES)
      .groupBy('aa.algorithmId')
      .getRawMany<RawAlgorithmConversionRow>();
  }

  private async getPaperPerAlgorithm(
    filters: LiveTradeFiltersDto,
    dateRange: DateRange
  ): Promise<RawAlgorithmConversionRow[]> {
    const qb = this.paperSignalRepo.createQueryBuilder('ps').leftJoin('ps.session', 'sess');

    this.applyPaperFilters(qb, filters, dateRange);

    return qb
      .select('sess.algorithmId', 'algorithmId')
      .addSelect('COUNT(*)', 'totalSignals')
      .addSelect(`COUNT(*) FILTER (WHERE ps.status IN (:...placedStatuses))`, 'placedSignals')
      .setParameter('placedStatuses', PLACED_PAPER_STATUSES)
      .groupBy('sess.algorithmId')
      .getRawMany<RawAlgorithmConversionRow>();
  }

  private applyLiveFilters(
    qb: ReturnType<Repository<LiveTradingSignal>['createQueryBuilder']>,
    filters: LiveTradeFiltersDto,
    dateRange: DateRange
  ): void {
    if (filters.algorithmId) {
      qb.andWhere('aa.algorithmId = :algorithmId', { algorithmId: filters.algorithmId });
    }
    if (filters.userId) {
      qb.andWhere('ls.userId = :userId', { userId: filters.userId });
    }
    if (dateRange.startDate) {
      qb.andWhere('ls.createdAt >= :startDate', { startDate: dateRange.startDate });
    }
    if (dateRange.endDate) {
      qb.andWhere('ls.createdAt <= :endDate', { endDate: dateRange.endDate });
    }
  }

  private applyPaperFilters(
    qb: ReturnType<Repository<PaperTradingSignal>['createQueryBuilder']>,
    filters: LiveTradeFiltersDto,
    dateRange: DateRange
  ): void {
    if (filters.algorithmId) {
      qb.andWhere('sess.algorithmId = :algorithmId', { algorithmId: filters.algorithmId });
    }
    if (filters.userId) {
      qb.andWhere('sess.userId = :userId', { userId: filters.userId });
    }
    if (dateRange.startDate) {
      qb.andWhere('ps.createdAt >= :startDate', { startDate: dateRange.startDate });
    }
    if (dateRange.endDate) {
      qb.andWhere('ps.createdAt <= :endDate', { endDate: dateRange.endDate });
    }
  }

  private mergePerAlgorithm(
    liveRows: RawAlgorithmConversionRow[],
    paperRows: RawAlgorithmConversionRow[]
  ): AlgorithmConversionRow[] {
    const merged = new Map<string, { totalSignals: number; placedSignals: number }>();

    for (const row of [...liveRows, ...paperRows]) {
      if (!row.algorithmId) continue;
      const existing = merged.get(row.algorithmId) ?? { totalSignals: 0, placedSignals: 0 };
      existing.totalSignals += toInt(row.totalSignals);
      existing.placedSignals += toInt(row.placedSignals);
      merged.set(row.algorithmId, existing);
    }

    return Array.from(merged.entries()).map(([algorithmId, totals]) => ({
      algorithmId,
      totalSignals: totals.totalSignals,
      placedSignals: totals.placedSignals,
      conversionPct: totals.totalSignals > 0 ? toNumber((totals.placedSignals / totals.totalSignals) * 100) : 0
    }));
  }
}
