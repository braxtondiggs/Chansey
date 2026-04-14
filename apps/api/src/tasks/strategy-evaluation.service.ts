import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { createHash } from 'crypto';

import { BacktestConfiguration, BacktestResults, BacktestRunStatus } from '@chansey/api-interfaces';

import { BACKTEST_STANDARD_CAPITAL } from './dto/backtest-orchestration.dto';

import { Coin } from '../coin/coin.entity';
import { BacktestDatasetService } from '../order/backtest/backtest-dataset.service';
import { BacktestEngine } from '../order/backtest/backtest-engine.service';
import { BacktestFinalMetrics, BacktestResultService } from '../order/backtest/backtest-result.service';
import { Backtest, BacktestStatus, BacktestType } from '../order/backtest/backtest.entity';
import { CoinResolverService } from '../order/backtest/coin-resolver.service';
import { MarketDataSet } from '../order/backtest/market-data-set.entity';
import { ScoringService } from '../scoring/scoring.service';
import { toErrorInfo } from '../shared/error.util';
import { BacktestRun } from '../strategy/entities/backtest-run.entity';
import { StrategyConfig } from '../strategy/entities/strategy-config.entity';
import { StrategyScore } from '../strategy/entities/strategy-score.entity';
import { StrategyService } from '../strategy/strategy.service';
import { User } from '../users/users.entity';

export interface EvaluationResult {
  score: StrategyScore | null;
  passed: boolean;
  /** Human-readable reason when score is null (for operator diagnostics). */
  reason?: string;
}

/** Score below which a strategy is permanently failed (no point retrying). */
export const CRITICAL_FAIL_THRESHOLD = 20;

/** Minimum score required to pass evaluation and become VALIDATED. */
export const PASS_THRESHOLD = 40;

@Injectable()
export class StrategyEvaluationService {
  private readonly logger = new Logger(StrategyEvaluationService.name);

  constructor(
    @InjectRepository(Backtest) private readonly backtestRepo: Repository<Backtest>,
    @InjectRepository(BacktestRun) private readonly backtestRunRepo: Repository<BacktestRun>,
    @InjectRepository(StrategyConfig) private readonly strategyConfigRepo: Repository<StrategyConfig>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly strategyService: StrategyService,
    private readonly backtestEngine: BacktestEngine,
    private readonly backtestResultService: BacktestResultService,
    private readonly backtestDatasetService: BacktestDatasetService,
    private readonly coinResolver: CoinResolverService,
    private readonly scoringService: ScoringService
  ) {}

