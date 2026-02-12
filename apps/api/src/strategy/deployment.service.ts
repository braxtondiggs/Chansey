import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { LessThan, MoreThan, Repository } from 'typeorm';

import { AuditEventType, DeploymentStatus } from '@chansey/api-interfaces';

import { Deployment } from './entities/deployment.entity';
import { PerformanceMetric } from './entities/performance-metric.entity';
import { StrategyConfig } from './entities/strategy-config.entity';
import { StrategyScore } from './entities/strategy-score.entity';

import { AuditService } from '../audit/audit.service';

/**
 * DeploymentService
 *
 * Manages the lifecycle of strategy deployments:
 * - Creating new deployments with risk limits
 * - Promoting strategies to live trading
 * - Pausing/resuming deployments
 * - Demoting underperforming strategies
 * - Tracking live performance metrics
 *
 * Integrates with promotion gates and risk management systems.
 */
@Injectable()
export class DeploymentService {
  private readonly logger = new Logger(DeploymentService.name);

  constructor(
    @InjectRepository(Deployment)
    private readonly deploymentRepo: Repository<Deployment>,
    @InjectRepository(PerformanceMetric)
    private readonly performanceMetricRepo: Repository<PerformanceMetric>,
    @InjectRepository(StrategyConfig)
    private readonly strategyConfigRepo: Repository<StrategyConfig>,
    @InjectRepository(StrategyScore)
    private readonly strategyScoreRepo: Repository<StrategyScore>,
    private readonly auditService: AuditService
  ) {}

  /**
   * Create a new deployment for a strategy
   * Called after promotion gates pass
   */
  async createDeployment(
    strategyConfigId: string,
    allocationPercent: number,
    promotionReason: string,
    approvedBy?: string
  ): Promise<Deployment> {
    try {
      // Verify strategy exists and is eligible
      const strategyConfig = await this.strategyConfigRepo.findOne({
        where: { id: strategyConfigId },
        relations: ['algorithm']
      });

      if (!strategyConfig) {
        throw new NotFoundException(`StrategyConfig ${strategyConfigId} not found`);
      }

      // Get latest score to determine risk limits
      const latestScore = await this.strategyScoreRepo.findOne({
        where: { strategyConfigId },
        order: { calculatedAt: 'DESC' }
      });

      if (!latestScore || !latestScore.promotionEligible) {
        throw new BadRequestException('Strategy is not eligible for deployment');
      }

      // Validate component scores exist before accessing nested properties
      if (!latestScore.componentScores?.sharpeRatio) {
        throw new BadRequestException('Strategy score data is incomplete - missing Sharpe ratio component');
      }

      // Check if already deployed
      const existingDeployment = await this.deploymentRepo.findOne({
        where: {
          strategyConfigId,
          status: DeploymentStatus.ACTIVE
        }
      });

      if (existingDeployment) {
        throw new BadRequestException('Strategy already has an active deployment');
      }

      // Check portfolio capacity (max 35 active strategies)
      const activeCount = await this.deploymentRepo.count({
        where: { status: DeploymentStatus.ACTIVE }
      });

      if (activeCount >= 35) {
        throw new BadRequestException('Maximum active deployments (35) reached');
      }

      // Calculate risk limits from backtest metrics with 1.5x safety margin for drawdown
      const sharpeValue = Number(latestScore.componentScores.sharpeRatio.value ?? 0.4);
      const maxDrawdownLimit = Math.min(sharpeValue * 1.5, 0.4); // Cap at 40%

      // Create deployment with conservative risk limits
      const deployment = this.deploymentRepo.create({
        strategyConfigId,
        status: DeploymentStatus.PENDING_APPROVAL,
        allocationPercent,
        initialAllocationPercent: allocationPercent,
        maxDrawdownLimit,
        dailyLossLimit: 0.05, // 5% daily loss limit
        positionSizeLimit: 0.1, // 10% position size limit
        maxLeverage: strategyConfig.parameters?.maxLeverage || null,
        promotionReason,
        approvedBy,
        approvedAt: approvedBy ? new Date() : null,
        metadata: {
          backtestScore: latestScore.overallScore,
          backtestGrade: latestScore.grade,
          backtestMaxDrawdown: latestScore.componentScores.sharpeRatio.value
        }
      });

      const savedDeployment = await this.deploymentRepo.save(deployment);

      // Audit log - wrapped in try-catch to prevent audit failures from breaking deployment
      try {
        await this.auditService.createAuditLog({
          eventType: AuditEventType.STRATEGY_PROMOTED,
          entityType: 'Deployment',
          entityId: savedDeployment.id,
          userId: approvedBy,
          beforeState: null,
          afterState: {
            strategyConfigId,
            allocationPercent,
            status: DeploymentStatus.PENDING_APPROVAL,
            maxDrawdownLimit,
            promotionReason
          },
          metadata: {
            strategyName: strategyConfig.name,
            algorithmName: strategyConfig.algorithm?.name,
            score: latestScore.overallScore,
            grade: latestScore.grade
          }
        });
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for deployment ${savedDeployment.id}: ${auditError.message}`);
      }

      this.logger.log(
        `Created deployment ${savedDeployment.id} for strategy ${strategyConfig.name} ` +
          `with ${allocationPercent}% allocation`
      );

      return savedDeployment;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Failed to create deployment for strategy ${strategyConfigId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to create deployment due to an internal error');
    }
  }

  /**
   * Activate a deployment (move from pending to active)
   */
  async activateDeployment(deploymentId: string, userId?: string): Promise<Deployment> {
    try {
      const deployment = await this.findOne(deploymentId);

      if (deployment.status !== DeploymentStatus.PENDING_APPROVAL) {
        throw new BadRequestException(`Deployment must be in pending_approval status to activate`);
      }

      const beforeState = { ...deployment };

      deployment.status = DeploymentStatus.ACTIVE;
      deployment.deployedAt = new Date();

      const activated = await this.deploymentRepo.save(deployment);

      // Update strategy config status
      await this.strategyConfigRepo.update(deployment.strategyConfigId, {
        status: 'live' as any
      });

      // Audit log
      try {
        await this.auditService.createAuditLog({
          eventType: AuditEventType.DEPLOYMENT_ACTIVATED,
          entityType: 'Deployment',
          entityId: deploymentId,
          userId,
          beforeState,
          afterState: activated,
          metadata: { deployedAt: activated.deployedAt }
        });
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for activation ${deploymentId}: ${auditError.message}`);
      }

      this.logger.log(`Activated deployment ${deploymentId}`);

      return activated;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Failed to activate deployment ${deploymentId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to activate deployment due to an internal error');
    }
  }

