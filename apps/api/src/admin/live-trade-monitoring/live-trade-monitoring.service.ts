import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Decimal } from 'decimal.js';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { AlertsDto, AlertSeverity, AlertThresholdsDto, AlertType, PerformanceAlertDto } from './dto/alerts.dto';
import { AlgorithmActivationListItemDto, PaginatedAlgorithmListDto } from './dto/algorithms.dto';
import {
  AlgorithmComparisonDto,
  ComparisonDto,
  DeviationMetricsDto,
  PerformanceMetricsDto
} from './dto/comparison.dto';
import {
  AlgorithmListQueryDto,
  AlgorithmSortField,
  ExportFormat,
  LiveTradeFiltersDto,
  OrderListQueryDto,
  OrderSortField,
  SortOrder,
  UserActivityQueryDto
} from './dto/filters.dto';
import { AlgorithmicOrderListItemDto, PaginatedOrderListDto } from './dto/orders.dto';
import {
  AlertsSummaryDto,
  LiveTradeOverviewDto,
  LiveTradeSummaryDto,
  RecentOrderDto,
  TopPerformingAlgorithmDto
} from './dto/overview.dto';
import {
  LiveSlippageStatsDto,
  SlippageAnalysisDto,
  SlippageByAlgorithmDto,
  SlippageBySizeDto,
  SlippageBySymbolDto,
  SlippageByTimeDto
} from './dto/slippage-analysis.dto';
import { PaginatedUserActivityDto, UserActivityItemDto, UserAlgorithmSummaryDto } from './dto/user-activity.dto';

import { AlgorithmActivation } from '../../algorithm/algorithm-activation.entity';
import { AlgorithmPerformance } from '../../algorithm/algorithm-performance.entity';
import { Algorithm } from '../../algorithm/algorithm.entity';
import { Backtest, BacktestStatus, SimulatedOrderFill } from '../../order/backtest/backtest.entity';
import { Order } from '../../order/order.entity';
import { User } from '../../users/users.entity';

/** Maximum number of records to export to prevent DoS */
const MAX_EXPORT_LIMIT = 10000;

/** Default alert thresholds */
const DEFAULT_THRESHOLDS: AlertThresholdsDto = {
  sharpeRatioWarning: 25,
  sharpeRatioCritical: 50,
  winRateWarning: 10,
  winRateCritical: 20,
  maxDrawdownWarning: 25,
  maxDrawdownCritical: 50,
  totalReturnWarning: 20,
  totalReturnCritical: 40,
  slippageWarningBps: 30,
  slippageCriticalBps: 50
};

/** Whitelist mapping for safe sort column access (prevents SQL injection) */
const ALGORITHM_SORT_COLUMN_MAP: Record<AlgorithmSortField, string> = {
  [AlgorithmSortField.NAME]: 'a.name',
  [AlgorithmSortField.ACTIVATED_AT]: 'aa.activatedAt',
  [AlgorithmSortField.TOTAL_ORDERS]: 'totalOrders',
  [AlgorithmSortField.ROI]: 'ap.roi',
  [AlgorithmSortField.WIN_RATE]: 'ap.winRate'
};

const ORDER_SORT_COLUMN_MAP: Record<OrderSortField, string> = {
  [OrderSortField.CREATED_AT]: 'o.createdAt',
  [OrderSortField.TRANSACT_TIME]: 'o.transactTime',
  [OrderSortField.SYMBOL]: 'o.symbol',
  [OrderSortField.COST]: 'o.cost',
  [OrderSortField.ACTUAL_SLIPPAGE_BPS]: 'o.actualSlippageBps'
};

/**
 * Service for live trade monitoring analytics
 *
 * Provides aggregated metrics and analytics for admin dashboard
 * to monitor live trading activity and compare against backtest predictions.
 */