  /**
   * Run a full evaluation for a strategy:
   * backtest → persist results → score → return pass/fail.
   */
  async evaluate(strategyConfigId: string): Promise<EvaluationResult> {
    // 1. Load strategy config with relations
    const strategyConfig = await this.strategyConfigRepo.findOne({
      where: { id: strategyConfigId },
      relations: ['algorithm', 'creator']
    });

    if (!strategyConfig?.algorithm) {
      const reason = `Strategy config ${strategyConfigId} not found or missing algorithm`;
      this.logger.warn(reason);
      return { score: null, passed: false, reason };
    }

    // 2. Get strategy instance (validates registry + merges params)
    const { config: mergedParams } = await this.strategyService.getStrategyInstance(strategyConfigId);

    // 3. Resolve user — prefer creator, fallback to any algo-enabled user
    const user = await this.resolveUser(strategyConfig);
    if (!user) {
      const reason = `No eligible user found for strategy ${strategyConfigId}`;
      this.logger.warn(`${reason}, skipping evaluation`);
      return { score: null, passed: false, reason };
    }

    // 4. Get default dataset
    const dataset = await this.backtestDatasetService.ensureDefaultDatasetExists();
    if (!dataset) {
      const reason = `No dataset available for strategy ${strategyConfigId}`;
      this.logger.warn(`${reason}, skipping evaluation`);
      return { score: null, passed: false, reason };
    }

    // 5. Create Backtest entity
    const deterministicSeed = createHash('sha256').update(`${strategyConfigId}:${dataset.id}`).digest('hex');
    const startDate = new Date(dataset.startAt);
    const endDate = new Date(dataset.endAt);
    const dateStr = new Date().toISOString().slice(0, 10);

    const backtest = this.backtestRepo.create({
      name: `Eval-${strategyConfig.name}-${dateStr}`,
      description: `Automated evaluation for strategy ${strategyConfig.name}`,
      type: BacktestType.HISTORICAL,
      status: BacktestStatus.PENDING,
      initialCapital: BACKTEST_STANDARD_CAPITAL,
      tradingFee: 0.001,
      startDate,
      endDate,
      user,
      algorithm: strategyConfig.algorithm,
      marketDataSet: dataset,
      strategyParams: mergedParams,
      deterministicSeed,
      warningFlags: [],
      processedTimestampCount: 0,
      totalTimestampCount: 0
    });

    const savedBacktest = await this.backtestRepo.save(backtest);

    // 6. Resolve coins
    let coins: Coin[] = [];
    try {
      const resolved = await this.coinResolver.resolveCoins(dataset, { startDate, endDate });
      coins = resolved.coins;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      const reason = `Coin resolution failed for strategy ${strategyConfigId}: ${err.message}`;
      this.logger.error(reason);
      await this.markBacktestFailed(savedBacktest, `Coin resolution failed: ${err.message}`);
      return { score: null, passed: false, reason };
    }

    if (coins.length === 0) {
      const reason = `No coins resolved for strategy ${strategyConfigId}`;
      this.logger.warn(reason);
      await this.markBacktestFailed(savedBacktest, 'No coins resolved from dataset');
      return { score: null, passed: false, reason };
    }

    // 7. Execute backtest
    let results: Awaited<ReturnType<BacktestEngine['executeHistoricalBacktest']>>;
    try {
      savedBacktest.status = BacktestStatus.RUNNING;
      await this.backtestRepo.save(savedBacktest);

      results = await this.backtestEngine.executeHistoricalBacktest(savedBacktest, coins, {
        dataset,
        deterministicSeed
      });
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Backtest execution failed for strategy ${strategyConfigId}: ${err.message}`);
      await this.markBacktestFailed(savedBacktest, err.message);
      throw error; // Re-throw for BullMQ retry
    }

    // 8. Persist backtest results
    await this.backtestResultService.persistSuccess(savedBacktest, results);

    // 9. Create BacktestRun for scoring
    const backtestRun = await this.createBacktestRun(
      strategyConfigId,
      dataset,
      startDate,
      endDate,
      results.finalMetrics
    );

    // 10. Calculate score — wfaDegradation = 0 because single-backtest evaluation
    // has no train/test split, so no walk-forward analysis data exists.
    const score = await this.scoringService.calculateScore(strategyConfigId, backtestRun, 0);

    const passed = Number(score.overallScore) >= PASS_THRESHOLD;
    this.logger.log(`Strategy ${strategyConfigId} evaluation: score=${score.overallScore}, passed=${passed}`);

    return { score, passed };
  }

  private async resolveUser(strategyConfig: StrategyConfig): Promise<User | null> {
    if (strategyConfig.creator) {
      return strategyConfig.creator;
    }

    // Fallback: find any user with algo trading enabled
    return this.userRepo.findOne({
      where: { algoTradingEnabled: true }
    });
  }

  private async markBacktestFailed(backtest: Backtest, errorMessage: string): Promise<void> {
    backtest.completedAt = new Date();
    await this.backtestRepo.save(backtest);
    await this.backtestResultService.markFailed(backtest.id, errorMessage);
  }

  private async createBacktestRun(
    strategyConfigId: string,
    dataset: MarketDataSet,
    startDate: Date,
    endDate: Date,
    metrics: BacktestFinalMetrics
  ): Promise<BacktestRun> {
    const config: BacktestConfiguration = {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      initialCapital: BACKTEST_STANDARD_CAPITAL
    };

    const results: BacktestResults = {
      totalReturn: metrics.totalReturn,
      annualizedReturn: metrics.annualizedReturn,
      sharpeRatio: metrics.sharpeRatio,
      calmarRatio: metrics.maxDrawdown !== 0 ? metrics.annualizedReturn / Math.abs(metrics.maxDrawdown) : 0,
      maxDrawdown: metrics.maxDrawdown,
      winRate: metrics.winRate,
      profitFactor: metrics.profitFactor,
      totalTrades: metrics.totalTrades,
      avgTradeReturn: metrics.totalTrades > 0 ? metrics.totalReturn / metrics.totalTrades : 0,
      volatility: metrics.volatility
    };

    const datasetChecksum = createHash('sha256')
      .update(JSON.stringify({ datasetId: dataset.id, startDate, endDate }))
      .digest('hex');

    const backtestRun = this.backtestRunRepo.create({
      strategyConfigId,
      startedAt: new Date(),
      completedAt: new Date(),
      status: BacktestRunStatus.COMPLETED,
      config,
      datasetChecksum,
      windowCount: 1,
      results
    });

    return this.backtestRunRepo.save(backtestRun);
  }
}
