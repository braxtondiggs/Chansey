import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { BacktestFiltersDto } from './dto/overview.dto';
import {
  ConfidenceBucketDto,
  SignalAnalyticsDto,
  SignalDirectionMetricsDto,
  SignalInstrumentMetricsDto,
  SignalOverallStatsDto,
  SignalTypeMetricsDto
} from './dto/signal-analytics.dto';
import { getDateRange, getEmptySignalAnalytics, getFilteredBacktestIds } from './monitoring-shared.util';

import { SignalDirection, SignalType } from '../../order/backtest/backtest-signal.entity';
import {
  BacktestSummary,
  ConfidenceBucketBreakdown,
  InstrumentSignalBreakdown,
  SignalOutcomeBucket
} from '../../order/backtest/backtest-summary.entity';
import { Backtest } from '../../order/backtest/backtest.entity';

const CONFIDENCE_BUCKET_ORDER = ['0-20%', '20-40%', '40-60%', '60-80%', '80-100%'];

function emptyOutcome(): SignalOutcomeBucket {
  return { count: 0, wins: 0, losses: 0, returnSum: 0, returnCount: 0 };
}

function mergeOutcome(a: SignalOutcomeBucket, b: SignalOutcomeBucket): SignalOutcomeBucket {
  return {
    count: a.count + b.count,
    wins: a.wins + b.wins,
    losses: a.losses + b.losses,
    returnSum: a.returnSum + b.returnSum,
    returnCount: a.returnCount + b.returnCount
  };
}

function outcomeSuccessRate(o: SignalOutcomeBucket): number {
  const resolved = o.wins + o.losses;
  return resolved > 0 ? o.wins / resolved : 0;
}

function outcomeAvgReturn(o: SignalOutcomeBucket): number {
  return o.returnCount > 0 ? o.returnSum / o.returnCount : 0;
}

@Injectable()
export class SignalAnalyticsService {
  constructor(
    @InjectRepository(Backtest) private readonly backtestRepo: Repository<Backtest>,
    @InjectRepository(BacktestSummary) private readonly summaryRepo: Repository<BacktestSummary>
  ) {}

  async getSignalAnalytics(filters: BacktestFiltersDto): Promise<SignalAnalyticsDto> {
    const dateRange = getDateRange(filters);
    const backtestIds = await getFilteredBacktestIds(this.backtestRepo, filters, dateRange);

    if (backtestIds.length === 0) {
      return getEmptySignalAnalytics();
    }

    const summaries = await this.summaryRepo.find({
      where: { backtestId: In(backtestIds) }
    });

    if (summaries.length === 0) {
      return getEmptySignalAnalytics();
    }

    return {
      overall: this.aggregateOverall(summaries),
      byConfidenceBucket: this.aggregateByConfidenceBucket(summaries),
      bySignalType: this.aggregateBySignalType(summaries),
      byDirection: this.aggregateByDirection(summaries),
      byInstrument: this.aggregateByInstrument(summaries)
    };
  }

  private aggregateOverall(summaries: BacktestSummary[]): SignalOverallStatsDto {
    let totalSignals = 0;
    let entryCount = 0;
    let exitCount = 0;
    let adjustmentCount = 0;
    let riskControlCount = 0;
    let confidenceSumAgg = 0;
    let confidenceCountAgg = 0;

    for (const s of summaries) {
      totalSignals += s.totalSignals;
      entryCount += s.entryCount;
      exitCount += s.exitCount;
      adjustmentCount += s.adjustmentCount;
      riskControlCount += s.riskControlCount;
      confidenceSumAgg += Number(s.confidenceSum) || 0;
      confidenceCountAgg += s.confidenceCount || 0;
    }

    return {
      totalSignals,
      entryCount,
      exitCount,
      adjustmentCount,
      riskControlCount,
      avgConfidence: confidenceCountAgg > 0 ? confidenceSumAgg / confidenceCountAgg : 0
    };
  }