  /**
   * Pause a deployment (manual intervention)
   */
  async pauseDeployment(deploymentId: string, reason: string, userId?: string): Promise<Deployment> {
    try {
      const deployment = await this.findOne(deploymentId);

      if (!deployment.isActive) {
        throw new BadRequestException('Only active deployments can be paused');
      }

      const beforeState = { ...deployment };

      deployment.status = DeploymentStatus.PAUSED;
      deployment.metadata = {
        ...deployment.metadata,
        pausedAt: new Date(),
        pauseReason: reason
      };

      const paused = await this.deploymentRepo.save(deployment);

      // Audit log
      try {
        await this.auditService.createAuditLog({
          eventType: AuditEventType.DEPLOYMENT_PAUSED,
          entityType: 'Deployment',
          entityId: deploymentId,
          userId,
          beforeState,
          afterState: paused,
          metadata: { reason }
        });
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for pause ${deploymentId}: ${auditError.message}`);
      }

      this.logger.warn(`Paused deployment ${deploymentId}: ${reason}`);

      return paused;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Failed to pause deployment ${deploymentId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to pause deployment due to an internal error');
    }
  }

  /**
   * Resume a paused deployment
   */
  async resumeDeployment(deploymentId: string, userId?: string): Promise<Deployment> {
    try {
      const deployment = await this.findOne(deploymentId);

      if (!deployment.isPaused) {
        throw new BadRequestException('Only paused deployments can be resumed');
      }

      const beforeState = { ...deployment };

      deployment.status = DeploymentStatus.ACTIVE;
      deployment.metadata = {
        ...deployment.metadata,
        resumedAt: new Date()
      };

      const resumed = await this.deploymentRepo.save(deployment);

      // Audit log
      try {
        await this.auditService.createAuditLog({
          eventType: AuditEventType.DEPLOYMENT_RESUMED,
          entityType: 'Deployment',
          entityId: deploymentId,
          userId,
          beforeState,
          afterState: resumed
        });
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for resume ${deploymentId}: ${auditError.message}`);
      }

      this.logger.log(`Resumed deployment ${deploymentId}`);

      return resumed;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Failed to resume deployment ${deploymentId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to resume deployment due to an internal error');
    }
  }

