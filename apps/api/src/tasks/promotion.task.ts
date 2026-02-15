import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { DeploymentService } from '../strategy/deployment.service';
import { StrategyConfig } from '../strategy/entities/strategy-config.entity';
import { PromotionGateService } from '../strategy/gates/promotion-gate.service';

/**
 * PromotionTask
 *
 * Background job for automated strategy promotion evaluation.
 *
 * Runs daily to check validated strategies for promotion eligibility.
 * Strategies that pass all gates can be automatically deployed to live trading.
 *
 * Schedule: Daily at 2 AM (after strategy evaluation completes)
 */
@Injectable()
export class PromotionTask {
  private readonly logger = new Logger(PromotionTask.name);

  constructor(
    @InjectQueue('strategy-evaluation-queue')
    private readonly strategyQueue: Queue,
    @InjectRepository(StrategyConfig)
    private readonly strategyConfigRepo: Repository<StrategyConfig>,
    private readonly promotionGateService: PromotionGateService,
    private readonly deploymentService: DeploymentService
  ) {}

  /**
   * Schedule promotion evaluation (daily at 2 AM)
   *
   * Evaluates all validated strategies for promotion eligibility.
   */
  @Cron('0 2 * * *', {
    name: 'promotion-evaluation',
    timeZone: 'UTC'
  })
  async schedulePromotionEvaluation() {
    this.logger.log('Starting automated promotion evaluation');

    try {
      // Find strategies eligible for promotion consideration
      const eligibleStrategies = await this.strategyConfigRepo.find({
        where: { status: 'validated' as any },
        relations: ['algorithm']
      });

      this.logger.log(`Found ${eligibleStrategies.length} validated strategies for promotion evaluation`);

      // Evaluate each strategy
      const results = {
        evaluated: 0,
        approved: 0,
        rejected: 0,
        errors: 0
      };

      for (const strategy of eligibleStrategies) {
        try {
          results.evaluated++;

          // Evaluate promotion gates
          const evaluation = await this.promotionGateService.evaluateGates(strategy.id);

          if (evaluation.canPromote) {
            // Check if already deployed
            const existingDeployments = await this.deploymentService.findByStrategy(strategy.id);
            const hasActiveDeployment = existingDeployments.some((d) => d.isActive);

            if (hasActiveDeployment) {
              this.logger.warn(`Strategy ${strategy.name} already has an active deployment, skipping`);
              continue;
            }

            // Auto-promote with conservative 1% allocation
            const deployment = await this.deploymentService.createDeployment(
              strategy.id,
              1.0, // 1% initial allocation
              `Automatic promotion: ${evaluation.summary}`,
              'system'
            );

            this.logger.log(
              `AUTO-PROMOTED strategy ${strategy.name} (${strategy.id}) with deployment ${deployment.id}`
            );

            results.approved++;

            // Queue deployment activation job (after 24-hour review period)
            await this.queueDeploymentActivation(deployment.id, strategy.name);
          } else {
            this.logger.debug(`Strategy ${strategy.name} rejected for promotion: ${evaluation.failedGates.join(', ')}`);
            results.rejected++;
          }
        } catch (error: unknown) {
          this.logger.error(`Error evaluating strategy ${strategy.id} for promotion:`, error);
          results.errors++;
        }
      }

      this.logger.log(
        `Promotion evaluation complete: ` +
          `${results.evaluated} evaluated, ` +
          `${results.approved} approved, ` +
          `${results.rejected} rejected, ` +
          `${results.errors} errors`
      );
    } catch (error: unknown) {
      this.logger.error('Failed to complete promotion evaluation:', error);
    }
  }

  /**
   * Queue deployment activation (with 24-hour delay for review)
   */
  private async queueDeploymentActivation(deploymentId: string, strategyName: string): Promise<void> {
    await this.strategyQueue.add(
      'activate-deployment',
      { deploymentId, strategyName },
      {
        delay: 24 * 60 * 60 * 1000, // 24 hours
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000
        }
      }
    );

    this.logger.log(`Queued deployment ${deploymentId} for activation in 24 hours`);
  }

  /**
   * Process deployment activation job
   */
  async processDeploymentActivation(deploymentId: string, strategyName: string): Promise<void> {
    this.logger.log(`Activating deployment ${deploymentId} for strategy ${strategyName}`);

    try {
      await this.deploymentService.activateDeployment(deploymentId, 'system');
      this.logger.log(`Successfully activated deployment ${deploymentId}`);
    } catch (error: unknown) {
      this.logger.error(`Failed to activate deployment ${deploymentId}:`, error);
      throw error;
    }
  }

  /**
   * Manual promotion evaluation (on-demand)
   */
  async evaluateStrategyForPromotion(strategyConfigId: string, userId?: string): Promise<any> {
    this.logger.log(`Manual promotion evaluation for strategy ${strategyConfigId}`);

    const strategy = await this.strategyConfigRepo.findOne({
      where: { id: strategyConfigId },
      relations: ['algorithm']
    });

    if (!strategy) {
      throw new Error(`Strategy ${strategyConfigId} not found`);
    }

    // Evaluate gates
    const evaluation = await this.promotionGateService.evaluateGates(strategyConfigId, userId);

    if (evaluation.canPromote) {
      // Create deployment (but don't auto-activate for manual requests)
      const deployment = await this.deploymentService.createDeployment(
        strategyConfigId,
        1.0,
        `Manual promotion request by ${userId || 'system'}`,
        userId
      );

      return {
        evaluation,
        deployment,
        message: 'Strategy approved for promotion. Deployment created and pending activation.'
      };
    } else {
      return {
        evaluation,
        deployment: null,
        message: `Strategy rejected for promotion: ${evaluation.failedGates.join(', ')}`
      };
    }
  }
}
