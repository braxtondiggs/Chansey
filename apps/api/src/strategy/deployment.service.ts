import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { AuditEventType, type CreateAuditLogDto, DeploymentStatus, StrategyStatus } from '@chansey/api-interfaces';

import { DeploymentMetricsService } from './deployment-metrics.service';
import { Deployment } from './entities/deployment.entity';
import { PerformanceMetric } from './entities/performance-metric.entity';
import { StrategyConfig } from './entities/strategy-config.entity';
import { StrategyScore } from './entities/strategy-score.entity';

import { AuditService } from '../audit/audit.service';
import { toErrorInfo } from '../shared/error.util';

@Injectable()
export class DeploymentService {
  private readonly logger = new Logger(DeploymentService.name);

  constructor(
    @InjectRepository(Deployment)
    private readonly deploymentRepo: Repository<Deployment>,
    @InjectRepository(StrategyConfig)
    private readonly strategyConfigRepo: Repository<StrategyConfig>,
    @InjectRepository(StrategyScore)
    private readonly strategyScoreRepo: Repository<StrategyScore>,
    private readonly auditService: AuditService,
    private readonly metricsService: DeploymentMetricsService
  ) {}

  private async safeAudit(dto: CreateAuditLogDto): Promise<void> {
    try {
      await this.auditService.createAuditLog(dto);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Audit log failed for ${dto.eventType} on ${dto.entityType} ${dto.entityId}: ${err.message}`);
    }
  }

  private handleError(error: unknown, operation: string): never {
    if (error instanceof NotFoundException || error instanceof BadRequestException) {
      throw error;
    }
    const err = toErrorInfo(error);
    this.logger.error(`Failed to ${operation}: ${err.message}`, err.stack);
    throw new InternalServerErrorException(`Failed to ${operation} due to an internal error`);
  }

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

      // Audit log - best-effort, failures must not break deployment lifecycle
      await this.safeAudit({
        eventType: AuditEventType.STRATEGY_PROMOTED,
        entityType: 'Deployment',
        entityId: savedDeployment.id,
        userId: approvedBy,
        beforeState: undefined,
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

      this.logger.log(
        `Created deployment ${savedDeployment.id} for strategy ${strategyConfig.name} ` +
          `with ${allocationPercent}% allocation`
      );

      return savedDeployment;
    } catch (error: unknown) {
      this.handleError(error, 'create deployment for strategy ' + strategyConfigId);
    }
  }

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
        status: StrategyStatus.LIVE
      });

      // Audit log
      await this.safeAudit({
        eventType: AuditEventType.DEPLOYMENT_ACTIVATED,
        entityType: 'Deployment',
        entityId: deploymentId,
        userId,
        beforeState,
        afterState: activated,
        metadata: { deployedAt: activated.deployedAt }
      });

      this.logger.log(`Activated deployment ${deploymentId}`);

      return activated;
    } catch (error: unknown) {
      this.handleError(error, 'activate deployment ' + deploymentId);
    }
  }

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
      await this.safeAudit({
        eventType: AuditEventType.DEPLOYMENT_PAUSED,
        entityType: 'Deployment',
        entityId: deploymentId,
        userId,
        beforeState,
        afterState: paused,
        metadata: { reason }
      });

      this.logger.warn(`Paused deployment ${deploymentId}: ${reason}`);

      return paused;
    } catch (error: unknown) {
      this.handleError(error, 'pause deployment ' + deploymentId);
    }
  }

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
      await this.safeAudit({
        eventType: AuditEventType.DEPLOYMENT_RESUMED,
        entityType: 'Deployment',
        entityId: deploymentId,
        userId,
        beforeState,
        afterState: resumed
      });

      this.logger.log(`Resumed deployment ${deploymentId}`);

      return resumed;
    } catch (error: unknown) {
      this.handleError(error, 'resume deployment ' + deploymentId);
    }
  }

  async demoteDeployment(
    deploymentId: string,
    reason: string,
    metadata?: Record<string, unknown>
  ): Promise<Deployment> {
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
        status: StrategyStatus.DEPRECATED
      });

      // Audit log
      await this.safeAudit({
        eventType: AuditEventType.STRATEGY_DEMOTED,
        entityType: 'Deployment',
        entityId: deploymentId,
        beforeState,
        afterState: demoted,
        metadata: { reason, ...metadata }
      });

      this.logger.error(`Demoted deployment ${deploymentId}: ${reason}`);

      return demoted;
    } catch (error: unknown) {
      this.handleError(error, 'demote deployment ' + deploymentId);
    }
  }

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
        status: StrategyStatus.DEPRECATED
      });

      // Audit log
      await this.safeAudit({
        eventType: AuditEventType.DEPLOYMENT_TERMINATED,
        entityType: 'Deployment',
        entityId: deploymentId,
        userId,
        beforeState,
        afterState: terminated,
        metadata: { reason }
      });

      this.logger.warn(`Terminated deployment ${deploymentId}: ${reason}`);

      return terminated;
    } catch (error: unknown) {
      this.handleError(error, 'terminate deployment ' + deploymentId);
    }
  }

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
      await this.safeAudit({
        eventType: AuditEventType.ALLOCATION_ADJUSTED,
        entityType: 'Deployment',
        entityId: deploymentId,
        userId,
        beforeState,
        afterState: { allocationPercent: newAllocationPercent },
        metadata: { reason }
      });

      this.logger.log(
        `Updated allocation for deployment ${deploymentId}: ${beforeState.allocationPercent}% → ${newAllocationPercent}%`
      );

      return updated;
    } catch (error: unknown) {
      this.handleError(error, 'update allocation for deployment ' + deploymentId);
    }
  }

  async recordPerformanceMetric(
    deploymentId: string,
    metricData: Partial<PerformanceMetric>
  ): Promise<PerformanceMetric> {
    try {
      const deployment = await this.findOne(deploymentId);
      return await this.metricsService.recordPerformanceMetric(deployment, metricData);
    } catch (error: unknown) {
      this.handleError(error, 'record performance metric for deployment ' + deploymentId);
    }
  }

  async getActiveDeployments(): Promise<Deployment[]> {
    return await this.deploymentRepo.find({
      where: { status: DeploymentStatus.ACTIVE },
      relations: ['strategyConfig', 'strategyConfig.algorithm'],
      order: { deployedAt: 'DESC' }
    });
  }

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

  async findByStrategy(strategyConfigId: string): Promise<Deployment[]> {
    return await this.deploymentRepo.find({
      where: { strategyConfigId },
      order: { createdAt: 'DESC' }
    });
  }

  async getPerformanceMetrics(
    deploymentId: string,
    startDate?: string,
    endDate?: string
  ): Promise<PerformanceMetric[]> {
    return this.metricsService.getPerformanceMetrics(deploymentId, startDate, endDate);
  }

  async getLatestPerformanceMetric(deploymentId: string): Promise<PerformanceMetric | null> {
    return this.metricsService.getLatestPerformanceMetric(deploymentId);
  }

  async hasPortfolioCapacity(): Promise<boolean> {
    const activeCount = await this.deploymentRepo.count({
      where: { status: DeploymentStatus.ACTIVE }
    });

    return activeCount < 35;
  }

  async getTotalAllocation(): Promise<number> {
    const result = await this.deploymentRepo
      .createQueryBuilder('deployment')
      .select('SUM(deployment.allocationPercent)', 'total')
      .where('deployment.status = :status', { status: DeploymentStatus.ACTIVE })
      .getRawOne();

    return Number(result?.total || 0);
  }

  async getDeploymentsAtRisk(): Promise<Deployment[]> {
    const deployments = await this.getActiveDeployments();
    return this.metricsService.getDeploymentsAtRisk(deployments);
  }
}
