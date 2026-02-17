/**
 * Pipeline Orchestration Service
 *
 * Business logic for automatic pipeline orchestration.
 * Runs full validation pipelines (Optimization → Historical → Live Replay → Paper Trading)
 * for eligible users with exchange keys.
 *
 * Handles user selection, strategy config selection, deduplication,
 * and pipeline creation with risk-based configuration.
 */

import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { format } from 'date-fns';
import { Repository } from 'typeorm';

import { StrategyStatus } from '@chansey/api-interfaces';

import {
  DEFAULT_RISK_LEVEL,
  PipelineOrchestrationResult,
  buildStageConfigFromRisk
} from './dto/pipeline-orchestration.dto';

import { ExchangeKey } from '../exchange/exchange-key/exchange-key.entity';
import { Pipeline } from '../pipeline/entities/pipeline.entity';
import { PipelineStatus } from '../pipeline/interfaces';
import { PipelineOrchestratorService } from '../pipeline/services/pipeline-orchestrator.service';
import { toErrorInfo } from '../shared/error.util';
import { StrategyConfig } from '../strategy/entities/strategy-config.entity';
import { User } from '../users/users.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class PipelineOrchestrationService {
  private readonly logger = new Logger(PipelineOrchestrationService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Pipeline)
    private readonly pipelineRepository: Repository<Pipeline>,
    @InjectRepository(StrategyConfig)
    private readonly strategyConfigRepository: Repository<StrategyConfig>,
    @InjectRepository(ExchangeKey)
    private readonly exchangeKeyRepository: Repository<ExchangeKey>,
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => PipelineOrchestratorService))
    private readonly pipelineOrchestrator: PipelineOrchestratorService
  ) {}

  /**
   * Get all users eligible for automatic pipeline orchestration.
   * Users must have:
   * - algoTradingEnabled=true
   * - At least one active exchange key
   */
  async getEligibleUsers(): Promise<User[]> {
    try {
      // Find users with algo trading enabled who have at least one active exchange key
      const users = await this.userRepository
        .createQueryBuilder('user')
        .leftJoinAndSelect('user.risk', 'risk')
        .innerJoin(ExchangeKey, 'exchangeKey', 'exchangeKey.userId = user.id AND exchangeKey.isActive = true')
        .where('user.algoTradingEnabled = :enabled', { enabled: true })
        .groupBy('user.id')
        .addGroupBy('risk.id')
        .getMany();

      this.logger.log(`Found ${users.length} eligible users for pipeline orchestration`);
      return users;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to fetch eligible users: ${err.message}`, err.stack);
      return [];
    }
  }

  /**
   * Get user's primary/first active exchange key
   */
  async getUserExchangeKey(userId: string): Promise<ExchangeKey | null> {
    try {
      const exchangeKey = await this.exchangeKeyRepository.findOne({
        where: {
          userId,
          isActive: true
        },
        order: {
          createdAt: 'ASC' // Use oldest (primary) key
        },
        relations: ['exchange']
      });

      return exchangeKey;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to get exchange key for user ${userId}: ${err.message}`, err.stack);
      return null;
    }
  }

  /**
   * Get all eligible strategy configs for pipeline orchestration.
   * Strategy configs must have status=VALIDATED or status=TESTING
   */
  async getEligibleStrategyConfigs(): Promise<StrategyConfig[]> {
    try {
      const configs = await this.strategyConfigRepository.find({
        where: [{ status: StrategyStatus.VALIDATED }, { status: StrategyStatus.TESTING }],
        relations: ['algorithm']
      });

      this.logger.log(`Found ${configs.length} eligible strategy configs for pipeline orchestration`);
      return configs;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to fetch strategy configs: ${err.message}`, err.stack);
      return [];
    }
  }

  /**
   * Check if a duplicate pipeline exists for this strategy config
   * within the last 24 hours (excluding failed/cancelled).
   */
  async checkDuplicate(strategyConfigId: string, userId: string): Promise<boolean> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const existing = await this.pipelineRepository
      .createQueryBuilder('pipeline')
      .innerJoin('pipeline.user', 'user')
      .where('pipeline.strategyConfigId = :strategyConfigId', { strategyConfigId })
      .andWhere('user.id = :userId', { userId })
      .andWhere('pipeline.createdAt >= :since', { since: twentyFourHoursAgo })
      .andWhere('pipeline.status NOT IN (:...failedStatuses)', {
        failedStatuses: [PipelineStatus.FAILED, PipelineStatus.CANCELLED]
      })
      .getOne();

    return !!existing;
  }

  /**
   * Get user by ID with relations
   */
  async getUser(userId: string): Promise<User> {
    return this.usersService.getById(userId, true);
  }

  /**
   * Main orchestration logic for a single user.
   * Gets all eligible strategy configs and creates pipelines for each.
   */
  async orchestrateForUser(userId: string): Promise<PipelineOrchestrationResult> {
    const result: PipelineOrchestrationResult = {
      userId,
      pipelinesCreated: 0,
      pipelineIds: [],
      skippedConfigs: [],
      errors: []
    };

    try {
      // Get user with exchange keys
      const user = await this.usersService.getById(userId, true);
      const riskLevel = user.risk?.level ?? DEFAULT_RISK_LEVEL;

      this.logger.log(`Orchestrating pipelines for user ${userId} with risk level ${riskLevel}`);

      // Get user's exchange key
      const exchangeKey = await this.getUserExchangeKey(userId);
      if (!exchangeKey) {
        this.logger.warn(`User ${userId} has no active exchange key, skipping pipeline orchestration`);
        result.errors.push('No active exchange key');
        return result;
      }

      // Get all eligible strategy configs
      const strategyConfigs = await this.getEligibleStrategyConfigs();

      if (strategyConfigs.length === 0) {
        this.logger.log('No eligible strategy configs found for pipeline orchestration');
        return result;
      }

      this.logger.log(`Found ${strategyConfigs.length} eligible strategy configs for user ${userId}`);

      // Process each strategy config
      for (const strategyConfig of strategyConfigs) {
        try {
          await this.processStrategyConfig(user, strategyConfig, exchangeKey, riskLevel, result);
        } catch (error: unknown) {
          const err = toErrorInfo(error);
          const errorMsg = `Failed to process strategy config ${strategyConfig.id}: ${err.message}`;
          this.logger.error(errorMsg, err.stack);
          result.errors.push(errorMsg);
          result.skippedConfigs.push({
            strategyConfigId: strategyConfig.id,
            strategyName: strategyConfig.name ?? 'Unknown',
            reason: err.message
          });
        }
      }

      this.logger.log(
        `Pipeline orchestration completed for user ${userId}: ` +
          `${result.pipelinesCreated} created, ${result.skippedConfigs.length} skipped`
      );

      return result;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      const errorMsg = `Failed to orchestrate pipelines for user ${userId}: ${err.message}`;
      this.logger.error(errorMsg, err.stack);
      result.errors.push(errorMsg);
      return result;
    }
  }

  /**
   * Process a single strategy config - check for duplicates and create pipeline.
   */
  private async processStrategyConfig(
    user: User,
    strategyConfig: StrategyConfig,
    exchangeKey: ExchangeKey,
    riskLevel: number,
    result: PipelineOrchestrationResult
  ): Promise<void> {
    const strategyConfigId = strategyConfig.id;
    const strategyName = strategyConfig.name ?? 'Unknown';

    // Check for duplicate pipeline in the last 24 hours
    if (await this.checkDuplicate(strategyConfigId, user.id)) {
      this.logger.debug(`Skipping duplicate pipeline for user ${user.id}, strategy ${strategyConfigId}`);
      result.skippedConfigs.push({
        strategyConfigId,
        strategyName,
        reason: 'Duplicate pipeline exists within 24 hours'
      });
      return;
    }

    // Build stage configuration based on risk level
    const stageConfig = buildStageConfigFromRisk(riskLevel);

    // Create the pipeline
    const dateStr = format(new Date(), 'yyyy-MM-dd');
    const pipeline = await this.pipelineOrchestrator.createPipeline(
      {
        name: `Auto: ${strategyName} - ${dateStr}`,
        description: `Orchestrated pipeline for ${strategyName}`,
        strategyConfigId,
        exchangeKeyId: exchangeKey.id,
        stageConfig
      },
      user
    );

    // Start the pipeline
    await this.pipelineOrchestrator.startPipeline(pipeline.id, user);

    result.pipelinesCreated++;
    result.pipelineIds.push(pipeline.id);

    this.logger.log(`Created and started pipeline ${pipeline.id} for user ${user.id}, ` + `strategy ${strategyName}`);
  }
}
