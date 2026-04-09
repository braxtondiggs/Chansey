import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { LiveReplayRunListItemDto, PaginatedLiveReplayRunsDto } from './dto/backtest-listing.dto';
import { BacktestFiltersDto } from './dto/overview.dto';
import { PipelineStageCountsDto, StageCountWithStatusDto } from './dto/paper-trading-analytics.dto';
import { applyBacktestFilters, calculateProgress, getDateRange } from './monitoring-shared.util';

import { OptimizationRun } from '../../optimization/entities/optimization-run.entity';
import { Backtest, BacktestType } from '../../order/backtest/backtest.entity';
import { PaperTradingSession } from '../../order/paper-trading/entities/paper-trading-session.entity';

@Injectable()
export class LiveReplayMonitoringService {
  constructor(
    @InjectRepository(Backtest) private readonly backtestRepo: Repository<Backtest>,
    @InjectRepository(OptimizationRun) private readonly optimizationRunRepo: Repository<OptimizationRun>,
    @InjectRepository(PaperTradingSession) private readonly paperSessionRepo: Repository<PaperTradingSession>
  ) {}

  async listLiveReplayRuns(filters: BacktestFiltersDto, page = 1, limit = 10): Promise<PaginatedLiveReplayRunsDto> {
    const dateRange = getDateRange(filters);
    const skip = (page - 1) * limit;

    const qb = this.backtestRepo
      .createQueryBuilder('b')
      .innerJoinAndSelect('b.algorithm', 'a')
      .where('b.type = :type', { type: BacktestType.LIVE_REPLAY });

    // Apply shared filters (date, status, algorithm) but skip type since we hardcode it
    applyBacktestFilters(qb, { ...filters, type: undefined }, dateRange);

    qb.orderBy('b.createdAt', 'DESC').skip(skip).take(limit);

    const [backtests, total] = await qb.getManyAndCount();

    const data: LiveReplayRunListItemDto[] = backtests.map((b) => ({
      id: b.id,
      name: b.name,
      algorithmName: b.algorithm?.name || 'Unknown',
      status: b.status,
      progressPercent: calculateProgress(b),
      processedTimestamps: b.processedTimestampCount,
      totalTimestamps: b.totalTimestampCount,
      totalReturn: b.totalReturn ?? null,
      sharpeRatio: b.sharpeRatio ?? null,
      maxDrawdown: b.maxDrawdown ?? null,
      replaySpeed: b.liveReplayState?.replaySpeed ?? null,
      isPaused: b.liveReplayState?.isPaused ?? null,
      createdAt: b.createdAt.toISOString()
    }));

    const totalPages = Math.ceil(total / limit);
    return { data, total, page, limit, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 };
  }

  /**
   * Get counts of records across all pipeline stages with per-stage status breakdowns
   */
  async getPipelineStageCounts(): Promise<PipelineStageCountsDto> {
    const [optRows, historicalRows, replayRows, ptRows] = await Promise.all([
      this.optimizationRunRepo
        .createQueryBuilder('r')
        .select('r.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('r.status')
        .getRawMany(),
      this.backtestRepo
        .createQueryBuilder('b')
        .select('b.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('b.type = :type', { type: BacktestType.HISTORICAL })
        .groupBy('b.status')
        .getRawMany(),
      this.backtestRepo
        .createQueryBuilder('b')
        .select('b.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('b.type = :type', { type: BacktestType.LIVE_REPLAY })
        .groupBy('b.status')
        .getRawMany(),
      this.paperSessionRepo
        .createQueryBuilder('s')
        .select('s.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('s.status')
        .getRawMany()
    ]);

    return {
      optimizationRuns: this.buildStageCount(optRows),
      historicalBacktests: this.buildStageCount(historicalRows),
      liveReplayBacktests: this.buildStageCount(replayRows),
      paperTradingSessions: this.buildStageCount(ptRows)
    };
  }

  private buildStageCount(rows: { status: string; count: string }[]): StageCountWithStatusDto {
    const statusBreakdown: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      const count = parseInt(row.count, 10);
      statusBreakdown[row.status] = count;
      total += count;
    }
    return { total, statusBreakdown };
  }
}
