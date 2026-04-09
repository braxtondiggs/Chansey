import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { BacktestFiltersDto } from './dto/overview.dto';
import {
  ConfidenceBucketDto,
  SignalAnalyticsDto,
  SignalDirectionMetricsDto,
  SignalInstrumentMetricsDto,
  SignalOverallStatsDto,
  SignalTypeMetricsDto
} from './dto/signal-analytics.dto';
import {
  getDateRange,
  getEmptySignalAnalytics,
  getFilteredBacktestIds,
  resolveInstrumentSymbols
} from './monitoring-shared.util';

import { Coin } from '../../coin/coin.entity';
import { BacktestSignal, SignalDirection, SignalType } from '../../order/backtest/backtest-signal.entity';
import { BacktestTrade, TradeType } from '../../order/backtest/backtest-trade.entity';
import { Backtest } from '../../order/backtest/backtest.entity';

@Injectable()
export class SignalAnalyticsService {
  constructor(
    @InjectRepository(Backtest) private readonly backtestRepo: Repository<Backtest>,
    @InjectRepository(BacktestSignal) private readonly signalRepo: Repository<BacktestSignal>,
    @InjectRepository(Coin) private readonly coinRepo: Repository<Coin>
  ) {}

  /**
   * Get signal analytics
   */
  async getSignalAnalytics(filters: BacktestFiltersDto): Promise<SignalAnalyticsDto> {
    const dateRange = getDateRange(filters);
    const backtestIds = await getFilteredBacktestIds(this.backtestRepo, filters, dateRange);

    if (backtestIds.length === 0) {
      return getEmptySignalAnalytics();
    }

    const [overall, byConfidenceBucket, bySignalType, byDirection, byInstrument] = await Promise.all([
      this.getSignalOverallStats(backtestIds),
      this.getSignalsByConfidenceBucket(backtestIds),
      this.getSignalsByType(backtestIds),
      this.getSignalsByDirection(backtestIds),
      this.getSignalsByInstrument(backtestIds)
    ]);

    return {
      overall,
      byConfidenceBucket,
      bySignalType,
      byDirection,
      byInstrument
    };
  }

  private async getSignalOverallStats(backtestIds: string[]): Promise<SignalOverallStatsDto> {
    const qb = this.signalRepo
      .createQueryBuilder('s')
      .select('COUNT(*)', 'totalSignals')
      .addSelect(`COUNT(*) FILTER (WHERE s.signalType = :entryType)`, 'entryCount')
      .addSelect(`COUNT(*) FILTER (WHERE s.signalType = :exitType)`, 'exitCount')
      .addSelect(`COUNT(*) FILTER (WHERE s.signalType = :adjustmentType)`, 'adjustmentCount')
      .addSelect(`COUNT(*) FILTER (WHERE s.signalType = :riskControlType)`, 'riskControlCount')
      .addSelect('AVG(s.confidence)', 'avgConfidence')
      .where('s.backtestId IN (:...backtestIds)', { backtestIds })
      .setParameter('entryType', SignalType.ENTRY)
      .setParameter('exitType', SignalType.EXIT)
      .setParameter('adjustmentType', SignalType.ADJUSTMENT)
      .setParameter('riskControlType', SignalType.RISK_CONTROL);

    const result = await qb.getRawOne();

    return {
      totalSignals: parseInt(result?.totalSignals, 10) || 0,
      entryCount: parseInt(result?.entryCount, 10) || 0,
      exitCount: parseInt(result?.exitCount, 10) || 0,
      adjustmentCount: parseInt(result?.adjustmentCount, 10) || 0,
      riskControlCount: parseInt(result?.riskControlCount, 10) || 0,
      avgConfidence: parseFloat(result?.avgConfidence) || 0
    };
  }