  /**
   * Demote a deployment (automatic due to performance/risk)
   */
  async demoteDeployment(deploymentId: string, reason: string, metadata?: Record<string, any>): Promise<Deployment> {
    try {
      const deployment = await this.findOne(deploymentId);

      const beforeState = { ...deployment };

      deployment.status = DeploymentStatus.DEMOTED;
      deployment.terminatedAt = new Date();
      deployment.terminationReason = reason;
      deployment.metadata = {
        ...deployment.metadata,
        demotionMetadata: metadata
      };

      const demoted = await this.deploymentRepo.save(deployment);

      // Update strategy config status
      await this.strategyConfigRepo.update(deployment.strategyConfigId, {
        status: 'deprecated' as any
      });

      // Audit log
      try {
        await this.auditService.createAuditLog({
          eventType: AuditEventType.STRATEGY_DEMOTED,
          entityType: 'Deployment',
          entityId: deploymentId,
          beforeState,
          afterState: demoted,
          metadata: { reason, ...metadata }
        });
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for demotion ${deploymentId}: ${auditError.message}`);
      }

      this.logger.error(`Demoted deployment ${deploymentId}: ${reason}`);

      return demoted;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to demote deployment ${deploymentId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to demote deployment due to an internal error');
    }
  }

  /**
   * Terminate a deployment (manual or end-of-life)
   */
  async terminateDeployment(deploymentId: string, reason: string, userId?: string): Promise<Deployment> {
    try {
      const deployment = await this.findOne(deploymentId);

      const beforeState = { ...deployment };

      deployment.status = DeploymentStatus.TERMINATED;
      deployment.terminatedAt = new Date();
      deployment.terminationReason = reason;

      const terminated = await this.deploymentRepo.save(deployment);

      // Update strategy config status
      await this.strategyConfigRepo.update(deployment.strategyConfigId, {
        status: 'deprecated' as any
      });

      // Audit log
      try {
        await this.auditService.createAuditLog({
          eventType: AuditEventType.DEPLOYMENT_TERMINATED,
          entityType: 'Deployment',
          entityId: deploymentId,
          userId,
          beforeState,
          afterState: terminated,
          metadata: { reason }
        });
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for termination ${deploymentId}: ${auditError.message}`);
      }

      this.logger.warn(`Terminated deployment ${deploymentId}: ${reason}`);

      return terminated;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to terminate deployment ${deploymentId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to terminate deployment due to an internal error');
    }
  }

