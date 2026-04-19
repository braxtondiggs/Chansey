import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Decimal } from 'decimal.js';
import { Repository } from 'typeorm';

import { LiveTradeFiltersDto } from './dto/filters.dto';
import {
  LiveSlippageStatsDto,
  SlippageAnalysisDto,
  SlippageByAlgorithmDto,
  SlippageBySizeDto,
  SlippageBySymbolDto,
  SlippageByTimeDto
} from './dto/slippage-analysis.dto';
import { DateRange, getDateRange, mapSlippageStatsRow, toInt, toNumber } from './live-trade-monitoring.utils';

import { SimulatedOrderFill } from '../../order/backtest/simulated-order-fill.entity';
import { Order } from '../../order/order.entity';

@Injectable()
export class LiveTradeSlippageService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(SimulatedOrderFill)
    private readonly fillRepo: Repository<SimulatedOrderFill>
  ) {}

  async getSlippageAnalysis(filters: LiveTradeFiltersDto): Promise<SlippageAnalysisDto> {
    const dateRange = getDateRange(filters);

    const [overall, byAlgorithm, byTimeOfDay, byOrderSize, bySymbol] = await Promise.all([
      this.getOverallSlippage(filters, dateRange),
      this.getSlippageByAlgorithm(filters, dateRange),
      this.getSlippageByTimeOfDay(filters, dateRange),
      this.getSlippageByOrderSize(filters, dateRange),
      this.getSlippageBySymbol(filters, dateRange)
    ]);

    const overallLive = overall.overallLive;
    const overallBacktest = overall.overallBacktest;
    const overallDifferenceBps = new Decimal(overallLive.avgBps).minus(overallBacktest?.avgBps || 0).toNumber();

    return {
      overallLive,
      overallBacktest,
      overallDifferenceBps,
      byAlgorithm,
      byTimeOfDay,
      byOrderSize,
      bySymbol,
      periodStart: dateRange.startDate?.toISOString() || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      periodEnd: dateRange.endDate?.toISOString() || new Date().toISOString()
    };
  }

  /**
   * Fan-in overall-live + overall-backtest into a single UNION ALL query. Each branch
   * projects its slippage value plus a 'source' discriminator, and the outer SELECT
   * aggregates per source. Collapses 2 connections → 1.
   */
  private async getOverallSlippage(
    filters: LiveTradeFiltersDto,
    dateRange: DateRange
  ): Promise<{ overallLive: LiveSlippageStatsDto; overallBacktest: LiveSlippageStatsDto | undefined }> {
    const params: Record<string, unknown> = {};
    const liveConditions: string[] = ['o."isAlgorithmicTrade" = TRUE', 'o."actualSlippageBps" IS NOT NULL'];
    const backtestConditions: string[] = [];

    if (filters.algorithmId) {
      liveConditions.push('aa."algorithmId" = :algorithmId');
      backtestConditions.push('b."algorithmId" = :algorithmId');
      params.algorithmId = filters.algorithmId;
    }
    if (dateRange.startDate) {
      liveConditions.push('o."createdAt" >= :startDate');
      params.startDate = dateRange.startDate;
    }
    if (dateRange.endDate) {
      liveConditions.push('o."createdAt" <= :endDate');
      params.endDate = dateRange.endDate;
    }

    const liveJoin = filters.algorithmId
      ? 'LEFT JOIN algorithm_activations aa ON aa.id = o."algorithmActivationId"'
      : '';
    const backtestWhere = backtestConditions.length > 0 ? `WHERE ${backtestConditions.join(' AND ')}` : '';

    const unionSql = `
      SELECT 'live' AS source, o."actualSlippageBps" AS bps
      FROM "order" o
      ${liveJoin}
      WHERE ${liveConditions.join(' AND ')}
      UNION ALL
      SELECT 'backtest' AS source, f."slippageBps" AS bps
      FROM simulated_order_fills f
      LEFT JOIN backtests b ON b.id = f."backtestId"
      ${backtestWhere}
    `;

    const sql = `
      SELECT source,
        COALESCE(AVG(bps), 0) AS "avgBps",
        COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY bps), 0) AS "medianBps",
        COALESCE(MIN(bps), 0) AS "minBps",
        COALESCE(MAX(bps), 0) AS "maxBps",
        COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY bps), 0) AS "p95Bps",
        COALESCE(STDDEV(bps), 0) AS "stdDevBps",
        COUNT(*)::int AS "orderCount"
      FROM (${unionSql}) combined
      GROUP BY source
    `;

    // Run through QueryBuilder raw query so TypeORM resolves the named parameters.
    const paramNames = Object.keys(params);
    let sqlWithPositional = sql;
    const positionalValues: unknown[] = [];
    for (const name of paramNames) {
      sqlWithPositional = sqlWithPositional.split(`:${name}`).join(`$${positionalValues.length + 1}`);
      positionalValues.push(params[name]);
    }

    const rows: Array<Record<string, unknown>> = await this.orderRepo.manager.query(
      sqlWithPositional,
      positionalValues
    );

    const liveRow = rows.find((r) => r.source === 'live');
    const backtestRow = rows.find((r) => r.source === 'backtest');

    const overallLive = mapSlippageStatsRow(liveRow);
    const overallBacktest =
      backtestRow && toInt(backtestRow.orderCount) > 0 ? mapSlippageStatsRow(backtestRow) : undefined;

    return { overallLive, overallBacktest };
  }

  private async getSlippageByAlgorithm(
    _filters: LiveTradeFiltersDto,
    dateRange: DateRange
  ): Promise<SlippageByAlgorithmDto[]> {
    const qb = this.orderRepo
      .createQueryBuilder('o')
      .leftJoin('o.algorithmActivation', 'aa')
      .leftJoin('aa.algorithm', 'a')
      .where('o.isAlgorithmicTrade = true')
      .andWhere('o.actualSlippageBps IS NOT NULL')
      .select('a.id', 'algorithmId')
      .addSelect('a.name', 'algorithmName')
      .addSelect('COALESCE(AVG(o.actualSlippageBps), 0)', 'avgBps')
      .addSelect('COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY o.actualSlippageBps), 0)', 'medianBps')
      .addSelect('COALESCE(MIN(o.actualSlippageBps), 0)', 'minBps')
      .addSelect('COALESCE(MAX(o.actualSlippageBps), 0)', 'maxBps')
      .addSelect('COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY o.actualSlippageBps), 0)', 'p95Bps')
      .addSelect('COALESCE(STDDEV(o.actualSlippageBps), 0)', 'stdDevBps')
      .addSelect('COUNT(*)', 'orderCount')
      .groupBy('a.id')
      .orderBy('AVG(o.actualSlippageBps)', 'ASC');

    if (dateRange.startDate) {
      qb.andWhere('o.createdAt >= :startDate', { startDate: dateRange.startDate });
    }
    if (dateRange.endDate) {
      qb.andWhere('o.createdAt <= :endDate', { endDate: dateRange.endDate });
    }

    const results = await qb.getRawMany();

    const algorithmIds = results.map((r) => r.algorithmId).filter(Boolean);
    const backtestSlippageMap = await this.getBatchAlgorithmBacktestSlippage(algorithmIds);

    return results.map((r) => {
      const backtestSlippage = backtestSlippageMap.get(r.algorithmId);
      return {
        algorithmId: r.algorithmId,
        algorithmName: r.algorithmName,
        liveSlippage: mapSlippageStatsRow(r),
        backtestSlippage,
        slippageDifferenceBps: new Decimal(r.avgBps || 0).minus(backtestSlippage?.avgBps || 0).toNumber()
      };
    });
  }

  private async getBatchAlgorithmBacktestSlippage(algorithmIds: string[]): Promise<Map<string, LiveSlippageStatsDto>> {
    const map = new Map<string, LiveSlippageStatsDto>();
    if (algorithmIds.length === 0) return map;

    const results = await this.fillRepo
      .createQueryBuilder('f')
      .leftJoin('f.backtest', 'b')
      .leftJoin('b.algorithm', 'a')
      .where('a.id IN (:...algorithmIds)', { algorithmIds })
      .select('a.id', 'algorithmId')
      .addSelect('COALESCE(AVG(f.slippageBps), 0)', 'avgBps')
      .addSelect('COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY f.slippageBps), 0)', 'medianBps')
      .addSelect('COALESCE(MIN(f.slippageBps), 0)', 'minBps')
      .addSelect('COALESCE(MAX(f.slippageBps), 0)', 'maxBps')
      .addSelect('COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY f.slippageBps), 0)', 'p95Bps')
      .addSelect('COALESCE(STDDEV(f.slippageBps), 0)', 'stdDevBps')
      .addSelect('COUNT(*)', 'orderCount')
      .groupBy('a.id')
      .getRawMany();

    for (const r of results) {
      if (toInt(r.orderCount) > 0) {
        map.set(r.algorithmId, mapSlippageStatsRow(r));
      }
    }

    return map;
  }

  private async getSlippageByTimeOfDay(
    filters: LiveTradeFiltersDto,
    dateRange: DateRange
  ): Promise<SlippageByTimeDto[]> {
    const qb = this.orderRepo
      .createQueryBuilder('o')
      .where('o.isAlgorithmicTrade = true')
      .andWhere('o.actualSlippageBps IS NOT NULL')
      .select('EXTRACT(HOUR FROM o.createdAt)', 'hour')
      .addSelect('COALESCE(AVG(o.actualSlippageBps), 0)', 'avgBps')
      .addSelect('COUNT(*)', 'orderCount')
      .groupBy('EXTRACT(HOUR FROM o.createdAt)')
      .orderBy('hour', 'ASC');

    if (filters.algorithmId) {
      qb.leftJoin('o.algorithmActivation', 'aa').andWhere('aa.algorithmId = :algorithmId', {
        algorithmId: filters.algorithmId
      });
    }
    if (dateRange.startDate) {
      qb.andWhere('o.createdAt >= :startDate', { startDate: dateRange.startDate });
    }
    if (dateRange.endDate) {
      qb.andWhere('o.createdAt <= :endDate', { endDate: dateRange.endDate });
    }

    const results = await qb.getRawMany();

    return results.map((r) => ({
      hour: toInt(r.hour),
      avgBps: toNumber(r.avgBps),
      orderCount: toInt(r.orderCount)
    }));
  }

  private async getSlippageByOrderSize(
    filters: LiveTradeFiltersDto,
    dateRange: DateRange
  ): Promise<SlippageBySizeDto[]> {
    const bucketDefs = [
      { bucket: '$0-$100', min: 0, max: 100 },
      { bucket: '$100-$500', min: 100, max: 500 },
      { bucket: '$500-$1000', min: 500, max: 1000 },
      { bucket: '$1000-$5000', min: 1000, max: 5000 },
      { bucket: '$5000-$10000', min: 5000, max: 10000 },
      { bucket: '$10000+', min: 10000, max: 999999999 }
    ];

    const qb = this.orderRepo
      .createQueryBuilder('o')
      .where('o.isAlgorithmicTrade = true')
      .andWhere('o.actualSlippageBps IS NOT NULL')
      .select(
        `CASE
          WHEN o.cost < 100 THEN 0
          WHEN o.cost < 500 THEN 1
          WHEN o.cost < 1000 THEN 2
          WHEN o.cost < 5000 THEN 3
          WHEN o.cost < 10000 THEN 4
          ELSE 5
        END`,
        'bucketIndex'
      )
      .addSelect('COALESCE(AVG(o.actualSlippageBps), 0)', 'avgBps')
      .addSelect('COUNT(*)', 'orderCount')
      .groupBy('bucketIndex')
      .orderBy('bucketIndex', 'ASC');

    if (filters.algorithmId) {
      qb.leftJoin('o.algorithmActivation', 'aa').andWhere('aa.algorithmId = :algorithmId', {
        algorithmId: filters.algorithmId
      });
    }
    if (dateRange.startDate) {
      qb.andWhere('o.createdAt >= :startDate', { startDate: dateRange.startDate });
    }
    if (dateRange.endDate) {
      qb.andWhere('o.createdAt <= :endDate', { endDate: dateRange.endDate });
    }

    const rawResults = await qb.getRawMany();
    const resultMap = new Map<number, { avgBps: number; orderCount: number }>();
    for (const r of rawResults) {
      resultMap.set(toInt(r.bucketIndex), {
        avgBps: toNumber(r.avgBps),
        orderCount: toInt(r.orderCount)
      });
    }

    return bucketDefs.map((def, index) => ({
      bucket: def.bucket,
      minSize: def.min,
      maxSize: def.max,
      avgBps: resultMap.get(index)?.avgBps || 0,
      orderCount: resultMap.get(index)?.orderCount || 0
    }));
  }

  private async getSlippageBySymbol(
    filters: LiveTradeFiltersDto,
    dateRange: DateRange
  ): Promise<SlippageBySymbolDto[]> {
    const qb = this.orderRepo
      .createQueryBuilder('o')
      .where('o.isAlgorithmicTrade = true')
      .andWhere('o.actualSlippageBps IS NOT NULL')
      .select('o.symbol', 'symbol')
      .addSelect('COALESCE(AVG(o.actualSlippageBps), 0)', 'avgBps')
      .addSelect('COUNT(*)', 'orderCount')
      .addSelect('COALESCE(SUM(o.cost), 0)', 'totalVolume')
      .groupBy('o.symbol')
      .orderBy('COUNT(*)', 'DESC')
      .limit(10);

    if (filters.algorithmId) {
      qb.leftJoin('o.algorithmActivation', 'aa').andWhere('aa.algorithmId = :algorithmId', {
        algorithmId: filters.algorithmId
      });
    }
    if (dateRange.startDate) {
      qb.andWhere('o.createdAt >= :startDate', { startDate: dateRange.startDate });
    }
    if (dateRange.endDate) {
      qb.andWhere('o.createdAt <= :endDate', { endDate: dateRange.endDate });
    }

    const results = await qb.getRawMany();

    return results.map((r) => ({
      symbol: r.symbol,
      avgBps: toNumber(r.avgBps),
      orderCount: toInt(r.orderCount),
      totalVolume: toNumber(r.totalVolume)
    }));
  }
}