  private async getSignalsByConfidenceBucket(backtestIds: string[]): Promise<ConfidenceBucketDto[]> {
    const qb = this.signalRepo
      .createQueryBuilder('s')
      .select(
        `CASE
        WHEN s.confidence < 0.2 THEN '0-20%'
        WHEN s.confidence < 0.4 THEN '20-40%'
        WHEN s.confidence < 0.6 THEN '40-60%'
        WHEN s.confidence < 0.8 THEN '60-80%'
        ELSE '80-100%'
      END`,
        'bucket'
      )
      .addSelect('COUNT(*)', 'signalCount')
      .addSelect(
        `AVG(CASE WHEN t."realizedPnL" > 0 THEN 1.0 WHEN t."realizedPnL" < 0 THEN 0.0 ELSE NULL END)`,
        'successRate'
      )
      .addSelect('AVG(t."realizedPnLPercent")', 'avgReturn')
      .leftJoin(
        (subQuery) =>
          subQuery
            .select('t2.id', 'id')
            .addSelect('t2.backtestId', 'backtestId')
            .addSelect('t2.realizedPnL', 'realizedPnL')
            .addSelect('t2.realizedPnLPercent', 'realizedPnLPercent')
            .addSelect('t2.executedAt', 'executedAt')
            .addSelect('CAST(bc.id AS text)', 'instrument')
            .from(BacktestTrade, 't2')
            .leftJoin('t2.baseCoin', 'bc')
            .where('t2.type = :sellType', { sellType: TradeType.SELL }),
        't',
        't."backtestId" = s."backtestId" AND t."executedAt" >= s.timestamp AND t.instrument = s.instrument'
      )
      .where('s.backtestId IN (:...backtestIds)', { backtestIds })
      .andWhere('s.confidence IS NOT NULL')
      .groupBy('bucket')
      .orderBy('bucket', 'ASC');

    const results = await qb.getRawMany();

    const bucketOrder = ['0-20%', '20-40%', '40-60%', '60-80%', '80-100%'];
    const bucketMap = new Map(results.map((r) => [r.bucket, r]));

    return bucketOrder.map((bucket) => {
      const data = bucketMap.get(bucket);
      return {
        bucket,
        signalCount: parseInt(data?.signalCount, 10) || 0,
        successRate: parseFloat(data?.successRate) || 0,
        avgReturn: parseFloat(data?.avgReturn) || 0
      };
    });
  }

  private async getSignalsByType(backtestIds: string[]): Promise<SignalTypeMetricsDto[]> {
    const qb = this.signalRepo
      .createQueryBuilder('s')
      .select('s.signalType', 'type')
      .addSelect('COUNT(*)', 'count')
      .addSelect(
        `AVG(CASE WHEN t."realizedPnL" > 0 THEN 1.0 WHEN t."realizedPnL" < 0 THEN 0.0 ELSE NULL END)`,
        'successRate'
      )
      .addSelect('AVG(t."realizedPnLPercent")', 'avgReturn')
      .leftJoin(
        (subQuery) =>
          subQuery
            .select('t2.id', 'id')
            .addSelect('t2.backtestId', 'backtestId')
            .addSelect('t2.realizedPnL', 'realizedPnL')
            .addSelect('t2.realizedPnLPercent', 'realizedPnLPercent')
            .addSelect('t2.executedAt', 'executedAt')
            .addSelect('CAST(bc.id AS text)', 'instrument')
            .from(BacktestTrade, 't2')
            .leftJoin('t2.baseCoin', 'bc')
            .where('t2.type = :sellType', { sellType: TradeType.SELL }),
        't',
        't.instrument = s.instrument AND t."backtestId" = s."backtestId" AND t."executedAt" >= s.timestamp'
      )
      .where('s.backtestId IN (:...backtestIds)', { backtestIds })
      .groupBy('s.signalType');

    const results = await qb.getRawMany();

    return results.map((r) => ({
      type: r.type as SignalType,
      count: parseInt(r.count, 10) || 0,
      successRate: parseFloat(r.successRate) || 0,
      avgReturn: parseFloat(r.avgReturn) || 0
    }));
  }