  /**
   * Update deployment allocation (progressive scaling)
   */
  async updateAllocation(
    deploymentId: string,
    newAllocationPercent: number,
    reason: string,
    userId?: string
  ): Promise<Deployment> {
    try {
      const deployment = await this.findOne(deploymentId);

      if (!deployment.isActive) {
        throw new BadRequestException('Only active deployments can have allocation updated');
      }

      const beforeState = { allocationPercent: deployment.allocationPercent };

      deployment.allocationPercent = newAllocationPercent;
      deployment.metadata = {
        ...deployment.metadata,
        lastAllocationChange: {
          from: beforeState.allocationPercent,
          to: newAllocationPercent,
          at: new Date(),
          reason
        }
      };

      const updated = await this.deploymentRepo.save(deployment);

      // Audit log
      try {
        await this.auditService.createAuditLog({
          eventType: AuditEventType.ALLOCATION_ADJUSTED,
          entityType: 'Deployment',
          entityId: deploymentId,
          userId,
          beforeState,
          afterState: { allocationPercent: newAllocationPercent },
          metadata: { reason }
        });
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for allocation update ${deploymentId}: ${auditError.message}`);
      }

      this.logger.log(
        `Updated allocation for deployment ${deploymentId}: ${beforeState.allocationPercent}% → ${newAllocationPercent}%`
      );

      return updated;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Failed to update allocation for deployment ${deploymentId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to update allocation due to an internal error');
    }
  }

  /**
   * Record daily performance snapshot
   */
  async recordPerformanceMetric(
    deploymentId: string,
    metricData: Partial<PerformanceMetric>
  ): Promise<PerformanceMetric> {
    try {
      const deployment = await this.findOne(deploymentId);

      const date = metricData.date || new Date().toISOString().split('T')[0];

      // Check if metric already exists for this date
      const existing = await this.performanceMetricRepo.findOne({
        where: { deploymentId, date }
      });

      if (existing) {
        // Update existing record
        Object.assign(existing, metricData);
        existing.snapshotAt = new Date();
        return await this.performanceMetricRepo.save(existing);
      }

      // Create new record
      const metric = this.performanceMetricRepo.create({
        deploymentId,
        date,
        snapshotAt: new Date(),
        ...metricData
      });

      const saved = await this.performanceMetricRepo.save(metric);

      // Update deployment aggregate stats
      try {
        await this.updateDeploymentStats(deployment, metricData);
      } catch (statsError) {
        this.logger.error(`Failed to update deployment stats for ${deploymentId}: ${statsError.message}`);
      }

      return saved;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to record performance metric for deployment ${deploymentId}: ${error.message}`,
        error.stack
      );
      throw new InternalServerErrorException('Failed to record performance metric due to an internal error');
    }
  }

  /**
   * Update deployment aggregate statistics from latest metrics
   */
  private async updateDeploymentStats(deployment: Deployment, latestMetric: Partial<PerformanceMetric>): Promise<void> {
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
      updates.driftAlertCount = deployment.driftAlertCount + 1;
      updates.lastDriftDetectedAt = new Date();
      updates.driftMetrics = latestMetric.driftDetails || null;
    }

    if (Object.keys(updates).length > 0) {
      await this.deploymentRepo.update(deployment.id, updates);
    }
  }

  /**
   * Get all active deployments
   */
  async getActiveDeployments(): Promise<Deployment[]> {
    return await this.deploymentRepo.find({
      where: { status: DeploymentStatus.ACTIVE },
      relations: ['strategyConfig', 'strategyConfig.algorithm'],
      order: { deployedAt: 'DESC' }
    });
  }

  /**
   * Get deployment by ID
   */
  async findOne(id: string): Promise<Deployment> {
    const deployment = await this.deploymentRepo.findOne({
      where: { id },
      relations: ['strategyConfig', 'strategyConfig.algorithm']
    });

    if (!deployment) {
      throw new NotFoundException(`Deployment ${id} not found`);
    }

    return deployment;
  }

  /**
   * Get deployments for a specific strategy
   */
  async findByStrategy(strategyConfigId: string): Promise<Deployment[]> {
    return await this.deploymentRepo.find({
      where: { strategyConfigId },
      order: { createdAt: 'DESC' }
    });
  }

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
      where.date = MoreThan(startDate) && LessThan(endDate);
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
   * Check if portfolio has capacity for new deployments
   */
  async hasPortfolioCapacity(): Promise<boolean> {
    const activeCount = await this.deploymentRepo.count({
      where: { status: DeploymentStatus.ACTIVE }
    });

    return activeCount < 35;
  }

  /**
   * Get total portfolio allocation
   */
  async getTotalAllocation(): Promise<number> {
    const result = await this.deploymentRepo
      .createQueryBuilder('deployment')
      .select('SUM(deployment.allocationPercent)', 'total')
      .where('deployment.status = :status', { status: DeploymentStatus.ACTIVE })
      .getRawOne();

    return Number(result?.total || 0);
  }

  /**
   * Get deployments approaching risk limits
   */
  async getDeploymentsAtRisk(): Promise<Deployment[]> {
    const deployments = await this.getActiveDeployments();

    return deployments.filter((d) => {
      const drawdownThreshold = Number(d.maxDrawdownLimit) * 0.8; // 80% of limit
      const dailyLossThreshold = Number(d.dailyLossLimit) * 0.8;

      return Number(d.currentDrawdown) >= drawdownThreshold;
    });
  }
}
