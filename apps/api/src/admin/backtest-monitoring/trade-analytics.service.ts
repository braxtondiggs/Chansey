import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Decimal } from 'decimal.js';
import { In, Repository } from 'typeorm';

import { BacktestFiltersDto } from './dto/overview.dto';
import {
  BacktestSlippageStatsDto,
  InstrumentTradeMetricsDto,
  ProfitabilityStatsDto,
  TradeAnalyticsDto,
  TradeDurationStatsDto,
  TradeSummaryDto
} from './dto/trade-analytics.dto';
import { formatDuration, getDateRange, getEmptyTradeAnalytics, getFilteredBacktestIds } from './monitoring-shared.util';

import { BacktestSummary, InstrumentTradeBreakdown } from '../../order/backtest/backtest-summary.entity';
import { Backtest } from '../../order/backtest/backtest.entity';
import { mergeHistograms, percentileFromHistogram } from '../../order/backtest/summary-histogram.util';

@Injectable()
export class TradeAnalyticsService {
  constructor(
    @InjectRepository(Backtest) private readonly backtestRepo: Repository<Backtest>,
    @InjectRepository(BacktestSummary) private readonly summaryRepo: Repository<BacktestSummary>
  ) {}

  async getTradeAnalytics(filters: BacktestFiltersDto): Promise<TradeAnalyticsDto> {
    const dateRange = getDateRange(filters);
    const backtestIds = await getFilteredBacktestIds(this.backtestRepo, filters, dateRange);

    if (backtestIds.length === 0) {
      return getEmptyTradeAnalytics();
    }

    const summaries = await this.summaryRepo.find({
      where: { backtestId: In(backtestIds) }
    });

    if (summaries.length === 0) {
      return getEmptyTradeAnalytics();
    }

    return {
      summary: this.aggregateSummary(summaries),
      profitability: this.aggregateProfitability(summaries),
      duration: this.aggregateDuration(summaries),
      slippage: this.aggregateSlippage(summaries),
      byInstrument: this.aggregateByInstrument(summaries)
    };
  }

  private aggregateSummary(summaries: BacktestSummary[]): TradeSummaryDto {
    let totalTrades = 0;
    let totalVolume = 0;
    let totalFees = 0;
    let buyCount = 0;
    let sellCount = 0;
    for (const s of summaries) {
      totalTrades += s.totalTrades;
      totalVolume += Number(s.totalVolume) || 0;
      totalFees += Number(s.totalFees) || 0;
      buyCount += s.buyCount;
      sellCount += s.sellCount;
    }
    return { totalTrades, totalVolume, totalFees, buyCount, sellCount };
  }

  private aggregateProfitability(summaries: BacktestSummary[]): ProfitabilityStatsDto {
    let winCount = 0;
    let lossCount = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let largestWin: number | null = null;
    let largestLoss: number | null = null;
    let winSum = 0;
    let lossSum = 0;
    let totalRealizedPnL = 0;

    for (const s of summaries) {
      winCount += s.winCount;
      lossCount += s.lossCount;
      grossProfit += Number(s.grossProfit) || 0;
      grossLoss += Number(s.grossLoss) || 0;
      if (s.largestWin !== null) {
        const v = Number(s.largestWin);
        if (largestWin === null || v > largestWin) largestWin = v;
      }
      if (s.largestLoss !== null) {
        const v = Number(s.largestLoss);
        if (largestLoss === null || v < largestLoss) largestLoss = v;
      }
      if (s.avgWin !== null && s.winCount > 0) {
        winSum += Number(s.avgWin) * s.winCount;
      }
      if (s.avgLoss !== null && s.lossCount > 0) {
        lossSum += Number(s.avgLoss) * s.lossCount;
      }
      if (s.totalRealizedPnL !== null) {
        totalRealizedPnL += Number(s.totalRealizedPnL);
      }
    }

    const resolvedTrades = winCount + lossCount;
    const winRate = resolvedTrades > 0 ? winCount / resolvedTrades : 0;
    const profitFactor = grossLoss > 0 ? new Decimal(grossProfit).dividedBy(grossLoss).toNumber() : 0;
    const avgWin = winCount > 0 ? winSum / winCount : 0;
    const avgLossNegative = lossCount > 0 ? lossSum / lossCount : 0;
    const avgLossAbs = Math.abs(avgLossNegative);

    const expectancy = new Decimal(avgWin)
      .times(winRate)
      .minus(new Decimal(avgLossAbs).times(1 - winRate))
      .toNumber();

    return {
      winCount,
      lossCount,
      winRate,
      profitFactor,
      largestWin: largestWin ?? 0,
      largestLoss: largestLoss ?? 0,
      expectancy,
      avgWin,
      avgLoss: avgLossNegative,
      totalRealizedPnL
    };
  }