  private async getSignalsByDirection(backtestIds: string[]): Promise<SignalDirectionMetricsDto[]> {
    const qb = this.signalRepo
      .createQueryBuilder('s')
      .select('s.direction', 'direction')
      .addSelect('COUNT(*)', 'count')
      .addSelect(
        `AVG(CASE WHEN t."realizedPnL" > 0 THEN 1.0 WHEN t."realizedPnL" < 0 THEN 0.0 ELSE NULL END)`,
        'successRate'
      )
      .addSelect('AVG(t."realizedPnLPercent")', 'avgReturn')
      .leftJoin(
        (subQuery) =>
          subQuery
            .select('t2.id', 'id')
            .addSelect('t2.backtestId', 'backtestId')
            .addSelect('t2.realizedPnL', 'realizedPnL')
            .addSelect('t2.realizedPnLPercent', 'realizedPnLPercent')
            .addSelect('t2.executedAt', 'executedAt')
            .addSelect('CAST(bc.id AS text)', 'instrument')
            .from(BacktestTrade, 't2')
            .leftJoin('t2.baseCoin', 'bc')
            .where('t2.type = :sellType', { sellType: TradeType.SELL }),
        't',
        't.instrument = s.instrument AND t."backtestId" = s."backtestId" AND t."executedAt" >= s.timestamp'
      )
      .where('s.backtestId IN (:...backtestIds)', { backtestIds })
      .groupBy('s.direction');

    const results = await qb.getRawMany();

    return results.map((r) => ({
      direction: r.direction as SignalDirection,
      count: parseInt(r.count, 10) || 0,
      successRate: parseFloat(r.successRate) || 0,
      avgReturn: parseFloat(r.avgReturn) || 0
    }));
  }

  private async getSignalsByInstrument(backtestIds: string[]): Promise<SignalInstrumentMetricsDto[]> {
    const qb = this.signalRepo
      .createQueryBuilder('s')
      .select('UPPER(s.instrument)', 'instrument')
      .addSelect('COUNT(*)', 'count')
      .addSelect(
        `AVG(CASE WHEN t."realizedPnL" > 0 THEN 1.0 WHEN t."realizedPnL" < 0 THEN 0.0 ELSE NULL END)`,
        'successRate'
      )
      .addSelect('AVG(t."realizedPnLPercent")', 'avgReturn')
      .leftJoin(
        (subQuery) =>
          subQuery
            .select('t2.id', 'id')
            .addSelect('t2.backtestId', 'backtestId')
            .addSelect('t2.realizedPnL', 'realizedPnL')
            .addSelect('t2.realizedPnLPercent', 'realizedPnLPercent')
            .addSelect('t2.executedAt', 'executedAt')
            .addSelect('CAST(bc.id AS text)', 'instrument')
            .from(BacktestTrade, 't2')
            .leftJoin('t2.baseCoin', 'bc')
            .where('t2.type = :sellType', { sellType: TradeType.SELL }),
        't',
        't.instrument = s.instrument AND t."backtestId" = s."backtestId" AND t."executedAt" >= s.timestamp'
      )
      .where('s.backtestId IN (:...backtestIds)', { backtestIds })
      .groupBy('s.instrument')
      .orderBy('COUNT(*)', 'DESC')
      .limit(10);

    const results = await qb.getRawMany();

    // Resolve instrument UUIDs to coin symbols
    const instrumentSet = new Set(results.map((r) => r.instrument as string).filter(Boolean));
    const resolver = await resolveInstrumentSymbols(this.coinRepo, instrumentSet);

    return results.map((r) => ({
      instrument: resolver.resolve(r.instrument as string) ?? r.instrument,
      count: parseInt(r.count, 10) || 0,
      successRate: parseFloat(r.successRate) || 0,
      avgReturn: parseFloat(r.avgReturn) || 0
    }));
  }
}
