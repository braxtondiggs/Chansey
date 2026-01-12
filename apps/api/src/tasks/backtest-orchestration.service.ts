/**
 * Backtest Orchestration Service
 *
 * Business logic for automatic backtest orchestration.
 * Handles user selection, capital calculation, dataset selection,
 * deduplication, and backtest creation.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { format } from 'date-fns';
import { Repository } from 'typeorm';

import {
  DEFAULT_RISK_LEVEL,
  getRiskConfig,
  MIN_DATASET_INTEGRITY_SCORE,
  MIN_ORCHESTRATION_CAPITAL,
  OrchestratedConfigSnapshot,
  OrchestrationResult,
  RiskLevelConfig
} from './dto/backtest-orchestration.dto';

import { AlgorithmActivation } from '../algorithm/algorithm-activation.entity';
import { AlgorithmActivationService } from '../algorithm/services/algorithm-activation.service';
import { BalanceService } from '../balance/balance.service';
import { Backtest, BacktestStatus, BacktestType } from '../order/backtest/backtest.entity';
import { BacktestService } from '../order/backtest/backtest.service';
import { CreateBacktestDto } from '../order/backtest/dto/backtest.dto';
import { MarketDataSet } from '../order/backtest/market-data-set.entity';
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
    private readonly balanceService: BalanceService,
    private readonly algorithmActivationService: AlgorithmActivationService,
    private readonly backtestService: BacktestService
  ) {}

  /**
   * Get all users eligible for automatic backtest orchestration.
   * Users must have algoTradingEnabled=true and a valid risk assignment.
   */
  async getEligibleUsers(): Promise<User[]> {
    try {
      const users = await this.userRepository
        .createQueryBuilder('user')
        .leftJoinAndSelect('user.risk', 'risk')
        .where('user.algoTradingEnabled = :enabled', { enabled: true })
        .andWhere('risk.id IS NOT NULL')
        .getMany();

      this.logger.log(`Found ${users.length} eligible users for orchestration`);
      return users;
    } catch (error) {
      this.logger.error(`Failed to fetch eligible users: ${error.message}`, error.stack);
      return [];
    }
  }

  /**
   * Main orchestration logic for a single user.
   * Gets active algorithm activations and creates backtests for each.
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
      // Get user with exchange keys for balance fetching
      const user = await this.usersService.getById(userId, true);
      const riskLevel = user.risk?.level ?? DEFAULT_RISK_LEVEL;
      const riskConfig = getRiskConfig(riskLevel);

      this.logger.log(`Orchestrating backtests for user ${userId} with risk level ${riskLevel}`);

      // Get active algorithm activations
      const activations = await this.algorithmActivationService.findUserActiveAlgorithms(userId);

      if (activations.length === 0) {
        this.logger.log(`No active algorithm activations found for user ${userId}`);
        return result;
      }

      this.logger.log(`Found ${activations.length} active activations for user ${userId}`);

      // Process each activation
      for (const activation of activations) {
        try {
          await this.processActivation(user, activation, riskConfig, result);
        } catch (error) {
          const errorMsg = `Failed to process activation ${activation.id}: ${error.message}`;
          this.logger.error(errorMsg, error.stack);
          result.errors.push(errorMsg);
          result.skippedAlgorithms.push({
            algorithmId: activation.algorithmId,
            algorithmName: activation.algorithm?.name ?? 'Unknown',
            reason: error.message
          });
        }
      }

      this.logger.log(
        `Orchestration completed for user ${userId}: ` +
          `${result.backtestsCreated} created, ${result.skippedAlgorithms.length} skipped`
      );

      return result;
    } catch (error) {
      const errorMsg = `Failed to orchestrate for user ${userId}: ${error.message}`;
      this.logger.error(errorMsg, error.stack);
      result.errors.push(errorMsg);
      return result;
    }
  }

  /**
   * Process a single algorithm activation - check for duplicates,
   * calculate capital, select dataset, and create backtest.
   */
  private async processActivation(
    user: User,
    activation: AlgorithmActivation,
    riskConfig: RiskLevelConfig,
    result: OrchestrationResult
  ): Promise<void> {
    const algorithmId = activation.algorithmId;
    const algorithmName = activation.algorithm?.name ?? 'Unknown';

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

    // Calculate allocated capital
    const allocatedCapital = await this.calculateAllocatedCapital(user, activation);

    // Create the backtest
    const backtest = await this.createOrchestratedBacktest(user, activation, riskConfig, allocatedCapital, dataset);

    result.backtestsCreated++;
    result.backtestIds.push(backtest.id);

    this.logger.log(
      `Created orchestrated backtest ${backtest.id} for user ${user.id}, ` +
        `algorithm ${algorithmName}, capital $${allocatedCapital.toFixed(2)}`
    );
  }

  /**
   * Calculate the allocated capital for a backtest based on
   * portfolio value and allocation percentages.
   */
  async calculateAllocatedCapital(user: User, activation: AlgorithmActivation): Promise<number> {
    try {
      // Get current portfolio value
      const balanceResponse = await this.balanceService.getUserBalances(user, false);
      const portfolioValue = balanceResponse.totalUsdValue;

      if (!portfolioValue || portfolioValue <= 0) {
        this.logger.warn(`No portfolio value for user ${user.id}, using minimum capital`);
        return MIN_ORCHESTRATION_CAPITAL;
      }

      // Calculate: portfolioValue × userAllocation% × activationAllocation%
      const userAllocationPct = user.algoCapitalAllocationPercentage ?? 0;
      const activationAllocationPct = activation.allocationPercentage ?? 1;

      const allocated = portfolioValue * (userAllocationPct / 100) * (activationAllocationPct / 100);

      // Ensure minimum capital
      const finalCapital = Math.max(allocated, MIN_ORCHESTRATION_CAPITAL);

      this.logger.debug(
        `Capital calculation for user ${user.id}: ` +
          `portfolio=$${portfolioValue.toFixed(2)}, ` +
          `userAlloc=${userAllocationPct}%, ` +
          `activationAlloc=${activationAllocationPct}%, ` +
          `final=$${finalCapital.toFixed(2)}`
      );

      return finalCapital;
    } catch (error) {
      this.logger.warn(`Failed to calculate capital for user ${user.id}, using minimum: ${error.message}`);
      return MIN_ORCHESTRATION_CAPITAL;
    }
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
    } catch (error) {
      this.logger.error(`Failed to select dataset: ${error.message}`, error.stack);
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
    activation: AlgorithmActivation,
    riskConfig: RiskLevelConfig,
    allocatedCapital: number,
    dataset: MarketDataSet
  ): Promise<Backtest> {
    const algorithmName = activation.algorithm?.name ?? 'Unknown';
    const dateStr = format(new Date(), 'yyyy-MM-dd');

    // Calculate date range based on lookback days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - riskConfig.lookbackDays);

    const dto: CreateBacktestDto = {
      name: `Auto-${algorithmName}-${dateStr}`,
      description: `Orchestrated backtest for ${algorithmName}`,
      type: BacktestType.HISTORICAL,
      algorithmId: activation.algorithmId,
      marketDataSetId: dataset.id,
      initialCapital: allocatedCapital,
      tradingFee: riskConfig.tradingFee,
      slippageModel: riskConfig.slippageModel,
      slippageFixedBps: riskConfig.slippageBps,
      slippageBaseBps: riskConfig.slippageBps,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      strategyParams: activation.config?.parameters
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
