import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Decimal } from 'decimal.js';
import { Between, In, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';

import {
  BacktestListItemDto,
  BacktestListQueryDto,
  BacktestSortField,
  ExportFormat,
  PaginatedBacktestListDto,
  SortOrder
} from './dto/backtest-listing.dto';
import { OptimizationAnalyticsDto, OptimizationFiltersDto } from './dto/optimization-analytics.dto';
import {
  AverageMetricsDto,
  BacktestFiltersDto,
  BacktestOverviewDto,
  RecentActivityDto,
  TopAlgorithmDto
} from './dto/overview.dto';
import {
  PaperTradingFiltersDto,
  PaperTradingMonitoringDto,
  PipelineStageCountsDto
} from './dto/paper-trading-analytics.dto';
import {
  ConfidenceBucketDto,
  SignalAnalyticsDto,
  SignalDirectionMetricsDto,
  SignalInstrumentMetricsDto,
  SignalOverallStatsDto,
  SignalTypeMetricsDto
} from './dto/signal-analytics.dto';
import {
  BacktestSlippageStatsDto,
  InstrumentTradeMetricsDto,
  ProfitabilityStatsDto,
  TradeAnalyticsDto,
  TradeDurationStatsDto,
  TradeSummaryDto
} from './dto/trade-analytics.dto';

import { OptimizationResult } from '../../optimization/entities/optimization-result.entity';
import { OptimizationRun, OptimizationStatus } from '../../optimization/entities/optimization-run.entity';
import {
  Backtest,
  BacktestSignal,
  BacktestStatus,
  BacktestTrade,
  BacktestType,
  SignalDirection,
  SignalType,
  SimulatedOrderFill,
  TradeType
} from '../../order/backtest/backtest.entity';
import {
  PaperTradingOrder,
  PaperTradingOrderSide
} from '../../order/paper-trading/entities/paper-trading-order.entity';
import {
  PaperTradingSession,
  PaperTradingStatus
} from '../../order/paper-trading/entities/paper-trading-session.entity';
import {
  PaperTradingSignal,
  PaperTradingSignalDirection,
  PaperTradingSignalType
} from '../../order/paper-trading/entities/paper-trading-signal.entity';

/** Maximum number of records to export to prevent DoS */
const MAX_EXPORT_LIMIT = 10000;

/** Whitelist mapping for safe sort column access (prevents SQL injection) */
const SORT_COLUMN_MAP: Record<BacktestSortField, string> = {
  [BacktestSortField.CREATED_AT]: 'b.createdAt',
  [BacktestSortField.UPDATED_AT]: 'b.updatedAt',
  [BacktestSortField.SHARPE_RATIO]: 'b.sharpeRatio',
  [BacktestSortField.TOTAL_RETURN]: 'b.totalReturn',
  [BacktestSortField.MAX_DRAWDOWN]: 'b.maxDrawdown',
  [BacktestSortField.WIN_RATE]: 'b.winRate',
  [BacktestSortField.TOTAL_TRADES]: 'b.totalTrades',
  [BacktestSortField.NAME]: 'b.name',
  [BacktestSortField.STATUS]: 'b.status'
};

/**
 * Service for backtest monitoring analytics
 *
 * Provides aggregated metrics and analytics for admin dashboard.
 */
@Injectable()
export class BacktestMonitoringService {
  private readonly logger = new Logger(BacktestMonitoringService.name);

  constructor(
    @InjectRepository(Backtest)
    private readonly backtestRepo: Repository<Backtest>,
    @InjectRepository(BacktestTrade)
    private readonly tradeRepo: Repository<BacktestTrade>,
    @InjectRepository(BacktestSignal)
    private readonly signalRepo: Repository<BacktestSignal>,
    @InjectRepository(SimulatedOrderFill)
    private readonly fillRepo: Repository<SimulatedOrderFill>,
    @InjectRepository(OptimizationRun)
    private readonly optimizationRunRepo: Repository<OptimizationRun>,
    @InjectRepository(OptimizationResult)
    private readonly optimizationResultRepo: Repository<OptimizationResult>,
    @InjectRepository(PaperTradingSession)
    private readonly paperSessionRepo: Repository<PaperTradingSession>,
    @InjectRepository(PaperTradingOrder)
    private readonly paperOrderRepo: Repository<PaperTradingOrder>,
    @InjectRepository(PaperTradingSignal)
    private readonly paperSignalRepo: Repository<PaperTradingSignal>
  ) {}

  /**
   * Get overview metrics for the backtest monitoring dashboard
   */
  async getOverview(filters: BacktestFiltersDto): Promise<BacktestOverviewDto> {
    const dateRange = this.getDateRange(filters);

    const [statusCounts, typeDistribution, averageMetrics, recentActivity, topAlgorithms, totalBacktests] =
      await Promise.all([
        this.getStatusCounts(filters, dateRange),
        this.getTypeDistribution(filters, dateRange),
        this.getAverageMetrics(filters, dateRange),
        this.getRecentActivity(),
        this.getTopAlgorithms(filters, dateRange),
        this.getTotalBacktests(filters, dateRange)
      ]);

    return {
      statusCounts,
      typeDistribution,
      averageMetrics,
      recentActivity,
      topAlgorithms,
      totalBacktests
    };
  }

  /**
   * Get paginated list of backtests
   */
  async getBacktests(query: BacktestListQueryDto): Promise<PaginatedBacktestListDto> {
    const { page = 1, limit = 20, sortBy = BacktestSortField.CREATED_AT, sortOrder = SortOrder.DESC, search } = query;

    const dateRange = this.getDateRange(query);
    const skip = (page - 1) * limit;

    const qb = this.backtestRepo
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.algorithm', 'a')
      .leftJoinAndSelect('b.user', 'u');

    // Apply filters
    this.applyBacktestFilters(qb, query, dateRange);

    // Apply search
    if (search) {
      qb.andWhere('b.name ILIKE :search', { search: `%${search}%` });
    }

    // Get total count
    const total = await qb.getCount();

    // Apply sorting and pagination (using whitelist to prevent SQL injection)
    const sortColumn = SORT_COLUMN_MAP[sortBy] || SORT_COLUMN_MAP[BacktestSortField.CREATED_AT];
    qb.orderBy(sortColumn, sortOrder).skip(skip).take(limit);

    const backtests = await qb.getMany();

    const data: BacktestListItemDto[] = backtests.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      status: b.status,
      type: b.type,
      algorithmId: b.algorithm?.id || '',
      algorithmName: b.algorithm?.name || 'Unknown',
      userId: b.user?.id || '',
      userEmail: b.user?.email,
      initialCapital: b.initialCapital,
      finalValue: b.finalValue,
      totalReturn: b.totalReturn,
      sharpeRatio: b.sharpeRatio,
      maxDrawdown: b.maxDrawdown,
      totalTrades: b.totalTrades,
      winRate: b.winRate,
      startDate: b.startDate.toISOString(),
      endDate: b.endDate.toISOString(),
      createdAt: b.createdAt.toISOString(),
      completedAt: b.completedAt?.toISOString(),
      errorMessage: b.errorMessage,
      progressPercent: this.calculateProgress(b)
    }));

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1
    };
  }

  /**
   * Get signal analytics
   */
  async getSignalAnalytics(filters: BacktestFiltersDto): Promise<SignalAnalyticsDto> {
    const dateRange = this.getDateRange(filters);
    const backtestIds = await this.getFilteredBacktestIds(filters, dateRange);

    if (backtestIds.length === 0) {
      return this.getEmptySignalAnalytics();
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

  /**
   * Get trade analytics
   */
  async getTradeAnalytics(filters: BacktestFiltersDto): Promise<TradeAnalyticsDto> {
    const dateRange = this.getDateRange(filters);
    const backtestIds = await this.getFilteredBacktestIds(filters, dateRange);

    if (backtestIds.length === 0) {
      return this.getEmptyTradeAnalytics();
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

  /**
   * Export backtests as CSV or JSON
   *
   * Note: Limited to MAX_EXPORT_LIMIT records to prevent DoS
   */
  async exportBacktests(filters: BacktestFiltersDto, format: ExportFormat): Promise<Buffer | object[]> {
    const dateRange = this.getDateRange(filters);

    const qb = this.backtestRepo.createQueryBuilder('b').leftJoinAndSelect('b.algorithm', 'a');

    this.applyBacktestFilters(qb, filters, dateRange);
    qb.orderBy('b.createdAt', 'DESC').take(MAX_EXPORT_LIMIT);

    const backtests = await qb.getMany();

    if (backtests.length === MAX_EXPORT_LIMIT) {
      this.logger.warn(`Export truncated to ${MAX_EXPORT_LIMIT} records`);
    }

    const data = backtests.map((b) => ({
      id: b.id,
      name: b.name,
      status: b.status,
      type: b.type,
      algorithmName: b.algorithm?.name || '',
      initialCapital: b.initialCapital,
      finalValue: b.finalValue,
      totalReturn: b.totalReturn,
      sharpeRatio: b.sharpeRatio,
      maxDrawdown: b.maxDrawdown,
      totalTrades: b.totalTrades,
      winRate: b.winRate,
      startDate: b.startDate.toISOString(),
      endDate: b.endDate.toISOString(),
      createdAt: b.createdAt.toISOString(),
      completedAt: b.completedAt?.toISOString() || ''
    }));

    if (format === ExportFormat.JSON) {
      return data;
    }

    return this.convertToCsv(data);
  }

  /**
   * Export signals for a specific backtest
   */
  async exportSignals(backtestId: string, format: ExportFormat): Promise<Buffer | object[]> {
    // Verify backtest exists
    const backtestExists = await this.backtestRepo.existsBy({ id: backtestId });
    if (!backtestExists) {
      throw new NotFoundException(`Backtest with ID '${backtestId}' not found`);
    }

    const signals = await this.signalRepo.find({
      where: { backtest: { id: backtestId } },
      order: { timestamp: 'ASC' }
    });

    const data = signals.map((s) => ({
      id: s.id,
      timestamp: s.timestamp.toISOString(),
      signalType: s.signalType,
      instrument: s.instrument,
      direction: s.direction,
      quantity: s.quantity,
      price: s.price,
      confidence: s.confidence,
      reason: s.reason
    }));

    if (format === ExportFormat.JSON) {
      return data;
    }

    return this.convertToCsv(data);
  }

  /**
   * Export trades for a specific backtest
   */
  async exportTrades(backtestId: string, format: ExportFormat): Promise<Buffer | object[]> {
    // Verify backtest exists
    const backtestExists = await this.backtestRepo.existsBy({ id: backtestId });
    if (!backtestExists) {
      throw new NotFoundException(`Backtest with ID '${backtestId}' not found`);
    }

    const trades = await this.tradeRepo.find({
      where: { backtest: { id: backtestId } },
      relations: ['baseCoin', 'quoteCoin'],
      order: { executedAt: 'ASC' }
    });

    const data = trades.map((t) => ({
      id: t.id,
      type: t.type,
      status: t.status,
      quantity: t.quantity,
      price: t.price,
      totalValue: t.totalValue,
      fee: t.fee,
      realizedPnL: t.realizedPnL,
      realizedPnLPercent: t.realizedPnLPercent,
      executedAt: t.executedAt.toISOString(),
      baseCoin: t.baseCoin?.symbol || '',
      quoteCoin: t.quoteCoin?.symbol || '',
      signal: t.signal
    }));

    if (format === ExportFormat.JSON) {
      return data;
    }

    return this.convertToCsv(data);
  }

  // ===========================================================================
  // Optimization Analytics
  // ===========================================================================

  /**
   * Get optimization analytics for the admin dashboard
   */
  async getOptimizationAnalytics(filters: OptimizationFiltersDto): Promise<OptimizationAnalyticsDto> {
    const dateRange = this.getOptDateRange(filters);

    const [statusCounts, totalRuns, recentActivity, avgMetrics, topStrategies, resultSummary] = await Promise.all([
      this.getOptStatusCounts(filters, dateRange),
      this.getOptTotalRuns(filters, dateRange),
      this.getOptRecentActivity(),
      this.getOptAvgMetrics(filters, dateRange),
      this.getOptTopStrategies(filters, dateRange),
      this.getOptResultSummary(filters, dateRange)
    ]);

    return {
      statusCounts,
      totalRuns,
      recentActivity,
      avgImprovement: avgMetrics.avgImprovement,
      avgBestScore: avgMetrics.avgBestScore,
      avgCombinationsTested: avgMetrics.avgCombinationsTested,
      topStrategies,
      resultSummary
    };
  }

  // ===========================================================================
  // Paper Trading Monitoring
  // ===========================================================================

  /**
   * Get paper trading monitoring analytics for the admin dashboard
   */
  async getPaperTradingMonitoring(filters: PaperTradingFiltersDto): Promise<PaperTradingMonitoringDto> {
    const dateRange = this.getPtDateRange(filters);

    const [statusCounts, totalSessions, recentActivity, avgMetrics, topAlgorithms, orderAnalytics, signalAnalytics] =
      await Promise.all([
        this.getPtStatusCounts(filters, dateRange),
        this.getPtTotalSessions(filters, dateRange),
        this.getPtRecentActivity(),
        this.getPtAvgMetrics(filters, dateRange),
        this.getPtTopAlgorithms(filters, dateRange),
        this.getPtOrderAnalytics(filters, dateRange),
        this.getPtSignalAnalytics(filters, dateRange)
      ]);

    return {
      statusCounts,
      totalSessions,
      recentActivity,
      avgMetrics,
      topAlgorithms,
      orderAnalytics,
      signalAnalytics
    };
  }

  // ===========================================================================
  // Pipeline Stage Counts
  // ===========================================================================

  /**
   * Get counts of records across all pipeline stages
   */
  async getPipelineStageCounts(): Promise<PipelineStageCountsDto> {
    const [optimizationRuns, historicalBacktests, liveReplayBacktests, paperTradingSessions] = await Promise.all([
      this.optimizationRunRepo.count(),
      this.backtestRepo.count({ where: { type: BacktestType.HISTORICAL } }),
      this.backtestRepo.count({ where: { type: BacktestType.LIVE_REPLAY } }),
      this.paperSessionRepo.count()
    ]);

    return { optimizationRuns, historicalBacktests, liveReplayBacktests, paperTradingSessions };
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  private getDateRange(filters: BacktestFiltersDto): { start: Date; end: Date } | null {
    if (!filters.startDate && !filters.endDate) {
      return null;
    }

    return {
      start: filters.startDate ? new Date(filters.startDate) : new Date(0),
      end: filters.endDate ? new Date(filters.endDate) : new Date()
    };
  }

  private applyBacktestFilters(
    qb: SelectQueryBuilder<Backtest>,
    filters: BacktestFiltersDto,
    dateRange: { start: Date; end: Date } | null
  ): void {
    if (dateRange) {
      qb.andWhere('b.createdAt BETWEEN :start AND :end', dateRange);
    }

    if (filters.algorithmId) {
      qb.andWhere('b.algorithm.id = :algorithmId', { algorithmId: filters.algorithmId });
    }

    if (filters.status) {
      qb.andWhere('b.status = :status', { status: filters.status });
    }

    if (filters.type) {
      qb.andWhere('b.type = :type', { type: filters.type });
    }
  }

  private async getFilteredBacktestIds(
    filters: BacktestFiltersDto,
    dateRange: { start: Date; end: Date } | null
  ): Promise<string[]> {
    const qb = this.backtestRepo.createQueryBuilder('b').select('b.id');

    this.applyBacktestFilters(qb, filters, dateRange);

    const results = await qb.getRawMany();
    return results.map((r) => r.b_id);
  }

  private async getStatusCounts(
    filters: BacktestFiltersDto,
    dateRange: { start: Date; end: Date } | null
  ): Promise<Record<BacktestStatus, number>> {
    const qb = this.backtestRepo
      .createQueryBuilder('b')
      .select('b.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('b.status');

    if (dateRange) {
      qb.where('b.createdAt BETWEEN :start AND :end', dateRange);
    }

    if (filters.algorithmId) {
      qb.andWhere('b.algorithm.id = :algorithmId', { algorithmId: filters.algorithmId });
    }

    if (filters.type) {
      qb.andWhere('b.type = :type', { type: filters.type });
    }

    const results = await qb.getRawMany();

    // Initialize all statuses with 0
    const counts = Object.values(BacktestStatus).reduce(
      (acc, status) => {
        acc[status] = 0;
        return acc;
      },
      {} as Record<BacktestStatus, number>
    );

    // Fill in actual counts
    for (const row of results) {
      counts[row.status as BacktestStatus] = parseInt(row.count, 10);
    }

    return counts;
  }

  private async getTypeDistribution(
    filters: BacktestFiltersDto,
    dateRange: { start: Date; end: Date } | null
  ): Promise<Record<BacktestType, number>> {
    const qb = this.backtestRepo
      .createQueryBuilder('b')
      .select('b.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .groupBy('b.type');

    if (dateRange) {
      qb.where('b.createdAt BETWEEN :start AND :end', dateRange);
    }

    if (filters.algorithmId) {
      qb.andWhere('b.algorithm.id = :algorithmId', { algorithmId: filters.algorithmId });
    }

    if (filters.status) {
      qb.andWhere('b.status = :status', { status: filters.status });
    }

    const results = await qb.getRawMany();

    // Initialize all types with 0
    const distribution = Object.values(BacktestType).reduce(
      (acc, type) => {
        acc[type] = 0;
        return acc;
      },
      {} as Record<BacktestType, number>
    );

    // Fill in actual counts
    for (const row of results) {
      distribution[row.type as BacktestType] = parseInt(row.count, 10);
    }

    return distribution;
  }

  private async getAverageMetrics(
    filters: BacktestFiltersDto,
    dateRange: { start: Date; end: Date } | null
  ): Promise<AverageMetricsDto> {
    const qb = this.backtestRepo
      .createQueryBuilder('b')
      .select('AVG(b.sharpeRatio)', 'avgSharpe')
      .addSelect('AVG(b.totalReturn)', 'avgReturn')
      .addSelect('AVG(b.maxDrawdown)', 'avgDrawdown')
      .addSelect('AVG(b.winRate)', 'avgWinRate')
      .where('b.status = :completed', { completed: BacktestStatus.COMPLETED });

    if (dateRange) {
      qb.andWhere('b.createdAt BETWEEN :start AND :end', dateRange);
    }

    if (filters.algorithmId) {
      qb.andWhere('b.algorithm.id = :algorithmId', { algorithmId: filters.algorithmId });
    }

    if (filters.type) {
      qb.andWhere('b.type = :type', { type: filters.type });
    }

    const result = await qb.getRawOne();

    return {
      sharpeRatio: parseFloat(result?.avgSharpe) || 0,
      totalReturn: parseFloat(result?.avgReturn) || 0,
      maxDrawdown: parseFloat(result?.avgDrawdown) || 0,
      winRate: parseFloat(result?.avgWinRate) || 0
    };
  }

  private async getRecentActivity(): Promise<RecentActivityDto> {
    return this.countRecentActivity(this.backtestRepo);
  }

  private async getTopAlgorithms(
    filters: BacktestFiltersDto,
    dateRange: { start: Date; end: Date } | null
  ): Promise<TopAlgorithmDto[]> {
    const qb = this.backtestRepo
      .createQueryBuilder('b')
      .innerJoin('b.algorithm', 'a')
      .select('a.id', 'id')
      .addSelect('a.name', 'name')
      .addSelect('AVG(b.sharpeRatio)', 'avgSharpe')
      .addSelect('AVG(b.totalReturn)', 'avgReturn')
      .addSelect('COUNT(*)', 'backtestCount')
      .where('b.status = :completed', { completed: BacktestStatus.COMPLETED })
      .andWhere('b.sharpeRatio IS NOT NULL')
      .groupBy('a.id')
      .addGroupBy('a.name')
      .having('COUNT(*) >= 3')
      .orderBy('AVG(b.sharpeRatio)', 'DESC')
      .limit(10);

    if (dateRange) {
      qb.andWhere('b.createdAt BETWEEN :start AND :end', dateRange);
    }

    if (filters.type) {
      qb.andWhere('b.type = :type', { type: filters.type });
    }

    const results = await qb.getRawMany();

    return results.map((r) => ({
      id: r.id,
      name: r.name,
      avgSharpe: parseFloat(r.avgSharpe) || 0,
      backtestCount: parseInt(r.backtestCount, 10),
      avgReturn: parseFloat(r.avgReturn) || 0
    }));
  }

  private async getTotalBacktests(
    filters: BacktestFiltersDto,
    dateRange: { start: Date; end: Date } | null
  ): Promise<number> {
    const qb = this.backtestRepo.createQueryBuilder('b');
    this.applyBacktestFilters(qb, filters, dateRange);
    return qb.getCount();
  }

  private calculateProgress(backtest: Backtest): number {
    if (backtest.status === BacktestStatus.COMPLETED) return 100;
    if (backtest.status === BacktestStatus.FAILED || backtest.status === BacktestStatus.CANCELLED) return 0;
    if (backtest.totalTimestampCount === 0) return 0;
    return Math.round((backtest.processedTimestampCount / backtest.totalTimestampCount) * 100);
  }

  // ---------------------------------------------------------------------------
  // Signal Analytics Helpers
  // ---------------------------------------------------------------------------

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
      .select('s.instrument', 'instrument')
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

    return results.map((r) => ({
      instrument: r.instrument,
      count: parseInt(r.count, 10) || 0,
      successRate: parseFloat(r.successRate) || 0,
      avgReturn: parseFloat(r.avgReturn) || 0
    }));
  }

  // ---------------------------------------------------------------------------
  // Trade Analytics Helpers
  // ---------------------------------------------------------------------------

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
    const profitFactor =
      grossLoss > 0 ? new Decimal(grossProfit).dividedBy(grossLoss).toNumber() : grossProfit > 0 ? Infinity : 0;

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
      profitFactor: isFinite(profitFactor) ? profitFactor : 0,
      largestWin: parseFloat(result?.largestWin) || 0,
      largestLoss: parseFloat(result?.largestLoss) || 0,
      expectancy,
      avgWin,
      avgLoss: -(parseFloat(result?.avgLoss) || 0),
      totalRealizedPnL: parseFloat(result?.totalRealizedPnL) || 0
    };
  }

  private async getTradeDurationStats(backtestIds: string[]): Promise<TradeDurationStatsDto> {
    // Use batched query to avoid loading all trades into memory
    const BATCH_SIZE = 1000;
    const holdTimes: number[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const batch = await this.tradeRepo.find({
        where: {
          backtest: { id: In(backtestIds) },
          type: TradeType.SELL
        },
        select: ['id', 'metadata'],
        skip: offset,
        take: BATCH_SIZE
      });

      for (const trade of batch) {
        if (trade.metadata?.holdTimeMs) {
          holdTimes.push(trade.metadata.holdTimeMs);
        }
      }

      hasMore = batch.length === BATCH_SIZE;
      offset += BATCH_SIZE;
    }

    if (holdTimes.length === 0) {
      return {
        avgHoldTimeMs: 0,
        avgHoldTime: 'N/A',
        medianHoldTimeMs: 0,
        medianHoldTime: 'N/A',
        maxHoldTimeMs: 0,
        maxHoldTime: 'N/A',
        minHoldTimeMs: 0,
        minHoldTime: 'N/A'
      };
    }

    holdTimes.sort((a, b) => a - b);
    const avgHoldTimeMs = holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length;
    const medianHoldTimeMs = holdTimes[Math.floor(holdTimes.length / 2)];
    const maxHoldTimeMs = holdTimes[holdTimes.length - 1];
    const minHoldTimeMs = holdTimes[0];

    return {
      avgHoldTimeMs,
      avgHoldTime: this.formatDuration(avgHoldTimeMs),
      medianHoldTimeMs,
      medianHoldTime: this.formatDuration(medianHoldTimeMs),
      maxHoldTimeMs,
      maxHoldTime: this.formatDuration(maxHoldTimeMs),
      minHoldTimeMs,
      minHoldTime: this.formatDuration(minHoldTimeMs)
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

  // ---------------------------------------------------------------------------
  // Empty Response Helpers
  // ---------------------------------------------------------------------------

  private getEmptySignalAnalytics(): SignalAnalyticsDto {
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

  private getEmptyTradeAnalytics(): TradeAnalyticsDto {
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

  // ---------------------------------------------------------------------------
  // Utility Helpers
  // ---------------------------------------------------------------------------

  private async countRecentActivity(repo: Repository<ObjectLiteral>): Promise<RecentActivityDto> {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [last24h, last7d, last30d] = await Promise.all([
      repo.count({ where: { createdAt: Between(yesterday, now) } }),
      repo.count({ where: { createdAt: Between(lastWeek, now) } }),
      repo.count({ where: { createdAt: Between(lastMonth, now) } })
    ]);

    return { last24h, last7d, last30d };
  }

  private formatDuration(ms: number): string {
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

  private convertToCsv(data: object[]): Buffer {
    if (data.length === 0) {
      return Buffer.from('');
    }

    const headers = Object.keys(data[0]);
    const csvRows = [headers.join(',')];

    for (const row of data) {
      const values = headers.map((header) => {
        const val = (row as Record<string, unknown>)[header];
        if (val === null || val === undefined) return '';
        if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return String(val);
      });
      csvRows.push(values.join(','));
    }

    return Buffer.from(csvRows.join('\n'), 'utf-8');
  }

  // ---------------------------------------------------------------------------
  // Optimization Analytics Helpers
  // ---------------------------------------------------------------------------

  private getOptDateRange(filters: OptimizationFiltersDto): { start: Date; end: Date } | null {
    if (!filters.startDate && !filters.endDate) return null;
    return {
      start: filters.startDate ? new Date(filters.startDate) : new Date(0),
      end: filters.endDate ? new Date(filters.endDate) : new Date()
    };
  }

  private applyOptFilters(
    qb: SelectQueryBuilder<OptimizationRun>,
    filters: OptimizationFiltersDto,
    dateRange: { start: Date; end: Date } | null
  ): void {
    if (dateRange) {
      qb.andWhere('r.createdAt BETWEEN :start AND :end', dateRange);
    }
    if (filters.status) {
      qb.andWhere('r.status = :status', { status: filters.status });
    }
  }

  /** Status filter intentionally omitted — returns full status breakdown */
  private async getOptStatusCounts(
    filters: OptimizationFiltersDto,
    dateRange: { start: Date; end: Date } | null
  ): Promise<Record<OptimizationStatus, number>> {
    const qb = this.optimizationRunRepo
      .createQueryBuilder('r')
      .select('r.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('r.status');

    if (dateRange) {
      qb.where('r.createdAt BETWEEN :start AND :end', dateRange);
    }

    const results = await qb.getRawMany();
    const counts = Object.values(OptimizationStatus).reduce(
      (acc, s) => {
        acc[s] = 0;
        return acc;
      },
      {} as Record<OptimizationStatus, number>
    );

    for (const row of results) {
      counts[row.status as OptimizationStatus] = parseInt(row.count, 10);
    }

    return counts;
  }

  private async getOptTotalRuns(
    filters: OptimizationFiltersDto,
    dateRange: { start: Date; end: Date } | null
  ): Promise<number> {
    const qb = this.optimizationRunRepo.createQueryBuilder('r');
    this.applyOptFilters(qb, filters, dateRange);
    return qb.getCount();
  }

  private async getOptRecentActivity(): Promise<RecentActivityDto> {
    return this.countRecentActivity(this.optimizationRunRepo);
  }

  private async getOptAvgMetrics(
    filters: OptimizationFiltersDto,
    dateRange: { start: Date; end: Date } | null
  ): Promise<{ avgImprovement: number; avgBestScore: number; avgCombinationsTested: number }> {
    const qb = this.optimizationRunRepo
      .createQueryBuilder('r')
      .select('AVG(r.improvement)', 'avgImprovement')
      .addSelect('AVG(r.bestScore)', 'avgBestScore')
      .addSelect('AVG(r.combinationsTested)', 'avgCombinationsTested')
      .where('r.status = :completed', { completed: OptimizationStatus.COMPLETED });

    if (dateRange) {
      qb.andWhere('r.createdAt BETWEEN :start AND :end', dateRange);
    }

    const result = await qb.getRawOne();
    return {
      avgImprovement: parseFloat(result?.avgImprovement) || 0,
      avgBestScore: parseFloat(result?.avgBestScore) || 0,
      avgCombinationsTested: parseFloat(result?.avgCombinationsTested) || 0
    };
  }

  private async getOptTopStrategies(
    filters: OptimizationFiltersDto,
    dateRange: { start: Date; end: Date } | null
  ): Promise<OptimizationAnalyticsDto['topStrategies']> {
    const qb = this.optimizationRunRepo
      .createQueryBuilder('r')
      .innerJoin('r.strategyConfig', 'sc')
      .innerJoin('sc.algorithm', 'a')
      .select('a.id', 'algorithmId')
      .addSelect('a.name', 'algorithmName')
      .addSelect('COUNT(*)', 'runCount')
      .addSelect('AVG(r.improvement)', 'avgImprovement')
      .addSelect('AVG(r.bestScore)', 'avgBestScore')
      .where('r.status = :completed', { completed: OptimizationStatus.COMPLETED })
      .groupBy('a.id')
      .addGroupBy('a.name')
      .having('COUNT(*) >= 1')
      .orderBy('AVG(r.bestScore)', 'DESC')
      .limit(10);

    if (dateRange) {
      qb.andWhere('r.createdAt BETWEEN :start AND :end', dateRange);
    }

    const results = await qb.getRawMany();
    return results.map((r) => ({
      algorithmId: r.algorithmId,
      algorithmName: r.algorithmName,
      runCount: parseInt(r.runCount, 10),
      avgImprovement: parseFloat(r.avgImprovement) || 0,
      avgBestScore: parseFloat(r.avgBestScore) || 0
    }));
  }

  private async getOptResultSummary(
    filters: OptimizationFiltersDto,
    dateRange: { start: Date; end: Date } | null
  ): Promise<OptimizationAnalyticsDto['resultSummary']> {
    const runSubQuery = this.optimizationRunRepo
      .createQueryBuilder('r')
      .select('r.id')
      .where('r.status = :completed', { completed: OptimizationStatus.COMPLETED });

    if (dateRange) {
      runSubQuery.andWhere('r.createdAt BETWEEN :start AND :end', dateRange);
    }

    const qb = this.optimizationResultRepo
      .createQueryBuilder('res')
      .select('AVG(res.avgTrainScore)', 'avgTrainScore')
      .addSelect('AVG(res.avgTestScore)', 'avgTestScore')
      .addSelect('AVG(res.avgDegradation)', 'avgDegradation')
      .addSelect('AVG(res.consistencyScore)', 'avgConsistency')
      .addSelect('AVG(CASE WHEN res.overfittingWindows > 0 THEN 1.0 ELSE 0.0 END)', 'overfittingRate')
      .where(`res.optimizationRunId IN (${runSubQuery.getQuery()})`)
      .setParameters(runSubQuery.getParameters());

    const result = await qb.getRawOne();
    return {
      avgTrainScore: parseFloat(result?.avgTrainScore) || 0,
      avgTestScore: parseFloat(result?.avgTestScore) || 0,
      avgDegradation: parseFloat(result?.avgDegradation) || 0,
      avgConsistency: parseFloat(result?.avgConsistency) || 0,
      overfittingRate: parseFloat(result?.overfittingRate) || 0
    };
  }

  // ---------------------------------------------------------------------------
  // Paper Trading Analytics Helpers
  // ---------------------------------------------------------------------------

  private getPtDateRange(filters: PaperTradingFiltersDto): { start: Date; end: Date } | null {
    if (!filters.startDate && !filters.endDate) return null;
    return {
      start: filters.startDate ? new Date(filters.startDate) : new Date(0),
      end: filters.endDate ? new Date(filters.endDate) : new Date()
    };
  }

  private applyPtFilters(
    qb: SelectQueryBuilder<PaperTradingSession>,
    filters: PaperTradingFiltersDto,
    dateRange: { start: Date; end: Date } | null
  ): void {
    if (dateRange) {
      qb.andWhere('s.createdAt BETWEEN :start AND :end', dateRange);
    }
    if (filters.algorithmId) {
      qb.andWhere('s.algorithm = :algorithmId', { algorithmId: filters.algorithmId });
    }
    if (filters.status) {
      qb.andWhere('s.status = :status', { status: filters.status });
    }
  }

  /** Status filter intentionally omitted — returns full status breakdown */
  private async getPtStatusCounts(
    filters: PaperTradingFiltersDto,
    dateRange: { start: Date; end: Date } | null
  ): Promise<Record<PaperTradingStatus, number>> {
    const qb = this.paperSessionRepo
      .createQueryBuilder('s')
      .select('s.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('s.status');

    if (dateRange) {
      qb.where('s.createdAt BETWEEN :start AND :end', dateRange);
    }
    if (filters.algorithmId) {
      qb.andWhere('s.algorithm = :algorithmId', { algorithmId: filters.algorithmId });
    }

    const results = await qb.getRawMany();
    const counts = Object.values(PaperTradingStatus).reduce(
      (acc, st) => {
        acc[st] = 0;
        return acc;
      },
      {} as Record<PaperTradingStatus, number>
    );

    for (const row of results) {
      counts[row.status as PaperTradingStatus] = parseInt(row.count, 10);
    }

    return counts;
  }

  private async getPtTotalSessions(
    filters: PaperTradingFiltersDto,
    dateRange: { start: Date; end: Date } | null
  ): Promise<number> {
    const qb = this.paperSessionRepo.createQueryBuilder('s');
    this.applyPtFilters(qb, filters, dateRange);
    return qb.getCount();
  }

  private async getPtRecentActivity(): Promise<RecentActivityDto> {
    return this.countRecentActivity(this.paperSessionRepo);
  }

  private async getPtAvgMetrics(
    filters: PaperTradingFiltersDto,
    dateRange: { start: Date; end: Date } | null
  ): Promise<{ sharpeRatio: number; totalReturn: number; maxDrawdown: number; winRate: number }> {
    const qb = this.paperSessionRepo
      .createQueryBuilder('s')
      .select('AVG(s.sharpeRatio)', 'avgSharpe')
      .addSelect('AVG(s.totalReturn)', 'avgReturn')
      .addSelect('AVG(s.maxDrawdown)', 'avgDrawdown')
      .addSelect('AVG(s.winRate)', 'avgWinRate')
      .where('s.status IN (:...statuses)', {
        statuses: [PaperTradingStatus.COMPLETED, PaperTradingStatus.ACTIVE]
      });

    if (dateRange) {
      qb.andWhere('s.createdAt BETWEEN :start AND :end', dateRange);
    }
    if (filters.algorithmId) {
      qb.andWhere('s.algorithm = :algorithmId', { algorithmId: filters.algorithmId });
    }

    const result = await qb.getRawOne();
    return {
      sharpeRatio: parseFloat(result?.avgSharpe) || 0,
      totalReturn: parseFloat(result?.avgReturn) || 0,
      maxDrawdown: parseFloat(result?.avgDrawdown) || 0,
      winRate: parseFloat(result?.avgWinRate) || 0
    };
  }

  private async getPtTopAlgorithms(
    filters: PaperTradingFiltersDto,
    dateRange: { start: Date; end: Date } | null
  ): Promise<PaperTradingMonitoringDto['topAlgorithms']> {
    const qb = this.paperSessionRepo
      .createQueryBuilder('s')
      .innerJoin('s.algorithm', 'a')
      .select('a.id', 'algorithmId')
      .addSelect('a.name', 'algorithmName')
      .addSelect('COUNT(*)', 'sessionCount')
      .addSelect('AVG(s.totalReturn)', 'avgReturn')
      .addSelect('AVG(s.sharpeRatio)', 'avgSharpe')
      .where('s.status IN (:...statuses)', {
        statuses: [PaperTradingStatus.COMPLETED, PaperTradingStatus.ACTIVE]
      })
      .groupBy('a.id')
      .addGroupBy('a.name')
      .orderBy('AVG(s.sharpeRatio)', 'DESC', 'NULLS LAST')
      .limit(10);

    if (dateRange) {
      qb.andWhere('s.createdAt BETWEEN :start AND :end', dateRange);
    }

    const results = await qb.getRawMany();
    return results.map((r) => ({
      algorithmId: r.algorithmId,
      algorithmName: r.algorithmName,
      sessionCount: parseInt(r.sessionCount, 10),
      avgReturn: parseFloat(r.avgReturn) || 0,
      avgSharpe: parseFloat(r.avgSharpe) || 0
    }));
  }

  private async getPtOrderAnalytics(
    filters: PaperTradingFiltersDto,
    dateRange: { start: Date; end: Date } | null
  ): Promise<PaperTradingMonitoringDto['orderAnalytics']> {
    const sessionSubQuery = this.paperSessionRepo.createQueryBuilder('s').select('s.id');
    this.applyPtFilters(sessionSubQuery, filters, dateRange);

    const subSql = sessionSubQuery.getQuery();
    const subParams = sessionSubQuery.getParameters();

    const [summary, bySymbol] = await Promise.all([
      this.paperOrderRepo
        .createQueryBuilder('o')
        .select('COUNT(*)', 'totalOrders')
        .addSelect(`COUNT(*) FILTER (WHERE o.side = :buySide)`, 'buyCount')
        .addSelect(`COUNT(*) FILTER (WHERE o.side = :sellSide)`, 'sellCount')
        .addSelect('COALESCE(SUM(o.totalValue), 0)', 'totalVolume')
        .addSelect('COALESCE(SUM(o.fee), 0)', 'totalFees')
        .addSelect('AVG(o.slippageBps)', 'avgSlippageBps')
        .addSelect('COALESCE(SUM(o.realizedPnL), 0)', 'totalPnL')
        .where(`o.sessionId IN (${subSql})`)
        .setParameters(subParams)
        .setParameter('buySide', PaperTradingOrderSide.BUY)
        .setParameter('sellSide', PaperTradingOrderSide.SELL)
        .getRawOne(),
      this.paperOrderRepo
        .createQueryBuilder('o')
        .select('o.symbol', 'symbol')
        .addSelect('COUNT(*)', 'orderCount')
        .addSelect('COALESCE(SUM(o.totalValue), 0)', 'totalVolume')
        .addSelect('COALESCE(SUM(o.realizedPnL), 0)', 'totalPnL')
        .where(`o.sessionId IN (${subSql})`)
        .setParameters(subParams)
        .groupBy('o.symbol')
        .orderBy('COALESCE(SUM(o.totalValue), 0)', 'DESC')
        .limit(10)
        .getRawMany()
    ]);

    return {
      totalOrders: parseInt(summary?.totalOrders, 10) || 0,
      buyCount: parseInt(summary?.buyCount, 10) || 0,
      sellCount: parseInt(summary?.sellCount, 10) || 0,
      totalVolume: parseFloat(summary?.totalVolume) || 0,
      totalFees: parseFloat(summary?.totalFees) || 0,
      avgSlippageBps: parseFloat(summary?.avgSlippageBps) || 0,
      totalPnL: parseFloat(summary?.totalPnL) || 0,
      bySymbol: bySymbol.map((r) => ({
        symbol: r.symbol,
        orderCount: parseInt(r.orderCount, 10),
        totalVolume: parseFloat(r.totalVolume) || 0,
        totalPnL: parseFloat(r.totalPnL) || 0
      }))
    };
  }

  private async getPtSignalAnalytics(
    filters: PaperTradingFiltersDto,
    dateRange: { start: Date; end: Date } | null
  ): Promise<PaperTradingMonitoringDto['signalAnalytics']> {
    const sessionSubQuery = this.paperSessionRepo.createQueryBuilder('s').select('s.id');
    this.applyPtFilters(sessionSubQuery, filters, dateRange);

    const subSql = sessionSubQuery.getQuery();
    const subParams = sessionSubQuery.getParameters();

    const [overallResult, typeResults, directionResults] = await Promise.all([
      this.paperSignalRepo
        .createQueryBuilder('sig')
        .select('COUNT(*)', 'totalSignals')
        .addSelect('AVG(CASE WHEN sig.processed = true THEN 1.0 ELSE 0.0 END)', 'processedRate')
        .addSelect('AVG(sig.confidence)', 'avgConfidence')
        .where(`sig.sessionId IN (${subSql})`)
        .setParameters(subParams)
        .getRawOne(),
      this.paperSignalRepo
        .createQueryBuilder('sig')
        .select('sig.signalType', 'signalType')
        .addSelect('COUNT(*)', 'count')
        .where(`sig.sessionId IN (${subSql})`)
        .setParameters(subParams)
        .groupBy('sig.signalType')
        .getRawMany(),
      this.paperSignalRepo
        .createQueryBuilder('sig')
        .select('sig.direction', 'direction')
        .addSelect('COUNT(*)', 'count')
        .where(`sig.sessionId IN (${subSql})`)
        .setParameters(subParams)
        .groupBy('sig.direction')
        .getRawMany()
    ]);

    const byType = Object.values(PaperTradingSignalType).reduce(
      (acc, t) => {
        acc[t] = 0;
        return acc;
      },
      {} as Record<PaperTradingSignalType, number>
    );
    for (const row of typeResults) {
      byType[row.signalType as PaperTradingSignalType] = parseInt(row.count, 10);
    }

    const byDirection = Object.values(PaperTradingSignalDirection).reduce(
      (acc, d) => {
        acc[d] = 0;
        return acc;
      },
      {} as Record<PaperTradingSignalDirection, number>
    );
    for (const row of directionResults) {
      byDirection[row.direction as PaperTradingSignalDirection] = parseInt(row.count, 10);
    }

    return {
      totalSignals: parseInt(overallResult?.totalSignals, 10) || 0,
      processedRate: parseFloat(overallResult?.processedRate) || 0,
      avgConfidence: parseFloat(overallResult?.avgConfidence) || 0,
      byType,
      byDirection
    };
  }
}
