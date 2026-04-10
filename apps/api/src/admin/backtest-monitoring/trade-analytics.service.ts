import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Decimal } from 'decimal.js';
import { Repository } from 'typeorm';

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

import { BacktestTrade, TradeType } from '../../order/backtest/backtest-trade.entity';
import { Backtest } from '../../order/backtest/backtest.entity';
import { SimulatedOrderFill } from '../../order/backtest/simulated-order-fill.entity';

@Injectable()
export class TradeAnalyticsService {
  constructor(
    @InjectRepository(Backtest) private readonly backtestRepo: Repository<Backtest>,
    @InjectRepository(BacktestTrade) private readonly tradeRepo: Repository<BacktestTrade>,
    @InjectRepository(SimulatedOrderFill) private readonly fillRepo: Repository<SimulatedOrderFill>
  ) {}

  /**
   * Get trade analytics
   */
  async getTradeAnalytics(filters: BacktestFiltersDto): Promise<TradeAnalyticsDto> {
    const dateRange = getDateRange(filters);
    const backtestIds = await getFilteredBacktestIds(this.backtestRepo, filters, dateRange);

    if (backtestIds.length === 0) {
      return getEmptyTradeAnalytics();
    }

    const [summary, profitability, duration, slippage, byInstrument] = await Promise.all([
      this.getTradeSummary(backtestIds),
      this.getProfitabilityStats(backtestIds),
      this.getTradeDurationStats(backtestIds),
      this.getSlippageStats(backtestIds),
      this.getTradesByInstrument(backtestIds)
    ]);

    return {
      summary,
      profitability,
      duration,
      slippage,
      byInstrument
    };
  }

  private async getTradeSummary(backtestIds: string[]): Promise<TradeSummaryDto> {
    const qb = this.tradeRepo
      .createQueryBuilder('t')
      .select('COUNT(*)', 'totalTrades')
      .addSelect('SUM(t.totalValue)', 'totalVolume')
      .addSelect('SUM(t.fee)', 'totalFees')
      .addSelect(`COUNT(*) FILTER (WHERE t.type = :buyType)`, 'buyCount')
      .addSelect(`COUNT(*) FILTER (WHERE t.type = :sellType)`, 'sellCount')
      .where('t.backtestId IN (:...backtestIds)', { backtestIds })
      .setParameter('buyType', TradeType.BUY)
      .setParameter('sellType', TradeType.SELL);

    const result = await qb.getRawOne();

    return {
      totalTrades: parseInt(result?.totalTrades, 10) || 0,
      totalVolume: parseFloat(result?.totalVolume) || 0,
      totalFees: parseFloat(result?.totalFees) || 0,
      buyCount: parseInt(result?.buyCount, 10) || 0,
      sellCount: parseInt(result?.sellCount, 10) || 0
    };
  }

  private async getProfitabilityStats(backtestIds: string[]): Promise<ProfitabilityStatsDto> {
    const qb = this.tradeRepo
      .createQueryBuilder('t')
      .select(`COUNT(*) FILTER (WHERE t.realizedPnL > 0)`, 'winCount')
      .addSelect(`COUNT(*) FILTER (WHERE t.realizedPnL < 0)`, 'lossCount')
      .addSelect(`SUM(CASE WHEN t.realizedPnL > 0 THEN t.realizedPnL ELSE 0 END)`, 'grossProfit')
      .addSelect(`ABS(SUM(CASE WHEN t.realizedPnL < 0 THEN t.realizedPnL ELSE 0 END))`, 'grossLoss')
      .addSelect(`MAX(t.realizedPnL)`, 'largestWin')
      .addSelect(`MIN(t.realizedPnL)`, 'largestLoss')
      .addSelect(`AVG(CASE WHEN t.realizedPnL > 0 THEN t.realizedPnL ELSE NULL END)`, 'avgWin')
      .addSelect(`AVG(CASE WHEN t.realizedPnL < 0 THEN t.realizedPnL ELSE NULL END)`, 'avgLoss')
      .addSelect(`SUM(t.realizedPnL)`, 'totalRealizedPnL')
      .where('t.backtestId IN (:...backtestIds)', { backtestIds })
      .andWhere('t.type = :sellType', { sellType: TradeType.SELL });

    const result = await qb.getRawOne();

    const winCount = parseInt(result?.winCount, 10) || 0;
    const lossCount = parseInt(result?.lossCount, 10) || 0;
    const totalTrades = winCount + lossCount;
    const winRate = totalTrades > 0 ? winCount / totalTrades : 0;

    const grossProfit = parseFloat(result?.grossProfit) || 0;
    const grossLoss = parseFloat(result?.grossLoss) || 0;

    // Use Decimal.js for precise financial calculations
    const profitFactor = grossLoss > 0 ? new Decimal(grossProfit).dividedBy(grossLoss).toNumber() : 0;

    const avgWin = parseFloat(result?.avgWin) || 0;
    const avgLoss = Math.abs(parseFloat(result?.avgLoss) || 0);

    // Expectancy = (avgWin * winRate) - (avgLoss * lossRate)
    const expectancy = new Decimal(avgWin)
      .times(winRate)
      .minus(new Decimal(avgLoss).times(1 - winRate))
      .toNumber();

    return {
      winCount,
      lossCount,
      winRate,
      profitFactor,
      largestWin: parseFloat(result?.largestWin) || 0,
      largestLoss: parseFloat(result?.largestLoss) || 0,
      expectancy,
      avgWin,
      avgLoss: -(parseFloat(result?.avgLoss) || 0),
      totalRealizedPnL: parseFloat(result?.totalRealizedPnL) || 0
    };
  }

