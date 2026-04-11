import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Decimal } from 'decimal.js';
import { Between, LessThan, Repository } from 'typeorm';

import { DeploymentMetricsService } from './deployment-metrics.service';
import { Deployment } from './entities/deployment.entity';
import { PerformanceMetric } from './entities/performance-metric.entity';
import { PositionTrackingService } from './position-tracking.service';

import { DrawdownCalculator } from '../common/metrics/drawdown.calculator';
import { annualizeVolatility } from '../common/metrics/metric-calculator';
import { SharpeRatioCalculator } from '../common/metrics/sharpe-ratio.calculator';
import { Order, OrderSide, OrderStatus } from '../order/order.entity';

/** Minimum data points required for meaningful risk metric calculation */
const MIN_RISK_DATA_POINTS = 2;

@Injectable()
export class PerformanceCalculationService {
  private readonly logger = new Logger(PerformanceCalculationService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(PerformanceMetric)
    private readonly performanceMetricRepo: Repository<PerformanceMetric>,
    private readonly positionTrackingService: PositionTrackingService,
    private readonly deploymentMetricsService: DeploymentMetricsService,
    private readonly sharpeCalculator: SharpeRatioCalculator,
    private readonly drawdownCalculator: DrawdownCalculator
  ) {}

  /**
   * Calculate and store real performance metrics for a deployment.
   * Queries actual trade data, computes daily/cumulative/risk metrics,
   * and saves via DeploymentMetricsService (which auto-syncs Deployment stats).
   */
  async calculateMetrics(deployment: Deployment, referenceDate?: Date): Promise<PerformanceMetric> {
    const userId = deployment.strategyConfig?.createdBy;
    if (!userId) {
      throw new Error(`Deployment ${deployment.id} has no createdBy user — skipping to avoid misleading zeros`);
    }

    const strategyConfigId = deployment.strategyConfigId;
    const ref = referenceDate ?? new Date();
    const today = ref.toISOString().split('T')[0];
    const dayStart = new Date(`${today}T00:00:00.000Z`);
    const dayEnd = new Date(`${today}T23:59:59.999Z`);

    // Fast-path: skip if metrics already calculated for today
    const existing = await this.performanceMetricRepo.findOne({
      where: { deploymentId: deployment.id, date: today }
    });
    if (existing) {
      this.logger.debug(`Metrics already calculated for deployment ${deployment.id} on ${today}`);
      return existing;
    }

    // 1. Get previous metric for cumulative carry-forward
    const previousMetric = await this.performanceMetricRepo.findOne({
      where: { deploymentId: deployment.id },
      order: { date: 'DESC' }
    });

    // 2. Query today's filled algorithmic orders (no earlier than deployment start)
    const effectiveStart = deployment.deployedAt && deployment.deployedAt > dayStart ? deployment.deployedAt : dayStart;
    const todaysOrders = await this.orderRepo.find({
      where: {
        strategyConfigId,
        isAlgorithmicTrade: true,
        status: OrderStatus.FILLED,
        createdAt: Between(effectiveStart, dayEnd)
      }
    });

    // 3. Calculate daily metrics
    const { dailyPnl, tradesCount, winningTrades, losingTrades } = this.calculateDailyMetrics(todaysOrders);

    // 4. Calculate portfolio value and daily return
    const { portfolioValue, totalCapitalDeployed } = await this.calculatePortfolioValue(
      deployment,
      previousMetric,
      strategyConfigId
    );
    const prevCumulativePnl = previousMetric ? new Decimal(previousMetric.cumulativePnl) : new Decimal(0);
    const dailyReturn = portfolioValue.gt(0) ? dailyPnl.div(portfolioValue).toNumber() : 0;

    // 5. Calculate cumulative metrics
    const cumulativePnl = prevCumulativePnl.plus(dailyPnl).toNumber();
    const prevCumReturn = previousMetric ? Number(previousMetric.cumulativeReturn) : 0;
    const cumulativeReturn = (1 + prevCumReturn) * (1 + dailyReturn) - 1;
    const prevCumTrades = previousMetric ? previousMetric.cumulativeTradesCount : 0;
    const cumulativeTradesCount = prevCumTrades + tradesCount;

    // 6. Calculate risk metrics from historical daily returns
    const { sharpeRatio, volatility, maxDrawdown, drawdown } = await this.calculateRiskMetrics(
      deployment.id,
      dailyReturn,
      today
    );

    // 7. Calculate cumulative trade statistics (all sells since deployment)
    const { winRate, profitFactor, avgWinAmount, avgLossAmount } = await this.calculateCumulativeTradeStats(
      strategyConfigId,
      deployment.deployedAt
    );

    // 8. Calculate position metrics
    const { openPositions, exposureAmount, utilization } = await this.calculatePositionMetrics(
      userId,
      strategyConfigId,
      portfolioValue
    );

    // 9. Save via DeploymentMetricsService (handles upsert + Deployment aggregate sync)
    return this.deploymentMetricsService.recordPerformanceMetric(deployment, {
      date: today,
      snapshotAt: new Date(),
      dailyPnl: dailyPnl.toNumber(),
      dailyReturn,
      cumulativePnl,
      cumulativeReturn,
      tradesCount,
      cumulativeTradesCount,
      winningTrades,
      losingTrades,
      sharpeRatio,
      volatility,
      maxDrawdown,
      drawdown,
      winRate,
      profitFactor,
      avgWinAmount,
      avgLossAmount,
      openPositions,
      exposureAmount,
      utilization,
      driftDetected: false,
      driftDetails: null,
      metadata: {
        calculatedAt: new Date().toISOString(),
        taskVersion: '2.0.0',
        totalCapitalDeployed: totalCapitalDeployed.toNumber()
      }
    });
  }

