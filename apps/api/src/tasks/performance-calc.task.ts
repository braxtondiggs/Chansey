import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { toErrorInfo } from '../shared/error.util';
import { Deployment } from '../strategy/entities/deployment.entity';
import { PerformanceCalculationService } from '../strategy/performance-calculation.service';

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
 * 2. Delegate to PerformanceCalculationService for real metric calculation
 * 3. Metrics are saved via DeploymentMetricsService (auto-syncs Deployment stats)
 */
@Injectable()
export class PerformanceCalcTask {
  private readonly logger = new Logger(PerformanceCalcTask.name);

  constructor(
    @InjectRepository(Deployment)
    private readonly deploymentRepo: Repository<Deployment>,
    private readonly performanceCalculationService: PerformanceCalculationService
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
      const now = new Date();
      const referenceDate = new Date(now);
      referenceDate.setDate(referenceDate.getDate() - 1);

      // Calculate metrics for each deployment
      for (const deployment of deployments) {
        try {
          await this.performanceCalculationService.calculateMetrics(deployment, referenceDate);
          successCount++;
        } catch (error: unknown) {
          errorsCount++;
          const err = toErrorInfo(error);
          this.logger.error(`Error calculating metrics for deployment ${deployment.id}: ${err.message}`, err.stack);
        }
      }

      this.logger.log(`Performance metric calculation completed: ${successCount} succeeded, ${errorsCount} errors`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Performance calculation task failed: ${err.message}`, err.stack);
      throw error;
    }
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

      await this.performanceCalculationService.calculateMetrics(deployment);
      this.logger.log(`Performance metrics calculated for deployment ${deploymentId}`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Error calculating metrics for deployment ${deploymentId}: ${err.message}`, err.stack);
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
