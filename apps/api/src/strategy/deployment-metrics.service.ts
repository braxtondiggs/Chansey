import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { type FindOptionsWhere, Between, LessThan, MoreThan, type QueryDeepPartialEntity, Repository } from 'typeorm';

import { Deployment } from './entities/deployment.entity';
import { PerformanceMetric } from './entities/performance-metric.entity';

import { toErrorInfo } from '../shared/error.util';

@Injectable()
export class DeploymentMetricsService {
  private readonly logger = new Logger(DeploymentMetricsService.name);

  constructor(
    @InjectRepository(Deployment)
    private readonly deploymentRepo: Repository<Deployment>,
    @InjectRepository(PerformanceMetric)
    private readonly performanceMetricRepo: Repository<PerformanceMetric>
  ) {}

  /**
   * Record daily performance snapshot
   */
  async recordPerformanceMetric(
    deployment: Deployment,
    metricData: Partial<PerformanceMetric>
  ): Promise<PerformanceMetric> {
    const date = metricData.date || new Date().toISOString().split('T')[0];

    // Check if metric already exists for this date
    const existing = await this.performanceMetricRepo.findOne({
      where: { deploymentId: deployment.id, date }
    });

    if (existing) {
      // Update existing record
      Object.assign(existing, metricData);
      existing.snapshotAt = new Date();
      const saved = await this.performanceMetricRepo.save(existing);

      // Update deployment aggregate stats
      try {
        await this.updateDeploymentStats(deployment, metricData);
      } catch (statsError: unknown) {
        const err = toErrorInfo(statsError);
        this.logger.error(`Failed to update deployment stats for ${deployment.id}: ${err.message}`);
      }

      return saved;
    }

    // Create new record
    const metric = this.performanceMetricRepo.create({
      deploymentId: deployment.id,
      date,
      snapshotAt: new Date(),
      ...metricData
    });

    const saved = await this.performanceMetricRepo.save(metric);

    // Update deployment aggregate stats
    try {
      await this.updateDeploymentStats(deployment, metricData);
    } catch (statsError: unknown) {
      const err = toErrorInfo(statsError);
      this.logger.error(`Failed to update deployment stats for ${deployment.id}: ${err.message}`);
    }

    return saved;
  }

  /**
   * Update deployment aggregate statistics from latest metrics
   */
  async updateDeploymentStats(deployment: Deployment, latestMetric: Partial<PerformanceMetric>): Promise<void> {
    const updates: Partial<Deployment> = {};

    if (latestMetric.cumulativePnl !== undefined) {
      updates.realizedPnl = Number(latestMetric.cumulativePnl);
    }

    if (latestMetric.drawdown !== undefined) {
      updates.currentDrawdown = Number(latestMetric.drawdown);
    }

    if (latestMetric.maxDrawdown !== undefined && Number(latestMetric.maxDrawdown) > deployment.maxDrawdownObserved) {
      updates.maxDrawdownObserved = Number(latestMetric.maxDrawdown);
    }

    if (latestMetric.cumulativeTradesCount !== undefined) {
      updates.totalTrades = latestMetric.cumulativeTradesCount;
    }

    if (latestMetric.sharpeRatio !== undefined) {
      updates.liveSharpeRatio = Number(latestMetric.sharpeRatio);
    }

    if (latestMetric.driftDetected) {
      updates.lastDriftDetectedAt = new Date();
      updates.driftMetrics = latestMetric.driftDetails || null;
    }

    if (Object.keys(updates).length > 0) {
      await this.deploymentRepo.update(deployment.id, updates as QueryDeepPartialEntity<Deployment>);
    }

    // Atomically increment drift counter to avoid read-modify-write race
    if (latestMetric.driftDetected) {
      await this.deploymentRepo
        .createQueryBuilder()
        .update(Deployment)
        .set({ driftAlertCount: () => '"driftAlertCount" + 1' })
        .where('id = :id', { id: deployment.id })
        .execute();
    }
  }

  /**
   * Get performance metrics for a deployment
   */
  async getPerformanceMetrics(
    deploymentId: string,
    startDate?: string,
    endDate?: string
  ): Promise<PerformanceMetric[]> {
    const where: FindOptionsWhere<PerformanceMetric> = { deploymentId };

    if (startDate && endDate) {
      where.date = Between(startDate, endDate);
    } else if (startDate) {
      where.date = MoreThan(startDate);
    } else if (endDate) {
      where.date = LessThan(endDate);
    }

    return await this.performanceMetricRepo.find({
      where,
      order: { date: 'ASC' }
    });
  }

  /**
   * Get latest performance metric for a deployment
   */
  async getLatestPerformanceMetric(deploymentId: string): Promise<PerformanceMetric | null> {
    return await this.performanceMetricRepo.findOne({
      where: { deploymentId },
      order: { date: 'DESC' }
    });
  }

  /**
   * Get deployments approaching risk limits
   */
  getDeploymentsAtRisk(activeDeployments: Deployment[]): Deployment[] {
    return activeDeployments.filter((d) => {
      const drawdownThreshold = Number(d.maxDrawdownLimit) * 0.8;
      return Number(d.currentDrawdown) >= drawdownThreshold;
    });
  }
}