  /**
   * Compute daily P&L and trade counts from today's orders.
   */
  private calculateDailyMetrics(orders: Order[]): {
    dailyPnl: Decimal;
    tradesCount: number;
    winningTrades: number;
    losingTrades: number;
  } {
    let dailyPnl = new Decimal(0);
    let winningTrades = 0;
    let losingTrades = 0;

    for (const order of orders) {
      if (order.side === OrderSide.SELL) {
        const gl = new Decimal(order.gainLoss ?? 0);
        dailyPnl = dailyPnl.plus(gl);
        if (gl.gt(0)) winningTrades++;
        else if (gl.lt(0)) losingTrades++;
      }
    }

    return { dailyPnl, tradesCount: orders.length, winningTrades, losingTrades };
  }

  /**
   * Determine portfolio value for daily return calculation.
   * Uses totalCapitalDeployed from previous metric metadata, or computes from BUY orders.
   */
  private async calculatePortfolioValue(
    deployment: Deployment,
    previousMetric: PerformanceMetric | null,
    strategyConfigId: string
  ): Promise<{ portfolioValue: Decimal; totalCapitalDeployed: Decimal }> {
    let totalCapitalDeployed: Decimal;

    // Try to get from previous metric metadata
    const cachedCapital = previousMetric?.metadata?.totalCapitalDeployed;
    if (cachedCapital !== undefined && cachedCapital !== null) {
      totalCapitalDeployed = new Decimal(cachedCapital);
    } else {
      // Sum all BUY orders since deployment
      totalCapitalDeployed = await this.sumBuyOrderCost(strategyConfigId, deployment.deployedAt);
    }

    const prevCumulativePnl = previousMetric ? new Decimal(previousMetric.cumulativePnl) : new Decimal(0);
    const portfolioValue = totalCapitalDeployed.plus(prevCumulativePnl);

    return { portfolioValue, totalCapitalDeployed };
  }

  /**
   * Sum cost of all filled BUY orders since deployment start.
   */
  private async sumBuyOrderCost(strategyConfigId: string, deployedAt: Date | null): Promise<Decimal> {
    const query = this.orderRepo
      .createQueryBuilder('o')
      .select('COALESCE(SUM(o.price * o.executedQuantity), 0)', 'total')
      .where('o.strategyConfigId = :strategyConfigId', { strategyConfigId })
      .andWhere('o.isAlgorithmicTrade = true')
      .andWhere('o.status = :status', { status: OrderStatus.FILLED })
      .andWhere('o.side = :side', { side: OrderSide.BUY });

    if (deployedAt) {
      query.andWhere('o.createdAt >= :deployedAt', { deployedAt });
    }

    const result = await query.getRawOne();
    return new Decimal(result?.total ?? 0);
  }

