import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { AlertSeverity } from './dto/alerts.dto';
import { LiveTradeFiltersDto } from './dto/filters.dto';
import {
  AlertsSummaryDto,
  LiveTradeOverviewDto,
  LiveTradeSummaryDto,
  RecentOrderDto,
  SignalConversionPanelDto,
  TopPerformingAlgorithmDto
} from './dto/overview.dto';
import { LiveTradeAlertsService } from './live-trade-alerts.service';
import { DateRange, getDateRange, latestPerformanceCondition, toInt, toNumber } from './live-trade-monitoring.utils';
import { AlgorithmConversionRow, LiveTradeSignalConversionService } from './live-trade-signal-conversion.service';

import { AlgorithmActivation } from '../../algorithm/algorithm-activation.entity';
import { Algorithm } from '../../algorithm/algorithm.entity';
import { Order } from '../../order/order.entity';

@Injectable()
export class LiveTradeOverviewService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(AlgorithmActivation)
    private readonly activationRepo: Repository<AlgorithmActivation>,
    @InjectRepository(Algorithm)
    private readonly algorithmRepo: Repository<Algorithm>,
    private readonly alertsService: LiveTradeAlertsService,
    private readonly signalConversionService: LiveTradeSignalConversionService
  ) {}

  async getOverview(filters: LiveTradeFiltersDto): Promise<LiveTradeOverviewDto> {
    const dateRange = getDateRange(filters);

    const [summary, topAlgorithms, recentOrders, alertsSummary, signalConversionFull] = await Promise.all([
      this.getSummaryMetrics(filters, dateRange),
      this.getTopAlgorithms(filters, dateRange),
      this.getRecentOrders(10),
      this.getAlertsSummary(filters),
      this.signalConversionService.getConversionMetrics(filters, dateRange)
    ]);

    summary.signalsTotal = signalConversionFull.totalSignals;
    summary.signalsPlaced = signalConversionFull.placedSignals;
    summary.signalConversionPct = signalConversionFull.conversionPct;

    this.applyPerAlgorithmConversion(topAlgorithms, signalConversionFull.perAlgorithm);

    const signalConversion: SignalConversionPanelDto = {
      totalSignals: signalConversionFull.totalSignals,
      placedSignals: signalConversionFull.placedSignals,
      rejectedSignals: signalConversionFull.rejectedSignals,
      conversionPct: signalConversionFull.conversionPct,
      topRejectionReasons: signalConversionFull.topRejectionReasons
    };

    return { summary, topAlgorithms, recentOrders, alertsSummary, signalConversion };
  }

  private async getSummaryMetrics(filters: LiveTradeFiltersDto, dateRange: DateRange): Promise<LiveTradeSummaryDto> {
    const [activeAlgorithms, orderStats, activeUsers] = await Promise.all([
      this.activationRepo.count({ where: { isActive: true } }),
      this.getOrderStats(filters, dateRange),
      this.activationRepo
        .createQueryBuilder('aa')
        .select('COUNT(DISTINCT aa.userId)', 'count')
        .where('aa.isActive = true')
        .getRawOne()
    ]);

    return {
      activeAlgorithms,
      totalOrders: orderStats.totalOrders,
      orders24h: orderStats.orders24h,
      orders7d: orderStats.orders7d,
      totalVolume: orderStats.totalVolume,
      totalPnL: orderStats.totalPnL,
      avgSlippageBps: orderStats.avgSlippageBps,
      activeUsers: toInt(activeUsers?.count),
      signalsTotal: 0,
      signalsPlaced: 0,
      signalConversionPct: 0
    };
  }

  private applyPerAlgorithmConversion(
    topAlgorithms: TopPerformingAlgorithmDto[],
    perAlgorithm: AlgorithmConversionRow[]
  ): void {
    const conversionMap = new Map(perAlgorithm.map((row) => [row.algorithmId, row.conversionPct]));
    for (const algorithm of topAlgorithms) {
      const value = conversionMap.get(algorithm.algorithmId);
      if (value !== undefined) {
        algorithm.signalConversionPct = value;
      }
    }
  }

  private async getOrderStats(
    filters: LiveTradeFiltersDto,
    dateRange: DateRange
  ): Promise<{
    totalOrders: number;
    orders24h: number;
    orders7d: number;
    totalVolume: number;
    totalPnL: number;
    avgSlippageBps: number;
  }> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const qb = this.orderRepo.createQueryBuilder('o').where('o.isAlgorithmicTrade = true');

    if (filters.algorithmId) {
      qb.leftJoin('o.algorithmActivation', 'aa').andWhere('aa.algorithmId = :algorithmId', {
        algorithmId: filters.algorithmId
      });
    }
    if (filters.userId) {
      qb.andWhere('o.user.id = :userId', { userId: filters.userId });
    }
    if (dateRange.startDate) {
      qb.andWhere('o.createdAt >= :startDate', { startDate: dateRange.startDate });
    }
    if (dateRange.endDate) {
      qb.andWhere('o.createdAt <= :endDate', { endDate: dateRange.endDate });
    }

    const result = await qb
      .select('COUNT(*)', 'totalOrders')
      .addSelect('COALESCE(SUM(o.cost), 0)', 'totalVolume')
      .addSelect('COALESCE(SUM(o.gainLoss), 0)', 'totalPnL')
      .addSelect('COALESCE(AVG(o.actualSlippageBps), 0)', 'avgSlippageBps')
      .addSelect(`COUNT(*) FILTER (WHERE o."createdAt" >= :oneDayAgo)`, 'orders24h')
      .addSelect(`COUNT(*) FILTER (WHERE o."createdAt" >= :sevenDaysAgo)`, 'orders7d')
      .setParameter('oneDayAgo', oneDayAgo)
      .setParameter('sevenDaysAgo', sevenDaysAgo)
      .getRawOne();

    return {
      totalOrders: toInt(result?.totalOrders),
      orders24h: toInt(result?.orders24h),
      orders7d: toInt(result?.orders7d),
      totalVolume: toNumber(result?.totalVolume),
      totalPnL: toNumber(result?.totalPnL),
      avgSlippageBps: toNumber(result?.avgSlippageBps)
    };
  }

  private async getTopAlgorithms(
    filters: LiveTradeFiltersDto,
    dateRange: DateRange
  ): Promise<TopPerformingAlgorithmDto[]> {
    // Apply date range inside the Order join ON clause so algorithms with zero
    // in-range orders still surface (LEFT JOIN semantics).
    let orderJoinCondition = 'o.algorithmActivationId = aa.id AND o.isAlgorithmicTrade = true';
    const orderJoinParams: Record<string, unknown> = {};
    if (dateRange.startDate) {
      orderJoinCondition += ' AND o."createdAt" >= :topStartDate';
      orderJoinParams.topStartDate = dateRange.startDate;
    }
    if (dateRange.endDate) {
      orderJoinCondition += ' AND o."createdAt" <= :topEndDate';
      orderJoinParams.topEndDate = dateRange.endDate;
    }

    const qb = this.algorithmRepo
      .createQueryBuilder('a')
      .leftJoin('algorithm_activations', 'aa', 'aa.algorithmId = a.id')
      .leftJoin(
        'algorithm_performances',
        'ap',
        `ap.algorithmActivationId = aa.id AND ${latestPerformanceCondition('ap')}`
      )
      .leftJoin(Order, 'o', orderJoinCondition, orderJoinParams);

    if (filters.algorithmId) {
      qb.andWhere('a.id = :algorithmId', { algorithmId: filters.algorithmId });
    }
    if (filters.userId) {
      qb.andWhere('aa.userId = :userId', { userId: filters.userId });
    }

    const result = await qb
      .select('a.id', 'algorithmId')
      .addSelect('a.name', 'algorithmName')
      .addSelect('COUNT(DISTINCT CASE WHEN aa."isActive" = true THEN aa.id END)', 'activeActivations')
      .addSelect('COUNT(o.id)', 'totalOrders')
      .addSelect('COALESCE(AVG(ap.roi), 0)', 'avgRoi')
      .addSelect('COALESCE(AVG(ap.winRate), 0)', 'avgWinRate')
      .addSelect('COALESCE(AVG(o.actualSlippageBps), 0)', 'avgSlippageBps')
      .groupBy('a.id')
      .having('COUNT(DISTINCT CASE WHEN aa."isActive" = true THEN aa.id END) > 0')
      .orderBy('AVG(ap.roi)', 'DESC', 'NULLS LAST')
      .limit(5)
      .getRawMany();

    return result.map((r) => ({
      algorithmId: r.algorithmId,
      algorithmName: r.algorithmName,
      activeActivations: toInt(r.activeActivations),
      totalOrders: toInt(r.totalOrders),
      avgRoi: toNumber(r.avgRoi),
      avgWinRate: toNumber(r.avgWinRate),
      avgSlippageBps: toNumber(r.avgSlippageBps)
    }));
  }

  private async getRecentOrders(limit: number): Promise<RecentOrderDto[]> {
    const orders = await this.orderRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.user', 'u')
      .leftJoinAndSelect('o.algorithmActivation', 'aa')
      .leftJoin('aa.algorithm', 'a')
      .addSelect(['a.name'])
      .where('o.isAlgorithmicTrade = true')
      .orderBy('o.createdAt', 'DESC')
      .limit(limit)
      .getMany();

    return orders.map((o) => ({
      id: o.id,
      symbol: o.symbol,
      side: o.side,
      type: o.type,
      cost: o.cost || 0,
      actualSlippageBps: o.actualSlippageBps,
      algorithmName: o.algorithmActivation?.algorithm?.name || 'Unknown',
      userEmail: o.user?.email || 'Unknown',
      createdAt: o.createdAt.toISOString()
    }));
  }

  private async getAlertsSummary(filters: LiveTradeFiltersDto): Promise<AlertsSummaryDto> {
    const { activations, perfMap, backtestMap } = await this.alertsService.fetchAlertBaseData(filters, false);

    let critical = 0;
    let warning = 0;
    let info = 0;

    for (const activation of activations) {
      const performance = perfMap.get(activation.id) || null;
      const backtest = backtestMap.get(activation.algorithmId) || null;
      const activationAlerts = this.alertsService.generateAlertsForActivation(activation, performance, backtest);

      for (const alert of activationAlerts) {
        switch (alert.severity) {
          case AlertSeverity.CRITICAL:
            critical++;
            break;
          case AlertSeverity.WARNING:
            warning++;
            break;
          case AlertSeverity.INFO:
            info++;
            break;
        }
      }
    }

    return { critical, warning, info };
  }
}
