import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository, Between } from 'typeorm';

import { DeploymentService } from '../strategy/deployment.service';
import { Deployment } from '../strategy/entities/deployment.entity';
import { PerformanceMetric } from '../strategy/entities/performance-metric.entity';

/**
 * MonitoringService
 *
 * Tracks and analyzes performance metrics for deployed strategies.
 *
 * Responsibilities:
 * - Calculate daily performance metrics
 * - Track cumulative performance since deployment
 * - Compute rolling statistics (volatility, Sharpe, etc.)
 * - Provide performance snapshots for drift detection
 * - Generate performance reports and comparisons
 */
@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    @InjectRepository(PerformanceMetric)
    private readonly performanceMetricRepo: Repository<PerformanceMetric>,
    @InjectRepository(Deployment)
    private readonly deploymentRepo: Repository<Deployment>,
    private readonly deploymentService: DeploymentService
  ) {}

  /**
   * Get performance metrics for a deployment
   */
  async getPerformanceMetrics(
    deploymentId: string,
    startDate?: string,
    endDate?: string
  ): Promise<PerformanceMetric[]> {
    const where: any = { deploymentId };

    if (startDate && endDate) {
      where.date = Between(startDate, endDate);
    }

    return await this.performanceMetricRepo.find({
      where,
      order: { date: 'ASC' }
    });
  }

  /**
   * Get latest performance metric for a deployment
   */
  async getLatestMetric(deploymentId: string): Promise<PerformanceMetric | null> {
    return await this.performanceMetricRepo.findOne({
      where: { deploymentId },
      order: { date: 'DESC' }
    });
  }

  /**
   * Calculate performance summary for a deployment
   */
  async getPerformanceSummary(deploymentId: string): Promise<any> {
    const deployment = await this.deploymentService.findOne(deploymentId);
    const latestMetric = await this.getLatestMetric(deploymentId);
    const allMetrics = await this.getPerformanceMetrics(deploymentId);

    if (!latestMetric || allMetrics.length === 0) {
      return {
        deploymentId,
        status: 'no_data',
        message: 'No performance data available yet'
      };
    }

    // Calculate summary statistics
    const totalDays = allMetrics.length;
    const profitableDays = allMetrics.filter((m) => Number(m.dailyPnl) > 0).length;
    const losingDays = allMetrics.filter((m) => Number(m.dailyPnl) < 0).length;

    const avgDailyReturn = allMetrics.reduce((sum, m) => sum + Number(m.dailyReturn), 0) / totalDays;

    const bestDay = allMetrics.reduce(
      (best, m) => (Number(m.dailyReturn) > Number(best.dailyReturn) ? m : best),
      allMetrics[0]
    );

    const worstDay = allMetrics.reduce(
      (worst, m) => (Number(m.dailyReturn) < Number(worst.dailyReturn) ? m : worst),
      allMetrics[0]
    );

    return {
      deploymentId,
      strategyName: deployment.strategyConfig.name,
      status: deployment.status,
      daysLive: deployment.daysLive,

      // Performance Summary
      cumulativeReturn: Number(latestMetric.cumulativeReturn),
      cumulativePnl: Number(latestMetric.cumulativePnl),
      currentDrawdown: Number(latestMetric.drawdown),
      maxDrawdown: Number(latestMetric.maxDrawdown),
      sharpeRatio: Number(latestMetric.sharpeRatio),
      volatility: Number(latestMetric.volatility),

      // Trade Statistics
      totalTrades: latestMetric.cumulativeTradesCount,
      winRate: Number(latestMetric.winRate),
      profitFactor: Number(latestMetric.profitFactor),

      // Daily Statistics
      totalDays,
      profitableDays,
      losingDays,
      profitableDaysPercent: (profitableDays / totalDays) * 100,
      avgDailyReturn,
      bestDay: {
        date: bestDay.date,
        return: Number(bestDay.dailyReturn),
        pnl: Number(bestDay.dailyPnl)
      },
      worstDay: {
        date: worstDay.date,
        return: Number(worstDay.dailyReturn),
        pnl: Number(worstDay.dailyPnl)
      },

      // Current Position
      openPositions: latestMetric.openPositions,
      exposureAmount: Number(latestMetric.exposureAmount),
      utilization: Number(latestMetric.utilization),

      // Drift Flags
      driftDetected: latestMetric.driftDetected,
      driftDetails: latestMetric.driftDetails,

      // Latest Update
      lastUpdated: latestMetric.snapshotAt
    };
  }

  /**
   * Compare live performance to backtest expectations
   */
  async compareToBacktest(deploymentId: string): Promise<any> {
    const deployment = await this.deploymentService.findOne(deploymentId);
    const latestMetric = await this.getLatestMetric(deploymentId);

    if (!latestMetric) {
      throw new NotFoundException('No performance metrics available for comparison');
    }

    // Get backtest expectations from deployment metadata
    const backtestSharpe = deployment.metadata?.backtestSharpe || null;
    const backtestMaxDrawdown = deployment.metadata?.backtestMaxDrawdown || null;
    const backtestVolatility = deployment.metadata?.backtestVolatility || null;

    const liveSharpe = Number(latestMetric.sharpeRatio);
    const liveMaxDrawdown = Number(latestMetric.maxDrawdown);
    const liveVolatility = Number(latestMetric.volatility);

    return {
      deploymentId,
      comparison: {
        sharpeRatio: {
          backtest: backtestSharpe,
          live: liveSharpe,
          degradation: backtestSharpe ? ((backtestSharpe - liveSharpe) / backtestSharpe) * 100 : null,
          status: this.getComparisonStatus(backtestSharpe, liveSharpe, 0.5)
        },
        maxDrawdown: {
          backtest: backtestMaxDrawdown,
          live: liveMaxDrawdown,
          exceedance: backtestMaxDrawdown
            ? ((liveMaxDrawdown - backtestMaxDrawdown) / backtestMaxDrawdown) * 100
            : null,
          status: this.getComparisonStatus(backtestMaxDrawdown, liveMaxDrawdown, -0.5, true)
        },
        volatility: {
          backtest: backtestVolatility,
          live: liveVolatility,
          spike: backtestVolatility ? ((liveVolatility - backtestVolatility) / backtestVolatility) * 100 : null,
          status: this.getComparisonStatus(backtestVolatility, liveVolatility, -1.0, true)
        }
      },
      overallStatus: this.determineOverallStatus(deployment, latestMetric),
      daysLive: deployment.daysLive
    };
  }

  /**
   * Get rolling statistics for a deployment
   */
  async getRollingStatistics(deploymentId: string, windowDays = 30): Promise<any> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - windowDays);

    const metrics = await this.getPerformanceMetrics(
      deploymentId,
      startDate.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0]
    );

    if (metrics.length === 0) {
      return null;
    }

    // Calculate rolling statistics
    const returns = metrics.map((m) => Number(m.dailyReturn));
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const annualizedVol = stdDev * Math.sqrt(252); // 252 trading days
    const annualizedReturn = avgReturn * 252;
    const sharpe = annualizedVol > 0 ? annualizedReturn / annualizedVol : 0;

    return {
      windowDays,
      dataPoints: metrics.length,
      avgDailyReturn: avgReturn,
      volatility: annualizedVol,
      sharpeRatio: sharpe,
      totalReturn: metrics[metrics.length - 1].cumulativeReturn,
      maxDrawdown: Math.min(...metrics.map((m) => Number(m.drawdown))),
      winRate: metrics.filter((m) => Number(m.dailyPnl) > 0).length / metrics.length
    };
  }

  /**
   * Get performance trend (improving/degrading/stable)
   */
  async getPerformanceTrend(deploymentId: string): Promise<string> {
    const recent = await this.getRollingStatistics(deploymentId, 7); // Last 7 days
    const historical = await this.getRollingStatistics(deploymentId, 30); // Last 30 days

    if (!recent || !historical) {
      return 'insufficient_data';
    }

    const sharpeChange = recent.sharpeRatio - historical.sharpeRatio;
    const returnChange = recent.avgDailyReturn - historical.avgDailyReturn;

    if (sharpeChange > 0.2 && returnChange > 0) {
      return 'improving';
    } else if (sharpeChange < -0.2 && returnChange < 0) {
      return 'degrading';
    } else {
      return 'stable';
    }
  }

  /**
   * Helper: Get comparison status
   */
  private getComparisonStatus(
    expected: number | null,
    actual: number,
    threshold: number,
    lowerIsBetter = false
  ): string {
    if (expected === null) return 'no_baseline';

    const change = (actual - expected) / expected;

    if (lowerIsBetter) {
      if (change > Math.abs(threshold)) return 'worse';
      if (change < -Math.abs(threshold)) return 'better';
    } else {
      if (change < threshold) return 'worse';
      if (change > -threshold) return 'better';
    }

    return 'similar';
  }

  /**
   * Helper: Determine overall status
   */
  private determineOverallStatus(deployment: Deployment, latestMetric: PerformanceMetric): string {
    if (latestMetric.driftDetected) return 'drifting';
    if (Number(latestMetric.drawdown) >= Number(deployment.maxDrawdownLimit) * 0.8) return 'at_risk';
    if (Number(latestMetric.cumulativeReturn) < 0) return 'losing';
    if (Number(latestMetric.sharpeRatio) > 1.5) return 'excellent';
    if (Number(latestMetric.sharpeRatio) > 1.0) return 'good';
    return 'acceptable';
  }
}
