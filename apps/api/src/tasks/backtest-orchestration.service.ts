/**
 * Backtest Orchestration Service
 *
 * Business logic for automatic backtest orchestration.
 * Runs all testable algorithms (evaluate=true, status=ACTIVE) for all
 * eligible users with standardized capital ($10,000).
 *
 * Handles user selection, dataset selection, deduplication,
 * and backtest creation.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { format } from 'date-fns';
import { Repository } from 'typeorm';

import {
  BACKTEST_STANDARD_CAPITAL,
  DEFAULT_RISK_LEVEL,
  getRiskConfig,
  MIN_DATASET_INTEGRITY_SCORE,
  OrchestratedConfigSnapshot,
  OrchestrationResult,
  RiskLevelConfig
} from './dto/backtest-orchestration.dto';

import { Algorithm } from '../algorithm/algorithm.entity';
import { AlgorithmService } from '../algorithm/algorithm.service';
import { Backtest, BacktestStatus, BacktestType } from '../order/backtest/backtest.entity';
import { BacktestService } from '../order/backtest/backtest.service';
import { CreateBacktestDto } from '../order/backtest/dto/backtest.dto';
import { MarketDataSet } from '../order/backtest/market-data-set.entity';
import { toErrorInfo } from '../shared/error.util';
import { User } from '../users/users.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class BacktestOrchestrationService {
  private readonly logger = new Logger(BacktestOrchestrationService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Backtest)
    private readonly backtestRepository: Repository<Backtest>,
    @InjectRepository(MarketDataSet)
    private readonly marketDataSetRepository: Repository<MarketDataSet>,
    private readonly usersService: UsersService,
    private readonly algorithmService: AlgorithmService,
    private readonly backtestService: BacktestService
  ) {}

  /**
   * Get all users eligible for automatic backtest orchestration.
   * Users must have algoTradingEnabled=true.
   * Risk defaults to level 3 in orchestrateForUser() if not set.
   */
  async getEligibleUsers(): Promise<User[]> {
    try {
      const users = await this.userRepository
        .createQueryBuilder('user')
        .leftJoinAndSelect('user.risk', 'risk')
        .where('user.algoTradingEnabled = :enabled', { enabled: true })
        .getMany();

      this.logger.log(`Found ${users.length} eligible users for orchestration`);
      return users;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to fetch eligible users: ${err.message}`, err.stack);
      return [];
    }
  }

  /**
   * Main orchestration logic for a single user.
   * Gets all testable algorithms (evaluate=true, status=ACTIVE) and creates backtests for each.
   */
  async orchestrateForUser(userId: string): Promise<OrchestrationResult> {
    const result: OrchestrationResult = {
      userId,
      backtestsCreated: 0,
      backtestIds: [],
      skippedAlgorithms: [],
      errors: []
    };

    try {
      // Get user with exchange keys
      const user = await this.usersService.getById(userId, true);
      const riskLevel = user.risk?.level ?? DEFAULT_RISK_LEVEL;
      const riskConfig = getRiskConfig(riskLevel);

      this.logger.log(`Orchestrating backtests for user ${userId} with risk level ${riskLevel}`);

      // Get all testable algorithms (evaluate=true AND status=ACTIVE)
      const algorithms = await this.algorithmService.getAlgorithmsForTesting();

      if (algorithms.length === 0) {
        this.logger.log(`No testable algorithms found`);
        return result;
      }

      this.logger.log(`Found ${algorithms.length} testable algorithms for user ${userId}`);

      // Process each algorithm
      for (const algorithm of algorithms) {
        try {
          await this.processAlgorithm(user, algorithm, riskConfig, result);
        } catch (error: unknown) {
          const err = toErrorInfo(error);
          const errorMsg = `Failed to process algorithm ${algorithm.id}: ${err.message}`;
          this.logger.error(errorMsg, err.stack);
          result.errors.push(errorMsg);
          result.skippedAlgorithms.push({
            algorithmId: algorithm.id,
            algorithmName: algorithm.name ?? 'Unknown',
            reason: err.message
          });
        }
      }

      this.logger.log(
        `Orchestration completed for user ${userId}: ` +
          `${result.backtestsCreated} created, ${result.skippedAlgorithms.length} skipped`
      );

      return result;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      const errorMsg = `Failed to orchestrate for user ${userId}: ${err.message}`;
      this.logger.error(errorMsg, err.stack);
      result.errors.push(errorMsg);
      return result;
    }
  }

  /**
   * Process a single algorithm - check for duplicates,
   * select dataset, and create backtest with standard capital.
   */
  private async processAlgorithm(
    user: User,
    algorithm: Algorithm,
    riskConfig: RiskLevelConfig,
    result: OrchestrationResult
  ): Promise<void> {
    const algorithmId = algorithm.id;
    const algorithmName = algorithm.name ?? 'Unknown';

    // Check for duplicate backtest in the last 24 hours
    if (await this.isDuplicate(user.id, algorithmId)) {
      this.logger.debug(`Skipping duplicate backtest for user ${user.id}, algorithm ${algorithmId}`);
      result.skippedAlgorithms.push({
        algorithmId,
        algorithmName,
        reason: 'Duplicate backtest exists within 24 hours'
      });
      return;
    }

    // Select appropriate dataset
    const dataset = await this.selectDataset(riskConfig);
    if (!dataset) {
      this.logger.warn(`No suitable dataset found for risk config (level ${user.risk?.level})`);
      result.skippedAlgorithms.push({
        algorithmId,
        algorithmName,
        reason: 'No suitable dataset found for risk configuration'
      });
      return;
    }

    // Create the backtest with standard capital
    const backtest = await this.createOrchestratedBacktest(
      user,
      algorithm,
      riskConfig,
      BACKTEST_STANDARD_CAPITAL,
      dataset
    );

    result.backtestsCreated++;
    result.backtestIds.push(backtest.id);

    this.logger.log(
      `Created orchestrated backtest ${backtest.id} for user ${user.id}, ` +
        `algorithm ${algorithmName}, capital $${BACKTEST_STANDARD_CAPITAL.toFixed(2)}`
    );
  }

  /**
   * Select the best matching dataset based on risk configuration.
   * Priority: recency > timeframe match > integrity score.
   */
  async selectDataset(riskConfig: RiskLevelConfig): Promise<MarketDataSet | null> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - riskConfig.lookbackDays);

      const datasets = await this.marketDataSetRepository
        .createQueryBuilder('dataset')
        .where('dataset.integrityScore >= :minIntegrity', { minIntegrity: MIN_DATASET_INTEGRITY_SCORE })
        .andWhere('dataset.endAt >= :cutoff', { cutoff: cutoffDate })
        .andWhere('dataset.timeframe IN (:...timeframes)', { timeframes: riskConfig.preferredTimeframes })
        .orderBy('dataset.endAt', 'DESC')
        .addOrderBy('dataset.integrityScore', 'DESC')
        .getMany();

      if (datasets.length === 0) {
        this.logger.warn('No datasets found matching risk configuration, trying fallback');
        // Fallback: relax timeframe constraint
        const fallbackDatasets = await this.marketDataSetRepository
          .createQueryBuilder('dataset')
          .where('dataset.integrityScore >= :minIntegrity', { minIntegrity: MIN_DATASET_INTEGRITY_SCORE })
          .andWhere('dataset.endAt >= :cutoff', { cutoff: cutoffDate })
          .orderBy('dataset.endAt', 'DESC')
          .addOrderBy('dataset.integrityScore', 'DESC')
          .take(1)
          .getMany();

        return fallbackDatasets[0] ?? null;
      }

      return datasets[0];
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to select dataset: ${err.message}`, err.stack);
      return null;
    }
  }

  /**
   * Check if a duplicate backtest exists for this user/algorithm
   * combination within the last 24 hours (excluding failed/cancelled).
   */
  async isDuplicate(userId: string, algorithmId: string): Promise<boolean> {
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const existing = await this.backtestRepository
      .createQueryBuilder('backtest')
      .where('backtest.userId = :userId', { userId })
      .andWhere('backtest.algorithmId = :algorithmId', { algorithmId })
      .andWhere('backtest.createdAt >= :since', { since: twentyFourHoursAgo })
      .andWhere('backtest.status NOT IN (:...failedStatuses)', {
        failedStatuses: [BacktestStatus.FAILED, BacktestStatus.CANCELLED]
      })
      .getOne();

    return !!existing;
  }

  /**
   * Create an orchestrated backtest with the appropriate configuration.
   */
  async createOrchestratedBacktest(
    user: User,
    algorithm: Algorithm,
    riskConfig: RiskLevelConfig,
    allocatedCapital: number,
    dataset: MarketDataSet
  ): Promise<Backtest> {
    const algorithmName = algorithm.name ?? 'Unknown';
    const dateStr = format(new Date(), 'yyyy-MM-dd');

    // Calculate date range based on lookback days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - riskConfig.lookbackDays);

    const dto: CreateBacktestDto = {
      name: `Auto-${algorithmName}-${dateStr}`,
      description: `Orchestrated backtest for ${algorithmName}`,
      type: BacktestType.HISTORICAL,
      algorithmId: algorithm.id,
      marketDataSetId: dataset.id,
      initialCapital: allocatedCapital,
      tradingFee: riskConfig.tradingFee,
      slippageModel: riskConfig.slippageModel,
      slippageFixedBps: riskConfig.slippageBps,
      slippageBaseBps: riskConfig.slippageBps,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      strategyParams: algorithm.config?.parameters
    };

    // Create the backtest via BacktestService
    const backtestResult = await this.backtestService.createBacktest(user, dto);

    // Update configSnapshot to mark as orchestrated
    const updatedConfigSnapshot: OrchestratedConfigSnapshot = {
      ...backtestResult.configSnapshot,
      orchestrated: true,
      orchestratedAt: new Date().toISOString(),
      riskLevel: user.risk?.level ?? DEFAULT_RISK_LEVEL
    };

    await this.backtestRepository.update(backtestResult.id, {
      configSnapshot: updatedConfigSnapshot
    });

    // Fetch and return the updated backtest
    const backtest = await this.backtestRepository.findOne({
      where: { id: backtestResult.id }
    });

    if (!backtest) {
      throw new Error(`Failed to fetch created backtest ${backtestResult.id}`);
    }

    return backtest;
  }
}
