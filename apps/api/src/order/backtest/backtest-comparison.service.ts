import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { BacktestCoreRepository } from './backtest-core-repository.service';
import { BacktestMapper } from './backtest-mapper.service';
import { BacktestPerformanceSnapshot } from './backtest-performance-snapshot.entity';
import { Backtest, BacktestType } from './backtest.entity';
import { ComparisonReport, ComparisonReportRun } from './comparison-report.entity';
import { BacktestComparisonDto, CreateComparisonReportDto } from './dto/backtest.dto';

import { ComparisonReportNotFoundException } from '../../common/exceptions/resource';
import { User } from '../../users/users.entity';

@Injectable()
export class BacktestComparisonService {
  constructor(
    private readonly mapper: BacktestMapper,
    private readonly coreRepository: BacktestCoreRepository,
    @InjectRepository(BacktestPerformanceSnapshot)
    private readonly backtestSnapshotRepository: Repository<BacktestPerformanceSnapshot>,
    @InjectRepository(ComparisonReport)
    private readonly comparisonReportRepository: Repository<ComparisonReport>,
    @InjectRepository(ComparisonReportRun)
    private readonly comparisonReportRunRepository: Repository<ComparisonReportRun>
  ) {}

  async compareBacktests(user: User, comparisonDto: BacktestComparisonDto) {
    const backtests = await this.loadBacktestsForUser(user.id, comparisonDto.backtestIds);
    return this.buildComparisonResponse(backtests, undefined, user);
  }

  async createComparisonReport(user: User, dto: CreateComparisonReportDto) {
    if (dto.runIds.length < 2) {
      throw new BadRequestException('Please select at least two runs to compare');
    }

    const backtests = await this.loadBacktestsForUser(user.id, dto.runIds);
    const report = this.comparisonReportRepository.create({
      name: dto.name,
      filters: dto.filters as Record<string, unknown>,
      createdBy: user
    });

    const savedReport = await this.comparisonReportRepository.save(report);
    const runEntities = dto.runIds.map((id) =>
      this.comparisonReportRunRepository.create({
        comparisonReportId: savedReport.id,
        backtestId: id
      })
    );

    await this.comparisonReportRunRepository.save(runEntities);
    return this.buildComparisonResponse(backtests, savedReport, user);
  }

  async getComparisonReport(user: User, reportId: string) {
    const report = await this.comparisonReportRepository.findOne({
      where: { id: reportId },
      relations: ['createdBy', 'runs']
    });

    if (!report) {
      throw new ComparisonReportNotFoundException(reportId);
    }

    const runIds = report.runs?.map((run) => run.backtestId) ?? [];
    const backtests = await this.loadBacktestsForUser(user.id, runIds);

    return this.buildComparisonResponse(backtests, report, user);
  }

  private async loadBacktestsForUser(userId: string, ids: string[]): Promise<Backtest[]> {
    const backtests = await this.coreRepository.findByIdsForUser(userId, ids);

    if (backtests.length !== ids.length) {
      const foundIds = new Set(backtests.map((b) => b.id));
      const missingIds = ids.filter((id) => !foundIds.has(id));
      throw new BadRequestException(`Backtests not found: ${missingIds.join(', ')}`);
    }

    return backtests;
  }

  private async buildComparisonResponse(backtests: Backtest[], report?: ComparisonReport, fallbackUser?: User) {
    const backtestIds = backtests.map((b) => b.id);
    const allSnapshots = backtestIds.length
      ? await this.backtestSnapshotRepository.find({
          where: { backtest: { id: In(backtestIds) } },
          relations: ['backtest'],
          order: { timestamp: 'ASC' }
        })
      : [];
    const snapshotsByBacktestId = new Map<string, BacktestPerformanceSnapshot[]>();
    for (const s of allSnapshots) {
      const arr = snapshotsByBacktestId.get(s.backtest.id) ?? [];
      arr.push(s);
      snapshotsByBacktestId.set(s.backtest.id, arr);
    }

    const runs = backtests.map((backtest) => {
      const snapshots = snapshotsByBacktestId.get(backtest.id) ?? [];
      const pf = Number((backtest.performanceMetrics as Record<string, unknown>)?.profitFactor);

      return {
        run: {
          id: backtest.id,
          name: backtest.name,
          description: backtest.description,
          mode: backtest.type === BacktestType.LIVE_REPLAY ? 'live_replay' : 'historical',
          status: backtest.status,
          algorithm: {
            id: backtest.algorithm?.id,
            name: backtest.algorithm?.name
          },
          marketDataSet: backtest.marketDataSet
            ? {
                id: backtest.marketDataSet.id,
                label: backtest.marketDataSet.label,
                timeframe: backtest.marketDataSet.timeframe
              }
            : undefined,
          initiatedAt: backtest.createdAt,
          completedAt: backtest.completedAt
        },
        metrics: {
          totalReturn: backtest.totalReturn ?? 0,
          sharpeRatio: backtest.sharpeRatio ?? 0,
          maxDrawdown: backtest.maxDrawdown ?? 0,
          winRate: backtest.winRate ?? 0,
          totalTrades: backtest.totalTrades ?? 0,
          profitFactor: Number.isFinite(pf) ? pf : null
        },
        snapshots: snapshots.map((snapshot) => ({
          timestamp: snapshot.timestamp,
          portfolioValue: snapshot.portfolioValue,
          cumulativeReturn: snapshot.cumulativeReturn
        })),
        benchmark: null
      };
    });

    const summary = runs.length
      ? {
          bestReturn: runs.reduce(
            (max, current) => Math.max(max, current.metrics.totalReturn ?? 0),
            Number.NEGATIVE_INFINITY
          ),
          bestSharpe: runs.reduce(
            (max, current) => Math.max(max, current.metrics.sharpeRatio ?? 0),
            Number.NEGATIVE_INFINITY
          ),
          lowestDrawdown: runs.reduce(
            (min, current) => Math.min(min, current.metrics.maxDrawdown ?? 0),
            Number.POSITIVE_INFINITY
          )
        }
      : { bestReturn: 0, bestSharpe: 0, lowestDrawdown: 0 };

    return {
      id: report?.id ?? null,
      name: report?.name ?? 'Ad-hoc Comparison',
      createdAt: report?.createdAt ?? new Date(),
      createdBy: this.mapper.createUserRef(report?.createdBy ?? fallbackUser),
      filters: report?.filters ?? null,
      runs,
      notes: [],
      summary
    };
  }
}