  /**
   * Calculate Sharpe, volatility, drawdown from all historical daily returns for this deployment.
   */
  private async calculateRiskMetrics(
    deploymentId: string,
    todayReturn: number,
    today: string
  ): Promise<{
    sharpeRatio: number | null;
    volatility: number | null;
    maxDrawdown: number;
    drawdown: number;
  }> {
    // Fetch prior daily returns (strictly before today to avoid including future data during backfill)
    const priorMetrics = await this.performanceMetricRepo.find({
      where: { deploymentId, date: LessThan(today) },
      order: { date: 'ASC' },
      select: ['dailyReturn']
    });

    const dailyReturns = priorMetrics.map((m) => Number(m.dailyReturn));
    dailyReturns.push(todayReturn);

    if (dailyReturns.length < MIN_RISK_DATA_POINTS) {
      return { sharpeRatio: null, volatility: null, maxDrawdown: 0, drawdown: 0 };
    }

    const sharpeRatio = this.sharpeCalculator.calculate(dailyReturns, 0.02, 365);
    const volatility = annualizeVolatility(dailyReturns, 365);

    const ddResult = this.drawdownCalculator.calculateFromReturns(dailyReturns);

    return {
      sharpeRatio,
      volatility,
      maxDrawdown: ddResult.maxDrawdownPercentage / 100,
      drawdown: ddResult.currentDrawdownPercentage / 100
    };
  }

  /**
   * Calculate cumulative win rate, profit factor, avg win/loss from all SELL orders since deployment.
   */
  private async calculateCumulativeTradeStats(
    strategyConfigId: string,
    deployedAt: Date | null
  ): Promise<{
    winRate: number | null;
    profitFactor: number | null;
    avgWinAmount: number | null;
    avgLossAmount: number | null;
  }> {
    const query = this.orderRepo
      .createQueryBuilder('o')
      .where('o.strategyConfigId = :strategyConfigId', { strategyConfigId })
      .andWhere('o.isAlgorithmicTrade = true')
      .andWhere('o.status = :status', { status: OrderStatus.FILLED })
      .andWhere('o.side = :side', { side: OrderSide.SELL });

    if (deployedAt) {
      query.andWhere('o.createdAt >= :deployedAt', { deployedAt });
    }

    const result = await query
      .select('COUNT(*)', 'total')
      .addSelect('SUM(CASE WHEN o.gainLoss > 0 THEN 1 ELSE 0 END)', 'wins')
      .addSelect('SUM(CASE WHEN o.gainLoss < 0 THEN 1 ELSE 0 END)', 'losses')
      .addSelect('SUM(CASE WHEN o.gainLoss > 0 THEN o.gainLoss ELSE 0 END)', 'grossProfit')
      .addSelect('SUM(CASE WHEN o.gainLoss < 0 THEN ABS(o.gainLoss) ELSE 0 END)', 'grossLoss')
      .getRawOne();

    const total = parseInt(result?.total ?? '0', 10);
    if (total === 0) {
      return { winRate: null, profitFactor: null, avgWinAmount: null, avgLossAmount: null };
    }

    const wins = parseInt(result.wins ?? '0', 10);
    const losses = parseInt(result.losses ?? '0', 10);
    const grossProfit = new Decimal(result.grossProfit ?? 0);
    const grossLoss = new Decimal(result.grossLoss ?? 0);

    const winRate = wins / total;
    const profitFactor = grossLoss.gt(0) ? grossProfit.div(grossLoss).toNumber() : wins > 0 ? null : null;
    const avgWinAmount = wins > 0 ? grossProfit.div(wins).toNumber() : null;
    const avgLossAmount = losses > 0 ? grossLoss.div(losses).toNumber() : null;

    return { winRate, profitFactor, avgWinAmount, avgLossAmount };
  }

  /**
   * Calculate open position count, exposure, and utilization.
   */
  private async calculatePositionMetrics(
    userId: string,
    strategyConfigId: string,
    portfolioValue: Decimal
  ): Promise<{ openPositions: number; exposureAmount: number; utilization: number }> {
    try {
      const positions = await this.positionTrackingService.getPositions(userId, strategyConfigId);
      const openPositions = positions.filter((p) => Number(p.quantity) > 0);

      let exposure = new Decimal(0);
      for (const pos of openPositions) {
        exposure = exposure.plus(new Decimal(pos.quantity).times(pos.avgEntryPrice));
      }

      const utilization = portfolioValue.gt(0) ? Math.min(exposure.div(portfolioValue).toNumber(), 1) : 0;

      return {
        openPositions: openPositions.length,
        exposureAmount: exposure.toNumber(),
        utilization
      };
    } catch {
      this.logger.warn(`Failed to fetch positions for user ${userId}, strategy ${strategyConfigId}`);
      return { openPositions: 0, exposureAmount: 0, utilization: 0 };
    }
  }
}