  private aggregateByConfidenceBucket(summaries: BacktestSummary[]): ConfidenceBucketDto[] {
    const merged = new Map<string, ConfidenceBucketBreakdown>();
    for (const label of CONFIDENCE_BUCKET_ORDER) {
      merged.set(label, { bucket: label, signalCount: 0, wins: 0, losses: 0, returnSum: 0, returnCount: 0 });
    }
    for (const s of summaries) {
      for (const bucket of s.signalsByConfidenceBucket ?? []) {
        const target = merged.get(bucket.bucket);
        if (!target) continue;
        target.signalCount += bucket.signalCount;
        target.wins += bucket.wins;
        target.losses += bucket.losses;
        target.returnSum += bucket.returnSum;
        target.returnCount += bucket.returnCount;
      }
    }
    return CONFIDENCE_BUCKET_ORDER.map((label) => {
      const b = merged.get(label) as ConfidenceBucketBreakdown;
      const resolved = b.wins + b.losses;
      return {
        bucket: label,
        signalCount: b.signalCount,
        successRate: resolved > 0 ? b.wins / resolved : 0,
        avgReturn: b.returnCount > 0 ? b.returnSum / b.returnCount : 0
      };
    });
  }

  private aggregateBySignalType(summaries: BacktestSummary[]): SignalTypeMetricsDto[] {
    const merged: Record<string, SignalOutcomeBucket> = {};
    for (const s of summaries) {
      const byType = s.signalsByType ?? {};
      for (const typeKey of Object.keys(byType)) {
        merged[typeKey] = mergeOutcome(merged[typeKey] ?? emptyOutcome(), byType[typeKey]);
      }
    }
    return Object.values(SignalType)
      .map((type) => {
        const o = merged[type];
        if (!o) return null;
        return {
          type,
          count: o.count,
          successRate: outcomeSuccessRate(o),
          avgReturn: outcomeAvgReturn(o)
        } satisfies SignalTypeMetricsDto;
      })
      .filter((v): v is SignalTypeMetricsDto => v !== null);
  }

  private aggregateByDirection(summaries: BacktestSummary[]): SignalDirectionMetricsDto[] {
    const merged: Record<string, SignalOutcomeBucket> = {};
    for (const s of summaries) {
      const byDir = s.signalsByDirection ?? {};
      for (const dirKey of Object.keys(byDir)) {
        merged[dirKey] = mergeOutcome(merged[dirKey] ?? emptyOutcome(), byDir[dirKey]);
      }
    }
    return Object.values(SignalDirection)
      .map((direction) => {
        const o = merged[direction];
        if (!o) return null;
        return {
          direction,
          count: o.count,
          successRate: outcomeSuccessRate(o),
          avgReturn: outcomeAvgReturn(o)
        } satisfies SignalDirectionMetricsDto;
      })
      .filter((v): v is SignalDirectionMetricsDto => v !== null);
  }

  private aggregateByInstrument(summaries: BacktestSummary[]): SignalInstrumentMetricsDto[] {
    const merged = new Map<string, InstrumentSignalBreakdown>();
    for (const s of summaries) {
      for (const row of s.signalsByInstrument ?? []) {
        let target = merged.get(row.instrument);
        if (!target) {
          target = {
            instrument: row.instrument,
            count: 0,
            wins: 0,
            losses: 0,
            returnSum: 0,
            returnCount: 0
          };
          merged.set(row.instrument, target);
        }
        target.count += row.count;
        target.wins += row.wins;
        target.losses += row.losses;
        target.returnSum += row.returnSum;
        target.returnCount += row.returnCount;
      }
    }
    return Array.from(merged.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((o) => {
        const resolved = o.wins + o.losses;
        return {
          instrument: o.instrument,
          count: o.count,
          successRate: resolved > 0 ? o.wins / resolved : 0,
          avgReturn: o.returnCount > 0 ? o.returnSum / o.returnCount : 0
        };
      });
  }
}
