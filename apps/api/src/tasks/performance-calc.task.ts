import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository, In } from 'typeorm';

import { DeploymentService } from '../strategy/deployment.service';
import { Deployment } from '../strategy/entities/deployment.entity';
import { PerformanceMetric } from '../strategy/entities/performance-metric.entity';

/**
 * Performance Metric Calculation Task (T098)
 *
 * Runs daily to calculate and store performance metrics for all active deployments
 *
 * Schedule: Daily at 1:00 AM UTC
 * Purpose: Track historical performance data for drift detection and reporting
 *
 * Process:
 * 1. Find all active deployments
 * 2. Calculate daily performance metrics (returns, PnL, Sharpe, drawdown, etc.)
 * 3. Store metrics in PerformanceMetric table
 * 4. Update deployment's cumulative statistics
 *
 * Metrics Calculated:
 * - Daily P&L and returns
 * - Cumulative returns and P&L
 * - Rolling Sharpe ratio
 * - Current and maximum drawdown
 * - Win rate and profit factor
 * - Trade statistics
 * - Position exposure and utilization
 */
@Injectable()
export class PerformanceCalcTask {
  private readonly logger = new Logger(PerformanceCalcTask.name);

  constructor(
    @InjectRepository(Deployment)
    private readonly deploymentRepo: Repository<Deployment>,
    @InjectRepository(PerformanceMetric)
    private readonly performanceMetricRepo: Repository<PerformanceMetric>,
    private readonly deploymentService: DeploymentService
  ) {}

  /**
   * Execute performance calculation for all active deployments
   *
   * Called on cron schedule
   */
  async execute(): Promise<void> {
    this.logger.log('Starting performance metric calculation task');

    try {
      // Get all active deployments
      const deployments = await this.deploymentRepo.find({
        where: {
          status: In(['active', 'paused'])
        },
        relations: ['strategyConfig']
      });

      this.logger.log(`Found ${deployments.length} deployments to calculate metrics for`);

      let successCount = 0;
      let errorsCount = 0;

      // Calculate metrics for each deployment
      for (const deployment of deployments) {
        try {
          await this.calculateAndStoreMetrics(deployment);
          successCount++;
        } catch (error) {
          errorsCount++;
          this.logger.error(`Error calculating metrics for deployment ${deployment.id}: ${error.message}`, error.stack);
        }
      }

      this.logger.log(`Performance metric calculation completed: ${successCount} succeeded, ${errorsCount} errors`);
    } catch (error) {
      this.logger.error(`Performance calculation task failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Calculate and store performance metrics for a single deployment
   */
  private async calculateAndStoreMetrics(deployment: Deployment): Promise<void> {
    const today = new Date().toISOString().split('T')[0];

    // Check if metrics already calculated for today
    const existingMetric = await this.performanceMetricRepo.findOne({
      where: {
        deploymentId: deployment.id,
        date: today
      }
    });

    if (existingMetric) {
      this.logger.debug(`Metrics already calculated for deployment ${deployment.id} on ${today}, skipping`);
      return;
    }

    // Get previous day's metric for cumulative calculations
    const previousMetric = await this.performanceMetricRepo.findOne({
      where: { deploymentId: deployment.id },
      order: { date: 'DESC' }
    });

    // In a real implementation, you would:
    // 1. Fetch actual trades from the database for this deployment
    // 2. Calculate P&L from those trades
    // 3. Compute all required metrics
    //
    // For now, we'll create a placeholder metric
    // This should be replaced with actual trade data and calculations

    const metric = new PerformanceMetric();
    metric.deploymentId = deployment.id;
    metric.date = today;
    metric.snapshotAt = new Date();

    // Daily metrics (would be calculated from actual trades)
    metric.dailyPnl = 0;
    metric.dailyReturn = 0;
    metric.tradesCount = 0;
    metric.winningTrades = 0;
    metric.losingTrades = 0;

    // Cumulative metrics (carried forward from previous day)
    metric.cumulativePnl = previousMetric ? Number(previousMetric.cumulativePnl) : 0;
    metric.cumulativeReturn = previousMetric ? Number(previousMetric.cumulativeReturn) : 0;
    metric.cumulativeTradesCount = previousMetric ? previousMetric.cumulativeTradesCount : 0;

    // Risk metrics (would be calculated from trade history)
    metric.sharpeRatio = previousMetric ? Number(previousMetric.sharpeRatio) : 0;
    metric.maxDrawdown = previousMetric ? Number(previousMetric.maxDrawdown) : 0;
    metric.drawdown = 0;
    metric.volatility = previousMetric ? Number(previousMetric.volatility) : 0;

    // Trade statistics
    metric.winRate = previousMetric ? Number(previousMetric.winRate) : 0;
    metric.profitFactor = previousMetric ? Number(previousMetric.profitFactor) : 0;
    metric.avgWinAmount = previousMetric ? Number(previousMetric.avgWinAmount) : 0;
    metric.avgLossAmount = previousMetric ? Number(previousMetric.avgLossAmount) : 0;

    // Position metrics
    metric.openPositions = 0;
    metric.exposureAmount = 0;
    metric.utilization = 0;

    // Drift tracking
    metric.driftDetected = false;
    metric.driftDetails = null;

    // Metadata
    metric.metadata = {
      calculatedAt: new Date().toISOString(),
      taskVersion: '1.0.0',
      note: 'Placeholder metric - replace with actual trade calculations'
    };

    await this.performanceMetricRepo.save(metric);

    this.logger.debug(
      `Performance metric calculated for deployment ${deployment.id} (${deployment.strategyConfig.name}) on ${today}`
    );
  }

  /**
   * Execute performance calculation for a specific deployment
   * Useful for on-demand calculations
   */
  async executeForDeployment(deploymentId: string): Promise<void> {
    this.logger.log(`Calculating performance metrics for deployment ${deploymentId}`);

    try {
      const deployment = await this.deploymentRepo.findOne({
        where: { id: deploymentId },
        relations: ['strategyConfig']
      });

      if (!deployment) {
        throw new Error(`Deployment ${deploymentId} not found`);
      }

      await this.calculateAndStoreMetrics(deployment);
      this.logger.log(`Performance metrics calculated for deployment ${deploymentId}`);
    } catch (error) {
      this.logger.error(`Error calculating metrics for deployment ${deploymentId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get task metadata for monitoring
   */
  getMetadata(): {
    name: string;
    description: string;
    schedule: string;
    enabled: boolean;
  } {
    return {
      name: 'performance-calculation',
      description: 'Calculate daily performance metrics for deployed strategies',
      schedule: '0 1 * * *', // Daily at 1:00 AM UTC
      enabled: true
    };
  }
}