  private aggregateDuration(summaries: BacktestSummary[]): TradeDurationStatsDto {
    const merged = mergeHistograms(summaries.map((s) => s.holdTimeHistogram));
    if (!merged || merged.count === 0) {
      return getEmptyTradeAnalytics().duration;
    }

    const avgHoldTimeMs = merged.count > 0 ? merged.sum / merged.count : 0;
    const medianHoldTimeMs = percentileFromHistogram(merged, 0.5) ?? 0;
    const maxHoldTimeMs = merged.max ?? 0;
    const minHoldTimeMs = merged.min ?? 0;

    return {
      avgHoldTimeMs,
      avgHoldTime: formatDuration(avgHoldTimeMs),
      medianHoldTimeMs,
      medianHoldTime: formatDuration(medianHoldTimeMs),
      maxHoldTimeMs,
      maxHoldTime: formatDuration(maxHoldTimeMs),
      minHoldTimeMs,
      minHoldTime: formatDuration(minHoldTimeMs)
    };
  }

  private aggregateSlippage(summaries: BacktestSummary[]): BacktestSlippageStatsDto {
    let totalImpact = 0;
    let fillCount = 0;
    let maxBps: number | null = null;
    for (const s of summaries) {
      totalImpact += Number(s.slippageTotalImpact) || 0;
      fillCount += s.slippageFillCount;
      if (s.slippageMaxBps !== null) {
        const v = Number(s.slippageMaxBps);
        if (maxBps === null || v > maxBps) maxBps = v;
      }
    }

    const merged = mergeHistograms(summaries.map((s) => s.slippageHistogram));
    const avgBps = merged && merged.count > 0 ? merged.sum / merged.count : 0;
    const p95Bps = percentileFromHistogram(merged, 0.95) ?? 0;

    return {
      avgBps,
      totalImpact,
      p95Bps,
      maxBps: maxBps ?? 0,
      fillCount
    };
  }

  private aggregateByInstrument(summaries: BacktestSummary[]): InstrumentTradeMetricsDto[] {
    const merged = new Map<string, InstrumentTradeBreakdown>();
    for (const s of summaries) {
      for (const row of s.tradesByInstrument ?? []) {
        let target = merged.get(row.instrument);
        if (!target) {
          target = {
            instrument: row.instrument,
            tradeCount: 0,
            sellCount: 0,
            wins: 0,
            losses: 0,
            totalVolume: 0,
            totalPnL: 0,
            returnSum: 0,
            returnCount: 0
          };
          merged.set(row.instrument, target);
        }
        target.tradeCount += row.tradeCount;
        target.sellCount += row.sellCount;
        target.wins += row.wins;
        target.losses += row.losses;
        target.totalVolume += row.totalVolume;
        target.totalPnL += row.totalPnL;
        target.returnSum += row.returnSum;
        target.returnCount += row.returnCount;
      }
    }
    return Array.from(merged.values())
      .sort((a, b) => b.totalVolume - a.totalVolume)
      .slice(0, 10)
      .map((o) => {
        const resolved = o.wins + o.losses;
        return {
          instrument: o.instrument,
          tradeCount: o.tradeCount,
          totalReturn: o.returnSum,
          winRate: resolved > 0 ? o.wins / resolved : 0,
          totalVolume: o.totalVolume,
          totalPnL: o.totalPnL
        };
      });
  }
}
