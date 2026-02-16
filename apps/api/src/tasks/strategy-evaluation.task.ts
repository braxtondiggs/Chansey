import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { DataSource, EntityManager, Repository } from 'typeorm';

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
    private readonly riskPoolMapping: RiskPoolMappingService,
    private readonly dataSource: DataSource
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
          removeOnComplete: 100,
          removeOnFail: 50
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

      // Wrap capacity check + rotation/promotion in a transaction with pessimistic locking
      const MAX_STRATEGIES_PER_LEVEL = 30;

      await this.dataSource.transaction(async (manager) => {
        // Lock all live strategies in pool with pessimistic_write (SELECT ... FOR UPDATE)
        // This serializes concurrent evaluations for the same risk level
        const liveStrategies = await manager.find(StrategyConfig, {
          where: { shadowStatus: 'live', riskPoolId: riskEntity.id },
          lock: { mode: 'pessimistic_write' }
        });
        const currentCount = liveStrategies.length;

        // Load the candidate strategy within the transaction
        const candidateStrategy = await manager.findOneByOrFail(StrategyConfig, { id: strategyConfigId });

        if (currentCount >= MAX_STRATEGIES_PER_LEVEL) {
          this.logger.log(
            `Risk level ${riskLevel} is at capacity (${currentCount}/${MAX_STRATEGIES_PER_LEVEL}). Attempting rotation for strategy ${strategyConfigId}.`
          );

          const worst = await this.findWorstPerformingStrategy(riskEntity.id, manager);
          if (!worst) {
            this.logger.warn(
              `No rotation candidate found for risk level ${riskLevel}. Strategy ${strategyConfigId} will remain in testing.`
            );
            return;
          }

          const newScore = Number(score.overallScore);
          if (newScore > worst.latestScore) {
            await this.rotateStrategy(worst, candidateStrategy, riskEntity, newScore, manager);
          } else {
            this.logger.log(
              `Strategy ${strategyConfigId} (score: ${newScore}) does not outperform worst pool member ${worst.id} (score: ${worst.latestScore}). Rotation skipped.`
            );
          }
          return;
        }

        // Assign strategy to risk level
        candidateStrategy.riskPoolId = riskEntity.id;
        candidateStrategy.shadowStatus = 'live';
        await manager.save(candidateStrategy);

        this.logger.log(
          `Strategy ${strategyConfigId} assigned to Risk Level ${riskLevel} (Score: ${score.overallScore}, Count: ${currentCount + 1}/${MAX_STRATEGIES_PER_LEVEL})`
        );
      });
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
   * Find the worst-performing live strategy in a risk pool.
   * Uses a single query with a subquery to get each strategy's most recent score.
   */
  private async findWorstPerformingStrategy(
    riskPoolId: string,
    manager: EntityManager
  ): Promise<{ id: string; name: string; latestScore: number } | null> {
    const result = await manager
      .createQueryBuilder(StrategyConfig, 'sc')
      .innerJoin(
        'strategy_scores',
        'ss',
        'ss."strategyConfigId" = sc.id AND ss."calculatedAt" = (' +
          'SELECT MAX(ss2."calculatedAt") FROM strategy_scores ss2 WHERE ss2."strategyConfigId" = sc.id' +
          ')'
      )
      .select(['sc.id AS id', 'sc.name AS name', 'ss."overallScore" AS "latestScore"'])
      .where('sc."riskPoolId" = :riskPoolId', { riskPoolId })
      .andWhere('sc."shadowStatus" = :status', { status: 'live' })
      .orderBy('ss."overallScore"', 'ASC')
      .limit(1)
      .getRawOne();

    if (!result) return null;

    return {
      id: result.id,
      name: result.name,
      latestScore: Number(result.latestScore)
    };
  }

  /**
   * Rotate a strategy in the risk pool: demote the worst, promote the new.
   */
  private async rotateStrategy(
    worst: { id: string; name: string; latestScore: number },
    newStrategy: StrategyConfig,
    riskEntity: Risk,
    newScore: number,
    manager: EntityManager
  ): Promise<void> {
    // Demote worst strategy — load entity so save() triggers @UpdateDateColumn
    const worstEntity = await manager.findOneByOrFail(StrategyConfig, { id: worst.id });
    worstEntity.shadowStatus = 'retired';
    worstEntity.riskPoolId = null;
    await manager.save(worstEntity);

    // Promote new strategy
    newStrategy.shadowStatus = 'live';
    newStrategy.riskPoolId = riskEntity.id;
    await manager.save(newStrategy);

    this.logger.log(
      `Rotation complete for risk level ${riskEntity.level}: ` +
        `demoted "${worst.name}" (${worst.id}, score: ${worst.latestScore}) → ` +
        `promoted "${newStrategy.name}" (${newStrategy.id}, score: ${newScore})`
    );
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

  /**
   * Update heartbeat metrics for Prometheus
   * Runs every minute to keep metrics fresh
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async updateHeartbeatMetrics() {
    try {
      await this.strategyService.updateHeartbeatMetrics();
    } catch (error) {
      this.logger.error(`Failed to update heartbeat metrics: ${error.message}`);
    }
  }

  /**
   * Check for stale strategies and log warnings
   * Runs every 5 minutes to detect unresponsive strategies
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkStaleStrategies() {
    try {
      const staleStrategies = await this.strategyService.getStrategiesWithStaleHeartbeats(10);
      if (staleStrategies.length > 0) {
        this.logger.warn(
          `Found ${staleStrategies.length} strategies with stale heartbeats: ${staleStrategies.map((s) => s.name).join(', ')}`
        );
      }

      const failingStrategies = await this.strategyService.getStrategiesWithHeartbeatFailures(3);
      if (failingStrategies.length > 0) {
        this.logger.error(
          `Found ${failingStrategies.length} strategies with multiple heartbeat failures: ${failingStrategies.map((s) => `${s.name} (${s.heartbeatFailures} failures)`).join(', ')}`
        );
      }
    } catch (error) {
      this.logger.error(`Failed to check stale strategies: ${error.message}`);
    }
  }
}