  private async getTradeDurationStats(backtestIds: string[]): Promise<TradeDurationStatsDto> {
    // Aggregate directly in SQL over metadata->>'holdTimeMs' so we don't have
    // to stream every trade into memory and we avoid the unordered-pagination
    // bug of the previous batched approach. PERCENTILE_CONT yields the true
    // median (including the even-count midpoint).
    const result = await this.tradeRepo
      .createQueryBuilder('t')
      .select(`AVG((t.metadata->>'holdTimeMs')::bigint)`, 'avgMs')
      .addSelect(`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (t.metadata->>'holdTimeMs')::bigint)`, 'medianMs')
      .addSelect(`MAX((t.metadata->>'holdTimeMs')::bigint)`, 'maxMs')
      .addSelect(`MIN((t.metadata->>'holdTimeMs')::bigint)`, 'minMs')
      .addSelect(`COUNT(*)`, 'cnt')
      .where('t.backtestId IN (:...backtestIds)', { backtestIds })
      .andWhere('t.type = :sellType', { sellType: TradeType.SELL })
      .andWhere(`t.metadata ? 'holdTimeMs'`)
      .getRawOne();

    const cnt = parseInt(result?.cnt, 10) || 0;
    if (cnt === 0) {
      return getEmptyTradeAnalytics().duration;
    }

    const avgHoldTimeMs = parseFloat(result?.avgMs) || 0;
    const medianHoldTimeMs = parseFloat(result?.medianMs) || 0;
    const maxHoldTimeMs = parseFloat(result?.maxMs) || 0;
    const minHoldTimeMs = parseFloat(result?.minMs) || 0;

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

  private async getSlippageStats(backtestIds: string[]): Promise<BacktestSlippageStatsDto> {
    const qb = this.fillRepo
      .createQueryBuilder('f')
      .select('AVG(f.slippageBps)', 'avgBps')
      .addSelect('SUM(f.slippageBps * f.filledQuantity * f.averagePrice / 10000)', 'totalImpact')
      .addSelect('MAX(f.slippageBps)', 'maxBps')
      .addSelect('COUNT(*)', 'fillCount')
      .where('f.backtestId IN (:...backtestIds)', { backtestIds })
      .andWhere('f.slippageBps IS NOT NULL');

    const result = await qb.getRawOne();

    // Calculate 95th percentile using PostgreSQL's PERCENTILE_CONT (efficient)
    const p95Result = await this.fillRepo
      .createQueryBuilder('f')
      .select('PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY f.slippageBps)', 'p95Bps')
      .where('f.backtestId IN (:...backtestIds)', { backtestIds })
      .andWhere('f.slippageBps IS NOT NULL')
      .getRawOne();

    const p95Bps = parseFloat(p95Result?.p95Bps) || 0;

    return {
      avgBps: parseFloat(result?.avgBps) || 0,
      totalImpact: parseFloat(result?.totalImpact) || 0,
      p95Bps,
      maxBps: parseFloat(result?.maxBps) || 0,
      fillCount: parseInt(result?.fillCount, 10) || 0
    };
  }

  private async getTradesByInstrument(backtestIds: string[]): Promise<InstrumentTradeMetricsDto[]> {
    const qb = this.tradeRepo
      .createQueryBuilder('t')
      .leftJoin('t.baseCoin', 'bc')
      .leftJoin('t.quoteCoin', 'qc')
      .select(`CONCAT(bc.symbol, '/', qc.symbol)`, 'instrument')
      .addSelect('COUNT(*)', 'tradeCount')
      .addSelect(`SUM(t.realizedPnLPercent) FILTER (WHERE t.type = :sellType)`, 'totalReturn')
      .addSelect(
        `AVG(CASE WHEN t.realizedPnL > 0 THEN 1.0 WHEN t.realizedPnL < 0 THEN 0.0 ELSE NULL END) FILTER (WHERE t.type = :sellType)`,
        'winRate'
      )
      .addSelect('SUM(t.totalValue)', 'totalVolume')
      .addSelect(`SUM(t.realizedPnL) FILTER (WHERE t.type = :sellType)`, 'totalPnL')
      .where('t.backtestId IN (:...backtestIds)', { backtestIds })
      .setParameter('sellType', TradeType.SELL)
      .groupBy('bc.symbol')
      .addGroupBy('qc.symbol')
      .orderBy('SUM(t.totalValue)', 'DESC')
      .limit(10);

    const results = await qb.getRawMany();

    return results.map((r) => ({
      instrument: r.instrument || 'Unknown',
      tradeCount: parseInt(r.tradeCount, 10) || 0,
      totalReturn: parseFloat(r.totalReturn) || 0,
      winRate: parseFloat(r.winRate) || 0,
      totalVolume: parseFloat(r.totalVolume) || 0,
      totalPnL: parseFloat(r.totalPnL) || 0
    }));
  }
}
