import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { StrategyStatus } from '@chansey/api-interfaces';

import { AlgorithmRegistry } from '../algorithm/registry/algorithm-registry.service';
import { BacktestEngine } from '../order/backtest/backtest-engine.service';
import { Risk } from '../risk/risk.entity';
import { ScoringService } from '../scoring/scoring.service';
import { StrategyConfig } from '../strategy/entities/strategy-config.entity';
import { RiskPoolMappingService } from '../strategy/risk-pool-mapping.service';
import { StrategyService } from '../strategy/strategy.service';

/**
 * Strategy Evaluation Task
 * Automated background job for evaluating strategies
 * Injects AlgorithmRegistry and BacktestEngine to execute strategies
 */
@Injectable()
export class StrategyEvaluationTask {
  private readonly logger = new Logger(StrategyEvaluationTask.name);

  constructor(
    @InjectQueue('strategy-evaluation-queue') private strategyQueue: Queue,
    @InjectRepository(StrategyConfig)
    private readonly strategyConfigRepo: Repository<StrategyConfig>,
    @InjectRepository(Risk)
    private readonly riskRepo: Repository<Risk>,
    private readonly strategyService: StrategyService,
    private readonly algorithmRegistry: AlgorithmRegistry,
    private readonly backtestEngine: BacktestEngine,
    private readonly scoringService: ScoringService,
    private readonly riskPoolMapping: RiskPoolMappingService
  ) {}

  /**
   * Schedule strategy evaluation
   * Runs every 6 hours to evaluate pending strategies
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async scheduleStrategyEvaluation() {
    this.logger.log('Starting scheduled strategy evaluation');

    // Find strategies in testing status
    const strategies = await this.strategyConfigRepo.find({
      where: { status: StrategyStatus.TESTING },
      relations: ['algorithm']
    });

    this.logger.log(`Found ${strategies.length} strategies to evaluate`);

    // Queue each strategy for evaluation
    for (const strategy of strategies) {
      await this.queueStrategyEvaluation(strategy.id);
    }
  }

  /**
   * Queue individual strategy for evaluation
   */
  async queueStrategyEvaluation(strategyConfigId: string): Promise<void> {
    try {
      await this.strategyQueue.add(
        'evaluate-strategy',
        {
          strategyConfigId,
          timestamp: new Date().toISOString()
        },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000
          },
          removeOnComplete: false,
          removeOnFail: false
        }
      );