@Injectable()
export class LiveTradeMonitoringService {
  private readonly logger = new Logger(LiveTradeMonitoringService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(AlgorithmActivation)
    private readonly activationRepo: Repository<AlgorithmActivation>,
    @InjectRepository(AlgorithmPerformance)
    private readonly performanceRepo: Repository<AlgorithmPerformance>,
    @InjectRepository(Backtest)
    private readonly backtestRepo: Repository<Backtest>,
    @InjectRepository(SimulatedOrderFill)
    private readonly fillRepo: Repository<SimulatedOrderFill>,
    @InjectRepository(Algorithm)
    private readonly algorithmRepo: Repository<Algorithm>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC ENDPOINTS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get overview metrics for the live trade monitoring dashboard
   */
  async getOverview(filters: LiveTradeFiltersDto): Promise<LiveTradeOverviewDto> {
    const dateRange = this.getDateRange(filters);

    const [summary, topAlgorithms, recentOrders, alertsSummary] = await Promise.all([
      this.getSummaryMetrics(filters, dateRange),
      this.getTopAlgorithms(filters),
      this.getRecentOrders(10),
      this.getAlertsSummary(filters)
    ]);

    return {
      summary,
      topAlgorithms,
      recentOrders,
      alertsSummary
    };
  }

  /**
   * Get paginated list of algorithm activations
   */
  async getAlgorithms(query: AlgorithmListQueryDto): Promise<PaginatedAlgorithmListDto> {
    const {
      page = 1,
      limit = 20,
      sortBy = AlgorithmSortField.ACTIVATED_AT,
      sortOrder = SortOrder.DESC,
      search,
      isActive
    } = query;
    const skip = (page - 1) * limit;
    const dateRange = this.getDateRange(query);

    // Build base query
    const qb = this.activationRepo
      .createQueryBuilder('aa')
      .leftJoinAndSelect('aa.algorithm', 'a')
      .leftJoinAndSelect('aa.user', 'u')
      .leftJoinAndSelect('aa.exchangeKey', 'ek')
      .leftJoin('ek.exchange', 'ex');

    // Join performance for metrics
    qb.leftJoin(
      (subQuery) =>
        subQuery
          .select('ap2.algorithmActivationId', 'activationId')
          .addSelect('ap2.roi', 'roi')
          .addSelect('ap2.winRate', 'winRate')
          .addSelect('ap2.sharpeRatio', 'sharpeRatio')
          .addSelect('ap2.maxDrawdown', 'maxDrawdown')
          .from(AlgorithmPerformance, 'ap2')
          .where(
            'ap2.calculatedAt = (SELECT MAX(ap3."calculatedAt") FROM algorithm_performances ap3 WHERE ap3."algorithmActivationId" = ap2."algorithmActivationId")'
          ),
      'ap',
      'ap."activationId" = aa.id'
    );

    // Add order count subquery
    qb.addSelect(
      (subQuery) =>
        subQuery
          .select('COUNT(*)')
          .from(Order, 'o')
          .where('o.algorithmActivationId = aa.id')
          .andWhere('o.isAlgorithmicTrade = true'),
      'totalOrders'
    );

    // Apply filters
    if (query.algorithmId) {
      qb.andWhere('aa.algorithmId = :algorithmId', { algorithmId: query.algorithmId });
    }
    if (query.userId) {
      qb.andWhere('aa.userId = :userId', { userId: query.userId });
    }
    if (isActive !== undefined) {
      qb.andWhere('aa.isActive = :isActive', { isActive });
    }
    if (search) {
      qb.andWhere('a.name ILIKE :search', { search: `%${search}%` });
    }
    if (dateRange.startDate) {
      qb.andWhere('aa.activatedAt >= :startDate', { startDate: dateRange.startDate });
    }
    if (dateRange.endDate) {
      qb.andWhere('aa.activatedAt <= :endDate', { endDate: dateRange.endDate });
    }

    // Get total count
    const total = await qb.getCount();

    // Apply sorting
    const sortColumn = ALGORITHM_SORT_COLUMN_MAP[sortBy] || ALGORITHM_SORT_COLUMN_MAP[AlgorithmSortField.ACTIVATED_AT];
    if (sortBy === AlgorithmSortField.TOTAL_ORDERS) {
      qb.orderBy('totalOrders', sortOrder);
    } else {
      qb.orderBy(sortColumn, sortOrder);
    }

    qb.skip(skip).take(limit);

    const activations = await qb.getRawAndEntities();

    // Batch fetch order stats for all activations (fixes N+1)
    const activationIds = activations.entities.map((aa) => aa.id);
    const orderStatsMap = await this.getBatchActivationOrderStats(activationIds);

    // Map to DTOs
    const data: AlgorithmActivationListItemDto[] = activations.entities.map((aa, index) => {
      const raw = activations.raw[index];
      const orderStats = orderStatsMap.get(aa.id) || { orders24h: 0, totalVolume: 0, avgSlippageBps: 0 };

      return {
        id: aa.id,
        algorithmId: aa.algorithmId,
        algorithmName: aa.algorithm?.name || 'Unknown',
        userId: aa.userId,
        userEmail: aa.user?.email || 'Unknown',
        isActive: aa.isActive,
        allocationPercentage: Number(aa.allocationPercentage),
        activatedAt: aa.activatedAt?.toISOString(),
        deactivatedAt: aa.deactivatedAt?.toISOString(),
        totalOrders: parseInt(raw.totalOrders || '0', 10),
        orders24h: orderStats.orders24h,
        totalVolume: orderStats.totalVolume,
        roi: raw.roi ? Number(raw.roi) : undefined,
        winRate: raw.winRate ? Number(raw.winRate) : undefined,
        sharpeRatio: raw.sharpeRatio ? Number(raw.sharpeRatio) : undefined,
        maxDrawdown: raw.maxDrawdown ? Number(raw.maxDrawdown) : undefined,
        avgSlippageBps: orderStats.avgSlippageBps,
        exchangeName: aa.exchangeKey?.exchange?.name || 'Unknown',
        createdAt: aa.createdAt.toISOString()
      };
    });

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
   * Get paginated list of algorithmic orders
   */
  async getOrders(query: OrderListQueryDto): Promise<PaginatedOrderListDto> {
    const {
      page = 1,
      limit = 20,
      sortBy = OrderSortField.CREATED_AT,
      sortOrder = SortOrder.DESC,
      algorithmActivationId,
      symbol
    } = query;
    const skip = (page - 1) * limit;
    const dateRange = this.getDateRange(query);

    const qb = this.orderRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.user', 'u')
      .leftJoinAndSelect('o.exchange', 'ex')
      .leftJoinAndSelect('o.algorithmActivation', 'aa')
      .leftJoin('aa.algorithm', 'a')
      .addSelect(['a.id', 'a.name'])
      .where('o.isAlgorithmicTrade = true');

    // Apply filters
    if (query.algorithmId) {
      qb.andWhere('a.id = :algorithmId', { algorithmId: query.algorithmId });
    }
    if (query.userId) {
      qb.andWhere('o.user.id = :userId', { userId: query.userId });
    }
    if (algorithmActivationId) {
      qb.andWhere('o.algorithmActivationId = :algorithmActivationId', { algorithmActivationId });
    }
    if (symbol) {
      qb.andWhere('o.symbol = :symbol', { symbol });
    }
    if (dateRange.startDate) {
      qb.andWhere('o.createdAt >= :startDate', { startDate: dateRange.startDate });
    }
    if (dateRange.endDate) {
      qb.andWhere('o.createdAt <= :endDate', { endDate: dateRange.endDate });
    }

    // Get total and aggregates
    const [total, aggregates] = await Promise.all([qb.getCount(), this.getOrderAggregates(qb.clone())]);

    // Apply sorting and pagination
    const sortColumn = ORDER_SORT_COLUMN_MAP[sortBy] || ORDER_SORT_COLUMN_MAP[OrderSortField.CREATED_AT];
    qb.orderBy(sortColumn, sortOrder).skip(skip).take(limit);

    const orders = await qb.getMany();

    const data: AlgorithmicOrderListItemDto[] = orders.map((o) => ({
      id: o.id,
      symbol: o.symbol,
      orderId: o.orderId,
      side: o.side,
      type: o.type,
      status: o.status,
      quantity: o.quantity,
      price: o.price,
      executedQuantity: o.executedQuantity,
      cost: o.cost,
      averagePrice: o.averagePrice,
      expectedPrice: o.expectedPrice,
      actualSlippageBps: o.actualSlippageBps,
      fee: o.fee,
      gainLoss: o.gainLoss,
      algorithmActivationId: o.algorithmActivationId || '',
      algorithmName: o.algorithmActivation?.algorithm?.name || 'Unknown',
      userId: o.user?.id || '',
      userEmail: o.user?.email || 'Unknown',
      exchangeName: o.exchange?.name || 'Unknown',
      transactTime: o.transactTime.toISOString(),
      createdAt: o.createdAt.toISOString()
    }));

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      totalVolume: aggregates.totalVolume,
      totalPnL: aggregates.totalPnL,
      avgSlippageBps: aggregates.avgSlippageBps
    };
  }

  /**
   * Get backtest vs live comparison for a specific algorithm
   */
  async getComparison(algorithmId: string): Promise<ComparisonDto> {
    // Verify algorithm exists
    const algorithm = await this.algorithmRepo.findOne({ where: { id: algorithmId } });
    if (!algorithm) {
      throw new NotFoundException(`Algorithm with ID '${algorithmId}' not found`);
    }

    // Get live metrics
    const liveMetrics = await this.getLiveMetrics(algorithmId);

    // Get most recent completed backtest
    const backtest = await this.backtestRepo.findOne({
      where: { algorithm: { id: algorithmId }, status: BacktestStatus.COMPLETED },
      order: { completedAt: 'DESC' }
    });

    let backtestMetrics: PerformanceMetricsDto | undefined;
    if (backtest) {
      backtestMetrics = {
        totalReturn: backtest.totalReturn,
        sharpeRatio: backtest.sharpeRatio,
        winRate: backtest.winRate,
        maxDrawdown: backtest.maxDrawdown,
        totalTrades: backtest.totalTrades,
        avgSlippageBps: await this.getBacktestAvgSlippage(backtest.id)
      };
    }

    // Calculate deviations
    const deviations = this.calculateDeviations(liveMetrics, backtestMetrics);

    // Generate alerts
    const alerts = this.generateComparisonAlerts(liveMetrics, backtestMetrics);

    const comparison: AlgorithmComparisonDto = {
      algorithmId,
      algorithmName: algorithm.name,
      activeActivations: await this.activationRepo.count({ where: { algorithmId, isActive: true } }),
      totalLiveOrders: liveMetrics.totalTrades || 0,
      backtestId: backtest?.id,
      backtestName: backtest?.name,
      liveMetrics,
      backtestMetrics,
      deviations,
      hasSignificantDeviation: alerts.length > 0,
      alerts
    };

    return {
      comparison,
      periodStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      periodEnd: new Date().toISOString(),
      calculatedAt: new Date().toISOString()
    };
  }

  /**
   * Get slippage analysis
   */
  async getSlippageAnalysis(filters: LiveTradeFiltersDto): Promise<SlippageAnalysisDto> {
    const dateRange = this.getDateRange(filters);

    const [overallLive, overallBacktest, byAlgorithm, byTimeOfDay, byOrderSize, bySymbol] = await Promise.all([
      this.getOverallLiveSlippage(filters, dateRange),
      this.getOverallBacktestSlippage(filters),
      this.getSlippageByAlgorithm(filters, dateRange),
      this.getSlippageByTimeOfDay(filters, dateRange),
      this.getSlippageByOrderSize(filters, dateRange),
      this.getSlippageBySymbol(filters, dateRange)
    ]);

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
   * Get users with active algorithms
   */
  async getUserActivity(query: UserActivityQueryDto): Promise<PaginatedUserActivityDto> {
    const { page = 1, limit = 20, minActiveAlgorithms = 0, search } = query;
    const skip = (page - 1) * limit;

    // Get users with algorithm activations
    const qb = this.userRepo
      .createQueryBuilder('u')
      .innerJoin('algorithm_activations', 'aa', 'aa.userId = u.id')
      .groupBy('u.id')
      .having('COUNT(CASE WHEN aa."isActive" = true THEN 1 END) >= :minActive', { minActive: minActiveAlgorithms });

    if (search) {
      qb.andWhere('u.email ILIKE :search', { search: `%${search}%` });
    }

    const total = await qb.getCount();

    qb.orderBy('COUNT(CASE WHEN aa."isActive" = true THEN 1 END)', 'DESC').skip(skip).take(limit);

    const users = await qb.getMany();

    // Batch fetch order activity and algorithm summaries for all users (fixes N+1)
    const userIds = users.map((u) => u.id);
    const [orderActivityMap, algorithmSummaryMap] = await Promise.all([
      this.getBatchUserOrderActivity(userIds),
      this.getBatchUserAlgorithmSummary(userIds)
    ]);

    const data: UserActivityItemDto[] = users.map((u) => {
      const activity = orderActivityMap.get(u.id) || {
        totalOrders: 0,
        orders24h: 0,
        orders7d: 0,
        totalVolume: 0,
        totalPnL: 0,
        avgSlippageBps: 0
      };
      const algorithms = algorithmSummaryMap.get(u.id) || [];

      return {
        userId: u.id,
        email: u.email,
        firstName: u.given_name,
        lastName: u.family_name,
        totalActivations: algorithms.length,
        activeAlgorithms: algorithms.filter((a) => a.isActive).length,
        totalOrders: activity.totalOrders,
        orders24h: activity.orders24h,
        orders7d: activity.orders7d,
        totalVolume: activity.totalVolume,
        totalPnL: activity.totalPnL,
        avgSlippageBps: activity.avgSlippageBps,
        registeredAt: u.createdAt.toISOString(),
        lastOrderAt: activity.lastOrderAt,
        algorithms
      };
    });

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
   * Get performance deviation alerts
   */
  async getAlerts(filters: LiveTradeFiltersDto): Promise<AlertsDto> {
    const alerts = await this.generateAllAlerts(filters);

    const criticalCount = alerts.filter((a) => a.severity === AlertSeverity.CRITICAL).length;
    const warningCount = alerts.filter((a) => a.severity === AlertSeverity.WARNING).length;
    const infoCount = alerts.filter((a) => a.severity === AlertSeverity.INFO).length;

    return {
      alerts,
      total: alerts.length,
      criticalCount,
      warningCount,
      infoCount,
      thresholds: DEFAULT_THRESHOLDS,
      lastCalculatedAt: new Date().toISOString()
    };
  }

  /**
   * Export algorithmic orders as CSV or JSON
   */
  async exportOrders(filters: LiveTradeFiltersDto, format: ExportFormat): Promise<Buffer | object[]> {
    const dateRange = this.getDateRange(filters);

    const qb = this.orderRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.user', 'u')
      .leftJoinAndSelect('o.exchange', 'ex')
      .leftJoinAndSelect('o.algorithmActivation', 'aa')
      .leftJoin('aa.algorithm', 'a')
      .addSelect(['a.id', 'a.name'])
      .where('o.isAlgorithmicTrade = true');

    if (filters.algorithmId) {
      qb.andWhere('a.id = :algorithmId', { algorithmId: filters.algorithmId });
    }
    if (filters.userId) {
      qb.andWhere('u.id = :userId', { userId: filters.userId });
    }
    if (dateRange.startDate) {
      qb.andWhere('o.createdAt >= :startDate', { startDate: dateRange.startDate });
    }
    if (dateRange.endDate) {
      qb.andWhere('o.createdAt <= :endDate', { endDate: dateRange.endDate });
    }

    qb.orderBy('o.createdAt', 'DESC').take(MAX_EXPORT_LIMIT);

    const orders = await qb.getMany();

    if (orders.length === MAX_EXPORT_LIMIT) {
      this.logger.warn(`Export truncated to ${MAX_EXPORT_LIMIT} records`);
    }

    const data = orders.map((o) => ({
      id: o.id,
      symbol: o.symbol,
      side: o.side,
      type: o.type,
      status: o.status,
      quantity: o.quantity,
      price: o.price,
      executedQuantity: o.executedQuantity,
      cost: o.cost || 0,
      actualSlippageBps: o.actualSlippageBps || 0,
      fee: o.fee,
      gainLoss: o.gainLoss || 0,
      algorithmName: o.algorithmActivation?.algorithm?.name || '',
      userEmail: o.user?.email || '',
      exchangeName: o.exchange?.name || '',
      transactTime: o.transactTime.toISOString(),
      createdAt: o.createdAt.toISOString()
    }));

    if (format === ExportFormat.JSON) {
      return data;
    }

    return this.convertToCsv(data);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPER METHODS - Overview
  // ─────────────────────────────────────────────────────────────────────────────

  private async getSummaryMetrics(
    filters: LiveTradeFiltersDto,
    dateRange: { startDate?: Date; endDate?: Date }
  ): Promise<LiveTradeSummaryDto> {
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
      activeUsers: parseInt(activeUsers?.count || '0', 10)
    };
  }

  private async getOrderStats(
    filters: LiveTradeFiltersDto,
    dateRange: { startDate?: Date; endDate?: Date }
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
      totalOrders: parseInt(result?.totalOrders || '0', 10),
      orders24h: parseInt(result?.orders24h || '0', 10),
      orders7d: parseInt(result?.orders7d || '0', 10),
      totalVolume: Number(result?.totalVolume || 0),
      totalPnL: Number(result?.totalPnL || 0),
      avgSlippageBps: Number(result?.avgSlippageBps || 0)
    };
  }

  private async getTopAlgorithms(_filters: LiveTradeFiltersDto): Promise<TopPerformingAlgorithmDto[]> {
    const result = await this.algorithmRepo
      .createQueryBuilder('a')
      .leftJoin('algorithm_activations', 'aa', 'aa.algorithmId = a.id')
      .leftJoin(
        'algorithm_performances',
        'ap',
        'ap.algorithmActivationId = aa.id AND ap.calculatedAt = (SELECT MAX(ap2."calculatedAt") FROM algorithm_performances ap2 WHERE ap2."algorithmActivationId" = aa.id)'
      )
      .leftJoin(Order, 'o', 'o.algorithmActivationId = aa.id AND o.isAlgorithmicTrade = true')
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
      activeActivations: parseInt(r.activeActivations || '0', 10),
      totalOrders: parseInt(r.totalOrders || '0', 10),
      avgRoi: Number(r.avgRoi || 0),
      avgWinRate: Number(r.avgWinRate || 0),
      avgSlippageBps: Number(r.avgSlippageBps || 0)
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
    // Lightweight path: skip user relation loading and alert sorting
    const { activations, perfMap, backtestMap } = await this.fetchAlertBaseData(filters, false);

    let critical = 0;
    let warning = 0;
    let info = 0;

    for (const activation of activations) {
      const performance = perfMap.get(activation.id) || null;
      const backtest = backtestMap.get(activation.algorithmId) || null;
      const activationAlerts = this.generateAlertsForActivation(activation, performance, backtest);

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

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPER METHODS - Algorithms & Orders
  // ─────────────────────────────────────────────────────────────────────────────

  private async getBatchActivationOrderStats(
    activationIds: string[]
  ): Promise<Map<string, { orders24h: number; totalVolume: number; avgSlippageBps: number }>> {
    const map = new Map<string, { orders24h: number; totalVolume: number; avgSlippageBps: number }>();
    if (activationIds.length === 0) return map;

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const results = await this.orderRepo
      .createQueryBuilder('o')
      .select('o.algorithmActivationId', 'activationId')
      .addSelect('COALESCE(SUM(o.cost), 0)', 'totalVolume')
      .addSelect('COALESCE(AVG(o.actualSlippageBps), 0)', 'avgSlippageBps')
      .addSelect(`COUNT(*) FILTER (WHERE o."createdAt" >= :oneDayAgo)`, 'orders24h')
      .where('o.algorithmActivationId IN (:...activationIds)', { activationIds })
      .andWhere('o.isAlgorithmicTrade = true')
      .setParameter('oneDayAgo', oneDayAgo)
      .groupBy('o.algorithmActivationId')
      .getRawMany();

    for (const r of results) {
      map.set(r.activationId, {
        orders24h: parseInt(r.orders24h || '0', 10),
        totalVolume: Number(r.totalVolume || 0),
        avgSlippageBps: Number(r.avgSlippageBps || 0)
      });
    }

    return map;
  }

  private async getOrderAggregates(
    qb: SelectQueryBuilder<Order>
  ): Promise<{ totalVolume: number; totalPnL: number; avgSlippageBps: number }> {
    const result = await qb
      .select('COALESCE(SUM(o.cost), 0)', 'totalVolume')
      .addSelect('COALESCE(SUM(o.gainLoss), 0)', 'totalPnL')
      .addSelect('COALESCE(AVG(o.actualSlippageBps), 0)', 'avgSlippageBps')
      .getRawOne();

    return {
      totalVolume: Number(result?.totalVolume || 0),
      totalPnL: Number(result?.totalPnL || 0),
      avgSlippageBps: Number(result?.avgSlippageBps || 0)
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPER METHODS - Comparison
  // ─────────────────────────────────────────────────────────────────────────────

  private async getLiveMetrics(algorithmId: string): Promise<PerformanceMetricsDto> {
    // Get aggregated metrics from all activations of this algorithm
    const result = await this.activationRepo
      .createQueryBuilder('aa')
      .leftJoin(
        'algorithm_performances',
        'ap',
        'ap.algorithmActivationId = aa.id AND ap.calculatedAt = (SELECT MAX(ap2."calculatedAt") FROM algorithm_performances ap2 WHERE ap2."algorithmActivationId" = aa.id)'
      )
      .leftJoin(Order, 'o', 'o.algorithmActivationId = aa.id AND o.isAlgorithmicTrade = true')
      .select('COALESCE(AVG(ap.roi), 0)', 'totalReturn')
      .addSelect('COALESCE(AVG(ap.sharpeRatio), 0)', 'sharpeRatio')
      .addSelect('COALESCE(AVG(ap.winRate), 0)', 'winRate')
      .addSelect('COALESCE(AVG(ap.maxDrawdown), 0)', 'maxDrawdown')
      .addSelect('COUNT(o.id)', 'totalTrades')
      .addSelect('COALESCE(AVG(o.actualSlippageBps), 0)', 'avgSlippageBps')
      .addSelect('COALESCE(SUM(o.cost), 0)', 'totalVolume')
      .addSelect('COALESCE(AVG(ap.volatility), 0)', 'volatility')
      .where('aa.algorithmId = :algorithmId', { algorithmId })
      .andWhere('aa.isActive = true')
      .getRawOne();

    return {
      totalReturn: Number(result?.totalReturn || 0),
      sharpeRatio: Number(result?.sharpeRatio || 0),
      winRate: Number(result?.winRate || 0),
      maxDrawdown: Number(result?.maxDrawdown || 0),
      totalTrades: parseInt(result?.totalTrades || '0', 10),
      avgSlippageBps: Number(result?.avgSlippageBps || 0),
      totalVolume: Number(result?.totalVolume || 0),
      volatility: Number(result?.volatility || 0)
    };
  }

  private async getBacktestAvgSlippage(backtestId: string): Promise<number> {
    const result = await this.fillRepo
      .createQueryBuilder('f')
      .select('COALESCE(AVG(f.slippageBps), 0)', 'avgSlippageBps')
      .where('f.backtest.id = :backtestId', { backtestId })
      .getRawOne();

    return Number(result?.avgSlippageBps || 0);
  }

  private calculateDeviations(
    live: PerformanceMetricsDto,
    backtest?: PerformanceMetricsDto
  ): DeviationMetricsDto | undefined {
    if (!backtest) return undefined;

    const calculateDeviation = (liveVal?: number, backtestVal?: number): number | undefined => {
      if (liveVal === undefined || backtestVal === undefined || backtestVal === 0) return undefined;
      return new Decimal(liveVal).minus(backtestVal).dividedBy(Math.abs(backtestVal)).times(100).toNumber();
    };

    return {
      totalReturn: calculateDeviation(live.totalReturn, backtest.totalReturn),
      sharpeRatio: calculateDeviation(live.sharpeRatio, backtest.sharpeRatio),
      winRate: calculateDeviation(live.winRate, backtest.winRate),
      maxDrawdown: calculateDeviation(live.maxDrawdown, backtest.maxDrawdown),
      avgSlippageBps:
        live.avgSlippageBps !== undefined && backtest.avgSlippageBps !== undefined
          ? new Decimal(live.avgSlippageBps).minus(backtest.avgSlippageBps).toNumber()
          : undefined
    };
  }

  private generateComparisonAlerts(live: PerformanceMetricsDto, backtest?: PerformanceMetricsDto): string[] {
    const alerts: string[] = [];
    if (!backtest) {
      alerts.push('No completed backtest available for comparison');
      return alerts;
    }

    const deviations = this.calculateDeviations(live, backtest);
    if (!deviations) return alerts;

    if (deviations.totalReturn !== undefined && deviations.totalReturn < -DEFAULT_THRESHOLDS.totalReturnWarning) {
      alerts.push(`Total return ${deviations.totalReturn.toFixed(1)}% lower than backtest`);
    }
    if (deviations.sharpeRatio !== undefined && deviations.sharpeRatio < -DEFAULT_THRESHOLDS.sharpeRatioWarning) {
      alerts.push(`Sharpe ratio ${Math.abs(deviations.sharpeRatio).toFixed(1)}% lower than backtest`);
    }
    if (deviations.winRate !== undefined && deviations.winRate < -DEFAULT_THRESHOLDS.winRateWarning) {
      alerts.push(`Win rate ${Math.abs(deviations.winRate).toFixed(1)}% lower than backtest`);
    }
    if (deviations.maxDrawdown !== undefined && deviations.maxDrawdown > DEFAULT_THRESHOLDS.maxDrawdownWarning) {
      alerts.push(`Max drawdown ${deviations.maxDrawdown.toFixed(1)}% higher than backtest`);
    }
    if (deviations.avgSlippageBps !== undefined && deviations.avgSlippageBps > DEFAULT_THRESHOLDS.slippageWarningBps) {
      alerts.push(`Slippage ${deviations.avgSlippageBps.toFixed(1)} bps higher than backtest`);
    }

    return alerts;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPER METHODS - Slippage Analysis
  // ─────────────────────────────────────────────────────────────────────────────

  private async getOverallLiveSlippage(
    filters: LiveTradeFiltersDto,
    dateRange: { startDate?: Date; endDate?: Date }
  ): Promise<LiveSlippageStatsDto> {
    const qb = this.orderRepo
      .createQueryBuilder('o')
      .where('o.isAlgorithmicTrade = true')
      .andWhere('o.actualSlippageBps IS NOT NULL');

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

    const result = await qb
      .select('COALESCE(AVG(o.actualSlippageBps), 0)', 'avgBps')
      .addSelect('COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY o.actualSlippageBps), 0)', 'medianBps')
      .addSelect('COALESCE(MIN(o.actualSlippageBps), 0)', 'minBps')
      .addSelect('COALESCE(MAX(o.actualSlippageBps), 0)', 'maxBps')
      .addSelect('COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY o.actualSlippageBps), 0)', 'p95Bps')
      .addSelect('COALESCE(STDDEV(o.actualSlippageBps), 0)', 'stdDevBps')
      .addSelect('COUNT(*)', 'orderCount')
      .getRawOne();

    return {
      avgBps: Number(result?.avgBps || 0),
      medianBps: Number(result?.medianBps || 0),
      minBps: Number(result?.minBps || 0),
      maxBps: Number(result?.maxBps || 0),
      p95Bps: Number(result?.p95Bps || 0),
      stdDevBps: Number(result?.stdDevBps || 0),
      orderCount: parseInt(result?.orderCount || '0', 10)
    };
  }

  private async getOverallBacktestSlippage(filters: LiveTradeFiltersDto): Promise<LiveSlippageStatsDto | undefined> {
    const qb = this.fillRepo.createQueryBuilder('f').leftJoin('f.backtest', 'b');

    if (filters.algorithmId) {
      qb.andWhere('b.algorithm.id = :algorithmId', { algorithmId: filters.algorithmId });
    }

    const result = await qb
      .select('COALESCE(AVG(f.slippageBps), 0)', 'avgBps')
      .addSelect('COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY f.slippageBps), 0)', 'medianBps')
      .addSelect('COALESCE(MIN(f.slippageBps), 0)', 'minBps')
      .addSelect('COALESCE(MAX(f.slippageBps), 0)', 'maxBps')
      .addSelect('COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY f.slippageBps), 0)', 'p95Bps')
      .addSelect('COALESCE(STDDEV(f.slippageBps), 0)', 'stdDevBps')
      .addSelect('COUNT(*)', 'orderCount')
      .getRawOne();

    if (!result || parseInt(result.orderCount || '0', 10) === 0) {
      return undefined;
    }

    return {
      avgBps: Number(result.avgBps || 0),
      medianBps: Number(result.medianBps || 0),
      minBps: Number(result.minBps || 0),
      maxBps: Number(result.maxBps || 0),
      p95Bps: Number(result.p95Bps || 0),
      stdDevBps: Number(result.stdDevBps || 0),
      orderCount: parseInt(result.orderCount || '0', 10)
    };
  }

  private async getSlippageByAlgorithm(
    filters: LiveTradeFiltersDto,
    dateRange: { startDate?: Date; endDate?: Date }
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

    // Batch fetch backtest slippage for all algorithms (fixes N+1)
    const algorithmIds = results.map((r) => r.algorithmId).filter(Boolean);
    const backtestSlippageMap = await this.getBatchAlgorithmBacktestSlippage(algorithmIds);

    return results.map((r) => {
      const backtestSlippage = backtestSlippageMap.get(r.algorithmId);
      return {
        algorithmId: r.algorithmId,
        algorithmName: r.algorithmName,
        liveSlippage: {
          avgBps: Number(r.avgBps || 0),
          medianBps: Number(r.medianBps || 0),
          minBps: Number(r.minBps || 0),
          maxBps: Number(r.maxBps || 0),
          p95Bps: Number(r.p95Bps || 0),
          stdDevBps: Number(r.stdDevBps || 0),
          orderCount: parseInt(r.orderCount || '0', 10)
        },
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
      const orderCount = parseInt(r.orderCount || '0', 10);
      if (orderCount > 0) {
        map.set(r.algorithmId, {
          avgBps: Number(r.avgBps || 0),
          medianBps: Number(r.medianBps || 0),
          minBps: Number(r.minBps || 0),
          maxBps: Number(r.maxBps || 0),
          p95Bps: Number(r.p95Bps || 0),
          stdDevBps: Number(r.stdDevBps || 0),
          orderCount
        });
      }
    }

    return map;
  }

  private async getSlippageByTimeOfDay(
    filters: LiveTradeFiltersDto,
    dateRange: { startDate?: Date; endDate?: Date }
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
      hour: parseInt(r.hour || '0', 10),
      avgBps: Number(r.avgBps || 0),
      orderCount: parseInt(r.orderCount || '0', 10)
    }));
  }

  private async getSlippageByOrderSize(
    filters: LiveTradeFiltersDto,
    dateRange: { startDate?: Date; endDate?: Date }
  ): Promise<SlippageBySizeDto[]> {
    const bucketDefs = [
      { bucket: '$0-$100', min: 0, max: 100 },
      { bucket: '$100-$500', min: 100, max: 500 },
      { bucket: '$500-$1000', min: 500, max: 1000 },
      { bucket: '$1000-$5000', min: 1000, max: 5000 },
      { bucket: '$5000-$10000', min: 5000, max: 10000 },
      { bucket: '$10000+', min: 10000, max: 999999999 }
    ];

    // Single query with CASE WHEN buckets instead of 6 sequential queries
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
      resultMap.set(parseInt(r.bucketIndex, 10), {
        avgBps: Number(r.avgBps || 0),
        orderCount: parseInt(r.orderCount || '0', 10)
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
    dateRange: { startDate?: Date; endDate?: Date }
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
      avgBps: Number(r.avgBps || 0),
      orderCount: parseInt(r.orderCount || '0', 10),
      totalVolume: Number(r.totalVolume || 0)
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPER METHODS - User Activity
  // ─────────────────────────────────────────────────────────────────────────────

  private async getBatchUserOrderActivity(userIds: string[]): Promise<
    Map<
      string,
      {
        totalOrders: number;
        orders24h: number;
        orders7d: number;
        totalVolume: number;
        totalPnL: number;
        avgSlippageBps: number;
        lastOrderAt?: string;
      }
    >
  > {
    const map = new Map<
      string,
      {
        totalOrders: number;
        orders24h: number;
        orders7d: number;
        totalVolume: number;
        totalPnL: number;
        avgSlippageBps: number;
        lastOrderAt?: string;
      }
    >();
    if (userIds.length === 0) return map;

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const results = await this.orderRepo
      .createQueryBuilder('o')
      .select('o."userId"', 'userId')
      .addSelect('COUNT(*)', 'totalOrders')
      .addSelect(`COUNT(*) FILTER (WHERE o."createdAt" >= :oneDayAgo)`, 'orders24h')
      .addSelect(`COUNT(*) FILTER (WHERE o."createdAt" >= :sevenDaysAgo)`, 'orders7d')
      .addSelect('COALESCE(SUM(o.cost), 0)', 'totalVolume')
      .addSelect('COALESCE(SUM(o.gainLoss), 0)', 'totalPnL')
      .addSelect('COALESCE(AVG(o.actualSlippageBps), 0)', 'avgSlippageBps')
      .addSelect('MAX(o."createdAt")', 'lastOrderAt')
      .where('o."userId" IN (:...userIds)', { userIds })
      .andWhere('o.isAlgorithmicTrade = true')
      .setParameter('oneDayAgo', oneDayAgo)
      .setParameter('sevenDaysAgo', sevenDaysAgo)
      .groupBy('o."userId"')
      .getRawMany();

    for (const r of results) {
      map.set(r.userId, {
        totalOrders: parseInt(r.totalOrders || '0', 10),
        orders24h: parseInt(r.orders24h || '0', 10),
        orders7d: parseInt(r.orders7d || '0', 10),
        totalVolume: Number(r.totalVolume || 0),
        totalPnL: Number(r.totalPnL || 0),
        avgSlippageBps: Number(r.avgSlippageBps || 0),
        lastOrderAt: r.lastOrderAt ? new Date(r.lastOrderAt).toISOString() : undefined
      });
    }

    return map;
  }

  private async getBatchUserAlgorithmSummary(userIds: string[]): Promise<Map<string, UserAlgorithmSummaryDto[]>> {
    const map = new Map<string, UserAlgorithmSummaryDto[]>();
    if (userIds.length === 0) return map;

    // Get all activations for all users in one query
    const activations = await this.activationRepo.find({
      where: userIds.map((id) => ({ userId: id })),
      relations: ['algorithm']
    });

    if (activations.length === 0) return map;

    const activationIds = activations.map((aa) => aa.id);

    // Batch fetch order counts grouped by activation
    const orderCounts = await this.orderRepo
      .createQueryBuilder('o')
      .select('o.algorithmActivationId', 'activationId')
      .addSelect('COUNT(*)', 'orderCount')
      .where('o.algorithmActivationId IN (:...activationIds)', { activationIds })
      .andWhere('o.isAlgorithmicTrade = true')
      .groupBy('o.algorithmActivationId')
      .getRawMany();

    const orderCountMap = new Map<string, number>();
    for (const r of orderCounts) {
      orderCountMap.set(r.activationId, parseInt(r.orderCount || '0', 10));
    }

    // Batch fetch latest performance per activation
    const performances = await this.performanceRepo
      .createQueryBuilder('ap')
      .where('ap.algorithmActivationId IN (:...activationIds)', { activationIds })
      .andWhere(
        'ap.calculatedAt = (SELECT MAX(ap2."calculatedAt") FROM algorithm_performances ap2 WHERE ap2."algorithmActivationId" = ap."algorithmActivationId")'
      )
      .getMany();

    const perfMap = new Map<string, AlgorithmPerformance>();
    for (const p of performances) {
      perfMap.set(p.algorithmActivationId, p);
    }

    // Build summary per user
    for (const aa of activations) {
      const summary: UserAlgorithmSummaryDto = {
        activationId: aa.id,
        algorithmName: aa.algorithm?.name || 'Unknown',
        isActive: aa.isActive,
        totalOrders: orderCountMap.get(aa.id) || 0,
        roi: perfMap.get(aa.id)?.roi
      };

      const existing = map.get(aa.userId) || [];
      existing.push(summary);
      map.set(aa.userId, existing);
    }

    return map;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPER METHODS - Alerts
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Fetch base data needed for alert generation.
   * @param includeUser Whether to load user relations (needed for full alerts, not for counting)
   */
  private async fetchAlertBaseData(
    filters: LiveTradeFiltersDto,
    includeUser: boolean
  ): Promise<{
    activations: AlgorithmActivation[];
    perfMap: Map<string, AlgorithmPerformance>;
    backtestMap: Map<string, Backtest>;
  }> {
    const emptyResult = {
      activations: [],
      perfMap: new Map<string, AlgorithmPerformance>(),
      backtestMap: new Map<string, Backtest>()
    };

    const relations = includeUser ? ['algorithm', 'user'] : ['algorithm'];
    const activations = await this.activationRepo.find({
      where: { isActive: true },
      relations
    });

    const filteredActivations = activations.filter((a) => {
      if (filters.algorithmId && a.algorithmId !== filters.algorithmId) return false;
      if (filters.userId && a.userId !== filters.userId) return false;
      return true;
    });

    if (filteredActivations.length === 0) return emptyResult;

    // Batch fetch latest performance for all activations
    const activationIds = filteredActivations.map((a) => a.id);
    const performances = await this.performanceRepo
      .createQueryBuilder('ap')
      .where('ap.algorithmActivationId IN (:...activationIds)', { activationIds })
      .andWhere(
        'ap.calculatedAt = (SELECT MAX(ap2."calculatedAt") FROM algorithm_performances ap2 WHERE ap2."algorithmActivationId" = ap."algorithmActivationId")'
      )
      .getMany();

    const perfMap = new Map<string, AlgorithmPerformance>();
    for (const p of performances) {
      perfMap.set(p.algorithmActivationId, p);
    }

    // Batch fetch latest completed backtest per algorithm
    const algorithmIds = [...new Set(filteredActivations.map((a) => a.algorithmId))];
    const backtests = await this.backtestRepo
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.algorithm', 'a')
      .where('a.id IN (:...algorithmIds)', { algorithmIds })
      .andWhere('b.status = :status', { status: BacktestStatus.COMPLETED })
      .andWhere(
        'b.completedAt = (SELECT MAX(b2."completedAt") FROM backtests b2 WHERE b2."algorithmId" = a.id AND b2.status = :completedStatus)'
      )
      .setParameter('status', BacktestStatus.COMPLETED)
      .setParameter('completedStatus', BacktestStatus.COMPLETED)
      .getMany();

    const backtestMap = new Map<string, Backtest>();
    for (const b of backtests) {
      backtestMap.set(b.algorithm.id, b);
    }

    return { activations: filteredActivations, perfMap, backtestMap };
  }

  private async generateAllAlerts(filters: LiveTradeFiltersDto): Promise<PerformanceAlertDto[]> {
    const { activations, perfMap, backtestMap } = await this.fetchAlertBaseData(filters, true);

    const alerts: PerformanceAlertDto[] = [];
    for (const activation of activations) {
      const performance = perfMap.get(activation.id) || null;
      const backtest = backtestMap.get(activation.algorithmId) || null;

      const activationAlerts = this.generateAlertsForActivation(activation, performance, backtest);
      alerts.push(...activationAlerts);
    }

    // Sort by severity (critical first)
    const severityOrder = { [AlertSeverity.CRITICAL]: 0, [AlertSeverity.WARNING]: 1, [AlertSeverity.INFO]: 2 };
    alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return alerts;
  }

  private generateAlertsForActivation(
    activation: AlgorithmActivation,
    performance: AlgorithmPerformance | null,
    backtest: Backtest | null
  ): PerformanceAlertDto[] {
    const alerts: PerformanceAlertDto[] = [];
    const now = new Date().toISOString();

    // No performance data
    if (!performance) {
      alerts.push({
        id: `${activation.id}-no-perf`,
        type: AlertType.NO_ORDERS,
        severity: AlertSeverity.INFO,
        title: 'No Performance Data',
        message: `Algorithm "${activation.algorithm?.name}" has no performance data yet`,
        algorithmId: activation.algorithmId,
        algorithmName: activation.algorithm?.name || 'Unknown',
        algorithmActivationId: activation.id,
        userId: activation.userId,
        userEmail: activation.user?.email,
        liveValue: 0,
        threshold: 0,
        deviationPercent: 0,
        createdAt: now
      });
      return alerts;
    }

    // Check against backtest if available
    if (backtest) {
      // Sharpe Ratio
      if (performance.sharpeRatio !== null && backtest.sharpeRatio !== null) {
        const deviation = this.calculateDeviationPercent(performance.sharpeRatio, backtest.sharpeRatio);
        if (deviation < -DEFAULT_THRESHOLDS.sharpeRatioCritical) {
          alerts.push(
            this.createAlert(
              activation,
              AlertType.SHARPE_RATIO_LOW,
              AlertSeverity.CRITICAL,
              'Sharpe Ratio Critical',
              performance.sharpeRatio,
              backtest.sharpeRatio,
              DEFAULT_THRESHOLDS.sharpeRatioCritical,
              deviation
            )
          );
        } else if (deviation < -DEFAULT_THRESHOLDS.sharpeRatioWarning) {
          alerts.push(
            this.createAlert(
              activation,
              AlertType.SHARPE_RATIO_LOW,
              AlertSeverity.WARNING,
              'Sharpe Ratio Below Expected',
              performance.sharpeRatio,
              backtest.sharpeRatio,
              DEFAULT_THRESHOLDS.sharpeRatioWarning,
              deviation
            )
          );
        }
      }

      // Win Rate
      if (performance.winRate !== null && backtest.winRate !== null) {
        const deviation = this.calculateDeviationPercent(performance.winRate, backtest.winRate);
        if (deviation < -DEFAULT_THRESHOLDS.winRateCritical) {
          alerts.push(
            this.createAlert(
              activation,
              AlertType.WIN_RATE_LOW,
              AlertSeverity.CRITICAL,
              'Win Rate Critical',
              performance.winRate,
              backtest.winRate,
              DEFAULT_THRESHOLDS.winRateCritical,
              deviation
            )
          );
        } else if (deviation < -DEFAULT_THRESHOLDS.winRateWarning) {
          alerts.push(
            this.createAlert(
              activation,
              AlertType.WIN_RATE_LOW,
              AlertSeverity.WARNING,
              'Win Rate Below Expected',
              performance.winRate,
              backtest.winRate,
              DEFAULT_THRESHOLDS.winRateWarning,
              deviation
            )
          );
        }
      }

      // Max Drawdown (higher is worse)
      if (performance.maxDrawdown !== null && backtest.maxDrawdown !== null) {
        const deviation = this.calculateDeviationPercent(performance.maxDrawdown, backtest.maxDrawdown);
        if (deviation > DEFAULT_THRESHOLDS.maxDrawdownCritical) {
          alerts.push(
            this.createAlert(
              activation,
              AlertType.DRAWDOWN_HIGH,
              AlertSeverity.CRITICAL,
              'Max Drawdown Critical',
              performance.maxDrawdown,
              backtest.maxDrawdown,
              DEFAULT_THRESHOLDS.maxDrawdownCritical,
              deviation
            )
          );
        } else if (deviation > DEFAULT_THRESHOLDS.maxDrawdownWarning) {
          alerts.push(
            this.createAlert(
              activation,
              AlertType.DRAWDOWN_HIGH,
              AlertSeverity.WARNING,
              'Max Drawdown Above Expected',
              performance.maxDrawdown,
              backtest.maxDrawdown,
              DEFAULT_THRESHOLDS.maxDrawdownWarning,
              deviation
            )
          );
        }
      }

      // ROI/Total Return
      if (performance.roi !== null && backtest.totalReturn !== null) {
        const deviation = this.calculateDeviationPercent(performance.roi, backtest.totalReturn);
        if (deviation < -DEFAULT_THRESHOLDS.totalReturnCritical) {
          alerts.push(
            this.createAlert(
              activation,
              AlertType.RETURN_LOW,
              AlertSeverity.CRITICAL,
              'Return Critical',
              performance.roi,
              backtest.totalReturn,
              DEFAULT_THRESHOLDS.totalReturnCritical,
              deviation
            )
          );
        } else if (deviation < -DEFAULT_THRESHOLDS.totalReturnWarning) {
          alerts.push(
            this.createAlert(
              activation,
              AlertType.RETURN_LOW,
              AlertSeverity.WARNING,
              'Return Below Expected',
              performance.roi,
              backtest.totalReturn,
              DEFAULT_THRESHOLDS.totalReturnWarning,
              deviation
            )
          );
        }
      }
    }

    return alerts;
  }

  private createAlert(
    activation: AlgorithmActivation,
    type: AlertType,
    severity: AlertSeverity,
    title: string,
    liveValue: number,
    backtestValue: number,
    threshold: number,
    deviation: number
  ): PerformanceAlertDto {
    return {
      id: `${activation.id}-${type}`,
      type,
      severity,
      title,
      message: `Live value: ${liveValue?.toFixed(2)}, Backtest: ${backtestValue?.toFixed(2)}, Deviation: ${deviation?.toFixed(1)}%`,
      algorithmId: activation.algorithmId,
      algorithmName: activation.algorithm?.name || 'Unknown',
      algorithmActivationId: activation.id,
      userId: activation.userId,
      userEmail: activation.user?.email,
      liveValue,
      backtestValue,
      threshold,
      deviationPercent: deviation,
      createdAt: new Date().toISOString()
    };
  }

  private calculateDeviationPercent(liveValue: number, backtestValue: number): number {
    if (backtestValue === 0) {
      if (liveValue === 0) return 0;
      return liveValue > 0 ? 100 : -100;
    }
    return new Decimal(liveValue).minus(backtestValue).dividedBy(Math.abs(backtestValue)).times(100).toNumber();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPER METHODS - Utilities
  // ─────────────────────────────────────────────────────────────────────────────

  private getDateRange(filters: LiveTradeFiltersDto): { startDate?: Date; endDate?: Date } {
    return {
      startDate: filters.startDate ? new Date(filters.startDate) : undefined,
      endDate: filters.endDate ? new Date(filters.endDate) : undefined
    };
  }

  private convertToCsv(data: object[]): Buffer {
    if (data.length === 0) {
      return Buffer.from('');
    }

    const headers = Object.keys(data[0]);
    const csvRows: string[] = [headers.join(',')];

    for (const row of data) {
      const values = headers.map((h) => {
        const val = (row as Record<string, unknown>)[h];
        if (val === null || val === undefined) return '';
        let str = String(val);
        if (typeof val === 'string' && /^[=+\-@\t\r]/.test(str)) {
          str = `'${str}`;
        }
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      });
      csvRows.push(values.join(','));
    }

    return Buffer.from(csvRows.join('\n'), 'utf-8');
  }
}