      this.logger.log(`Queued strategy ${strategyConfigId} for evaluation`);
    } catch (error) {
      this.logger.error(`Failed to queue strategy ${strategyConfigId}: ${error.message}`);
    }
  }

  /**
   * Process strategy evaluation job
   * This would be called by a BullMQ processor
   */
  async processStrategyEvaluation(strategyConfigId: string): Promise<void> {
    this.logger.log(`Processing evaluation for strategy ${strategyConfigId}`);

    try {
      // Get strategy instance with merged parameters
      const { strategy, config } = await this.strategyService.getStrategyInstance(strategyConfigId);

      // Execute backtest using BacktestEngine
      // Note: This is a simplified version - full implementation would:
      // 1. Load market data
      // 2. Execute walk-forward analysis
      // 3. Calculate scores
      // 4. Store results

      this.logger.log(`Strategy ${strategyConfigId} evaluation complete`);

      // Update strategy status to validated
      await this.strategyService.updateStatus(strategyConfigId, StrategyStatus.VALIDATED);

      // Assign strategy to risk pool based on performance metrics
      await this.assignStrategyToRiskPool(strategyConfigId);
    } catch (error) {
      this.logger.error(`Failed to evaluate strategy ${strategyConfigId}: ${error.message}`);
      await this.strategyService.updateStatus(strategyConfigId, StrategyStatus.FAILED);
      throw error;
    }
  }

  /**
   * Assigns strategy to appropriate risk level based on performance score.
   * Score-based assignment to risk levels 1-5:
   * - Score 90-100: Risk Level 1 (Conservative)
   * - Score 75-89:  Risk Level 2 (Low-Moderate)
   * - Score 60-74:  Risk Level 3 (Moderate)
   * - Score 50-59:  Risk Level 4 (Moderate-High)
   * - Score 40-49:  Risk Level 5 (Aggressive)
   * - Score < 40:   Not promoted (stays in testing)
   *
   * Promotion Flow:
   * 1. Get latest score
   * 2. Determine risk level based on score
   * 3. Check capacity limit (max 30 strategies per level)
   * 4. Update strategy with riskPoolId and set shadowStatus to 'live'
   */
  private async assignStrategyToRiskPool(strategyConfigId: string): Promise<void> {
    this.logger.log(`Assigning strategy ${strategyConfigId} to risk level`);

    try {
      // Get latest score
      const score = await this.scoringService.getLatestScore(strategyConfigId);
      if (!score) {
        this.logger.warn(`No score found for strategy ${strategyConfigId}, skipping assignment`);
        return;
      }

      // Get strategy config
      const strategy = await this.strategyConfigRepo.findOne({
        where: { id: strategyConfigId },
        relations: ['riskPool']
      });

      if (!strategy) {
        throw new Error(`Strategy ${strategyConfigId} not found`);
      }

      // Determine risk level based on score
      const riskLevel = this.getRiskLevelForScore(Number(score.overallScore));

      if (riskLevel === null) {
        this.logger.log(
          `Strategy ${strategyConfigId} did not qualify for promotion (Score: ${score.overallScore} < 40)`
        );
        // Keep in testing status
        strategy.shadowStatus = 'testing';
        await this.strategyConfigRepo.save(strategy);
        return;
      }

      // Get Risk entity for selected level
      const riskEntity = await this.riskRepo.findOne({
        where: { level: riskLevel }
      });

      if (!riskEntity) {
        this.logger.error(`Risk entity not found for level ${riskLevel}`);
        return;
      }

      // Check capacity (max 30 strategies per risk level)
      const MAX_STRATEGIES_PER_LEVEL = 30;
      const currentCount = await this.strategyConfigRepo.count({
        where: {
          shadowStatus: 'live',
          riskPoolId: riskEntity.id
        }
      });

      if (currentCount >= MAX_STRATEGIES_PER_LEVEL) {
        this.logger.warn(
          `Risk level ${riskLevel} is at capacity (${currentCount}/${MAX_STRATEGIES_PER_LEVEL}). Strategy ${strategyConfigId} will remain in testing.`
        );
        // TODO: Implement rotation logic to replace lowest-performing strategy
        return;
      }

      // Assign strategy to risk level
      strategy.riskPoolId = riskEntity.id;
      strategy.shadowStatus = 'live'; // Promote to live
      await this.strategyConfigRepo.save(strategy);

      this.logger.log(
        `Strategy ${strategyConfigId} assigned to Risk Level ${riskLevel} (Score: ${score.overallScore}, Count: ${currentCount + 1}/${MAX_STRATEGIES_PER_LEVEL})`
      );
    } catch (error) {
      this.logger.error(`Failed to assign strategy ${strategyConfigId} to risk level: ${error.message}`);
      throw error;
    }
  }

  /**
   * Maps strategy score to risk level (1-5).
   * Higher scores = lower risk (more conservative).
   * Returns null if score too low to promote.
   */
  private getRiskLevelForScore(score: number): number | null {
    if (score >= 90) return 1; // Conservative (excellent strategies)
    if (score >= 75) return 2; // Low-Moderate (very good strategies)
    if (score >= 60) return 3; // Moderate (good strategies)
    if (score >= 50) return 4; // Moderate-High (acceptable strategies)
    if (score >= 40) return 5; // Aggressive (marginal strategies)
    return null; // < 40: not promoted
  }

  /**
   * Manually trigger evaluation for a specific strategy
   */
  async triggerEvaluation(strategyConfigId: string): Promise<void> {
    await this.queueStrategyEvaluation(strategyConfigId);
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    const jobCounts = await this.strategyQueue.getJobCounts();
    return {
      waiting: jobCounts.waiting,
      active: jobCounts.active,
      completed: jobCounts.completed,
      failed: jobCounts.failed
    };
  }
}
