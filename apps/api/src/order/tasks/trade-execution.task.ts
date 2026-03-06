import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { Job, Queue } from 'bullmq';
import { In, Repository } from 'typeorm';

import { MarketType } from '@chansey/api-interfaces';

import { TradingStateService } from '../../admin/trading-state/trading-state.service';
import { AlgorithmActivation } from '../../algorithm/algorithm-activation.entity';
import { SignalType, TradingSignal } from '../../algorithm/interfaces';
import { AlgorithmRegistry } from '../../algorithm/registry/algorithm-registry.service';
import { AlgorithmActivationService } from '../../algorithm/services/algorithm-activation.service';
import { AlgorithmContextBuilder } from '../../algorithm/services/algorithm-context-builder.service';
import { BalanceService } from '../../balance/balance.service';
import { CoinService } from '../../coin/coin.service';
import { DEFAULT_QUOTE_CURRENCY, EXCHANGE_QUOTE_CURRENCY } from '../../exchange/constants';
import { toErrorInfo } from '../../shared/error.util';
import { TradeCooldownService } from '../../shared/trade-cooldown.service';
import { StrategyConfig } from '../../strategy/entities/strategy-config.entity';
import { User } from '../../users/users.entity';
import { UsersService } from '../../users/users.service';
import { SignalThrottleService, ThrottleState } from '../backtest/shared/throttle';
import { TradeExecutionService, TradeSignalWithExit } from '../services/trade-execution.service';

const MIN_CONFIDENCE_THRESHOLD = 0.6;
const ACTIONABLE_SIGNAL_TYPES = new Set([
  SignalType.BUY,
  SignalType.SELL,
  SignalType.SHORT_ENTRY,
  SignalType.SHORT_EXIT
]);

/**
 * TradeExecutionTask
 *
 * BullMQ processor for automated trade execution based on algorithm signals.
 * Runs every 5 minutes to check active algorithms and execute trades.
 */
@Processor('trade-execution')
@Injectable()
export class TradeExecutionTask extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(TradeExecutionTask.name);
  private jobScheduled = false;

  /** Per-activation throttle state persisted across cron cycles (keyed by activation ID) */
  private readonly throttleStates = new Map<string, ThrottleState>();

  constructor(
    @InjectQueue('trade-execution') private readonly tradeExecutionQueue: Queue,
    @InjectRepository(StrategyConfig)
    private readonly strategyConfigRepo: Repository<StrategyConfig>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly tradeExecutionService: TradeExecutionService,
    private readonly algorithmActivationService: AlgorithmActivationService,
    private readonly algorithmRegistry: AlgorithmRegistry,
    private readonly contextBuilder: AlgorithmContextBuilder,
    private readonly balanceService: BalanceService,
    private readonly coinService: CoinService,
    private readonly usersService: UsersService,
    private readonly tradingStateService: TradingStateService,
    private readonly tradeCooldownService: TradeCooldownService,
    private readonly signalThrottle: SignalThrottleService
  ) {
    super();
  }

  /**
   * Lifecycle hook that runs once when the module is initialized
   * Schedules the repeatable job for trade execution
   */
  async onModuleInit() {
    // Skip scheduling jobs in local development
    if (process.env.NODE_ENV === 'development' || process.env.DISABLE_TRADE_EXECUTION === 'true') {
      this.logger.log('Trade execution jobs disabled for local development');
      return;
    }

    if (!this.jobScheduled) {
      await this.scheduleTradeExecutionJob();
      this.jobScheduled = true;
    }
  }

  /**
   * Schedule the recurring job for trade execution
   */
  private async scheduleTradeExecutionJob() {
    // Check if there's already a scheduled job with the same name
    const repeatedJobs = await this.tradeExecutionQueue.getRepeatableJobs();
    const existingJob = repeatedJobs.find((job) => job.name === 'execute-trades');

    if (existingJob) {
      this.logger.log(`Trade execution job already scheduled with pattern: ${existingJob.pattern}`);
      return;
    }

    await this.tradeExecutionQueue.add(
      'execute-trades',
      {
        timestamp: new Date().toISOString(),
        description: 'Scheduled trade execution job'
      },
      {
        repeat: {
          pattern: CronExpression.EVERY_5_MINUTES
        },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 100, // keep the last 100 completed jobs
        removeOnFail: 50 // keep the last 50 failed jobs
      }
    );

    this.logger.log('Trade execution job scheduled with 5-minute cron pattern');
  }

  /**
   * BullMQ worker process method that handles trade execution
   */
  async process(job: Job) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);

    // Kill switch check — must be first before any trading activity
    if (!this.tradingStateService.isTradingEnabled()) {
      this.logger.warn('Trading is globally halted — skipping trade execution job');
      return { success: false, message: 'Trading globally halted' };
    }

    try {
      if (job.name === 'execute-trades') {
        return await this.handleExecuteTrades(job);
      } else {
        this.logger.warn(`Unknown job type: ${job.name}`);
        return { success: false, message: `Unknown job type: ${job.name}` };
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to process job ${job.id}: ${err.message}`, err.stack);
      throw error;
    }
  }

  private static readonly CONCURRENCY_LIMIT = 5;

  /**
   * Handle trade execution for all active algorithm activations
   */
  private async handleExecuteTrades(job: Job) {
    try {
      await job.updateProgress(10);

      const allActivations = await this.algorithmActivationService.findAllActiveAlgorithms();

      // Mutual exclusion: filter out users who have algoTradingEnabled=true
      // Those users are handled exclusively by Pipeline 1 (LiveTradingService)
      const activeActivations = await this.filterRoboAdvisorUsers(allActivations);

      this.logger.log(
        `Found ${allActivations.length} active activations, ${allActivations.length - activeActivations.length} ` +
          `skipped (robo-advisor users), ${activeActivations.length} to process`
      );

      if (activeActivations.length === 0) {
        return {
          totalActivations: 0,
          successCount: 0,
          failCount: 0,
          skippedCount: 0,
          blockedCount: 0,
          timestamp: new Date().toISOString()
        };
      }

      await job.updateProgress(20);

      const totalActivations = activeActivations.length;

      // Phase 1: Pre-populate portfolio cache (one fetch per unique user)
      const portfolioCache = new Map<string, number>();
      const uniqueUserIds = [...new Set(activeActivations.map((a) => a.userId))];
      for (const userId of uniqueUserIds) {
        const activation = activeActivations.find((a) => a.userId === userId);
        if (!activation) continue;
        portfolioCache.set(userId, await this.fetchPortfolioValue(activation));
      }

      // Phase 2: Group by exchangeKeyId to avoid CCXT client concurrency issues,
      // then process groups in parallel (up to CONCURRENCY_LIMIT) with sequential
      // processing within each group.
      let successCount = 0;
      let failCount = 0;
      let skippedCount = 0;
      let blockedCount = 0;
      let processedActivations = 0;

      const groups = this.groupByExchangeKey(activeActivations);
      const chunks = this.chunkArray(groups, TradeExecutionTask.CONCURRENCY_LIMIT);

      for (const chunk of chunks) {
        const results = await Promise.allSettled(
          chunk.map(async (group) => {
            const groupCounts = { success: 0, fail: 0, skipped: 0, blocked: 0 };
            for (const activation of group) {
              try {
                const outcome = await this.processActivation(activation, portfolioCache.get(activation.userId) ?? 0);
                if (outcome === 'executed') groupCounts.success++;
                else if (outcome === 'blocked') groupCounts.blocked++;
                else groupCounts.skipped++;
              } catch (error: unknown) {
                const err = toErrorInfo(error);
                this.logger.error(`Activation ${activation.id} processing failed: ${err.message}`, err.stack);
                groupCounts.fail++;
              }
            }
            return groupCounts;
          })
        );

        for (const result of results) {
          if (result.status === 'fulfilled') {
            successCount += result.value.success;
            failCount += result.value.fail;
            skippedCount += result.value.skipped;
            blockedCount += result.value.blocked;
          } else {
            const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
            this.logger.error(`Activation group processing failed: ${reason}`, result.reason?.stack);
            failCount++;
          }
        }

        const chunkActivationCount = chunk.reduce<number>((sum, group) => sum + group.length, 0);
        processedActivations += chunkActivationCount;
        const progressPercentage = Math.floor(20 + (processedActivations / totalActivations) * 70);
        await job.updateProgress(progressPercentage);
      }

      // Prune throttle states for deactivated activations to prevent unbounded growth
      const activeIds = new Set(activeActivations.map((a) => a.id));
      for (const key of this.throttleStates.keys()) {
        if (!activeIds.has(key)) this.throttleStates.delete(key);
      }

      await job.updateProgress(100);
      this.logger.log(
        `Trade execution complete: ${totalActivations} activations — ${successCount} executed, ${skippedCount} skipped, ${blockedCount} blocked, ${failCount} failed`
      );

      return {
        totalActivations,
        successCount,
        failCount,
        skippedCount,
        blockedCount,
        timestamp: new Date().toISOString()
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Trade execution failed: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Process a single activation: generate signal and execute trade
   * @returns 'executed' if a trade was placed, 'skipped' if no signal, 'blocked' if cooldown rejected
   */
  private async processActivation(
    activation: AlgorithmActivation,
    portfolioValue: number
  ): Promise<'executed' | 'skipped' | 'blocked'> {
    if (portfolioValue <= 0) {
      this.logger.warn(
        `Skipping activation ${activation.id}: portfolio value is $${portfolioValue} (cannot auto-size)`
      );
      return 'skipped';
    }

    const signal = await this.generateTradeSignal(activation, portfolioValue);

    if (signal) {
      // Trade cooldown: prevent double-trading if Pipeline 1 already placed this trade
      const cooldownCheck = await this.tradeCooldownService.checkAndClaim(
        signal.userId,
        signal.symbol,
        signal.action,
        `activation:${activation.id}`
      );

      if (!cooldownCheck.allowed) {
        this.logger.warn(
          `Trade cooldown blocked activation ${activation.id}: ${signal.action} ${signal.symbol} ` +
            `already claimed by ${cooldownCheck.existingClaim?.pipeline}`
        );
        return 'blocked';
      }

      try {
        await this.tradeExecutionService.executeTradeSignal(signal);
        this.logger.log(
          `Executed trade for activation ${activation.id} (${activation.algorithm.name}): ${signal.action} ${signal.symbol}`
        );
        return 'executed';
      } catch (error: unknown) {
        // Clear cooldown on failure so next cycle can retry
        await this.tradeCooldownService.clearCooldown(signal.userId, signal.symbol, signal.action);
        throw error;
      }
    }

    this.logger.debug(`No actionable signal for activation ${activation.id} (${activation.algorithm.name})`);
    return 'skipped';
  }

  /**
   * Generate a trade signal for an algorithm activation
   * @returns TradeSignalWithExit or null if no actionable trade
   */
  private async generateTradeSignal(
    activation: AlgorithmActivation,
    portfolioValue: number
  ): Promise<TradeSignalWithExit | null> {
    const algorithm = activation.algorithm;

    // Skip algorithms without a strategy
    if (!algorithm.strategyId && !algorithm.service) {
      this.logger.debug(`Algorithm ${algorithm.name} has no strategy configured, skipping`);
      return null;
    }

    // Build execution context
    const context = await this.contextBuilder.buildContext(algorithm);

    if (!this.contextBuilder.validateContext(context)) {
      this.logger.debug(`Context validation failed for algorithm ${algorithm.name}, skipping`);
      return null;
    }

    // Execute the algorithm strategy
    const result = await this.algorithmRegistry.executeAlgorithm(activation.algorithmId, context);

    if (!result.success || !result.signals || result.signals.length === 0) {
      return null;
    }

    // Filter to actionable signals with sufficient confidence
    const actionableSignals = result.signals.filter(
      (s) => ACTIONABLE_SIGNAL_TYPES.has(s.type) && s.confidence >= MIN_CONFIDENCE_THRESHOLD
    );

    if (actionableSignals.length === 0) {
      return null;
    }

    // Apply signal throttle: cooldowns, daily cap, min sell %
    const throttleState = this.getThrottleState(activation.id);
    const throttleConfig = this.signalThrottle.resolveConfig(activation.config as Record<string, unknown> | undefined);
    const throttleInput = actionableSignals.map((s) => this.signalThrottle.toThrottleSignal(s));
    const throttleOutput = this.signalThrottle.filterSignals(throttleInput, throttleState, throttleConfig, Date.now());

    if (throttleOutput.length === 0) {
      return null;
    }

    // Map accepted throttle signals back to original algorithm signals
    const acceptedKeys = new Set(throttleOutput.map((s) => `${s.coinId}:${s.action}`));
    const surviving = actionableSignals.filter((s) => {
      const t = this.signalThrottle.toThrottleSignal(s);
      return acceptedKeys.has(`${t.coinId}:${t.action}`);
    });

    // Pick the strongest signal by strength × confidence
    const bestSignal = surviving.reduce((best: TradingSignal, current: TradingSignal) =>
      current.strength * current.confidence > best.strength * best.confidence ? current : best
    );

    // Resolve trading symbol (e.g. "BTC/USDT")
    const symbol = await this.resolveTradingSymbol(bestSignal.coinId, activation);
    if (!symbol) {
      this.logger.warn(`Could not resolve trading symbol for coin ${bestSignal.coinId}, skipping`);
      return null;
    }

    const marketContext = await this.resolveMarketContext(activation);
    const mapped = this.mapSignalToAction(bestSignal.type, marketContext.marketType);
    if (!mapped) {
      this.logger.warn(`Unknown signal type ${bestSignal.type} for activation ${activation.id}, skipping`);
      return null;
    }
    const { action, positionSide } = mapped;

    return {
      algorithmActivationId: activation.id,
      userId: activation.userId,
      exchangeKeyId: activation.exchangeKeyId,
      action,
      symbol,
      quantity: 0,
      autoSize: true,
      portfolioValue,
      allocationPercentage: activation.allocationPercentage || 5.0,
      marketType: marketContext.marketType,
      leverage: marketContext.leverage,
      positionSide
    };
  }

  /**
   * Resolve market context (spot vs futures, leverage) for an activation.
   * Checks activation-level override first, then falls back to StrategyConfig.
   */
  private async resolveMarketContext(
    activation: AlgorithmActivation
  ): Promise<{ marketType: 'spot' | 'futures'; leverage: number }> {
    // 1. Per-activation override via config metadata
    const meta = activation.config?.metadata as Record<string, unknown> | undefined;
    if (meta?.marketType === MarketType.FUTURES) {
      return { marketType: 'futures', leverage: Number(meta.leverage) || 1 };
    }

    // 2. Canonical source: StrategyConfig linked to the algorithm
    try {
      const strategyConfig = await this.strategyConfigRepo.findOne({
        where: { algorithmId: activation.algorithmId, shadowStatus: 'live' }
      });

      if (strategyConfig?.marketType === MarketType.FUTURES) {
        return { marketType: 'futures', leverage: Number(strategyConfig.defaultLeverage) || 1 };
      }
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.debug(`Could not look up StrategyConfig for algorithm ${activation.algorithmId}: ${err.message}`);
    }

    return { marketType: 'spot', leverage: 1 };
  }

  /**
   * Map an algorithm SignalType to the action/positionSide that TradeExecutionService expects.
   */
  private mapSignalToAction(
    signalType: SignalType,
    marketType: 'spot' | 'futures'
  ): { action: 'BUY' | 'SELL'; positionSide?: 'long' | 'short' } | null {
    switch (signalType) {
      case SignalType.SHORT_ENTRY:
        return { action: 'SELL', positionSide: 'short' };
      case SignalType.SHORT_EXIT:
        return { action: 'BUY', positionSide: 'short' };
      case SignalType.BUY:
        return { action: 'BUY', positionSide: marketType === 'futures' ? 'long' : undefined };
      case SignalType.SELL:
        return { action: 'SELL', positionSide: marketType === 'futures' ? 'long' : undefined };
      default:
        return null;
    }
  }

  /**
   * Resolve a coin ID + exchange into a trading symbol (e.g. "BTC/USDT")
   */
  private async resolveTradingSymbol(coinId: string, activation: AlgorithmActivation): Promise<string | null> {
    try {
      const exchangeSlug = activation.exchangeKey?.exchange?.slug;
      if (!exchangeSlug) {
        this.logger.warn(`Activation ${activation.id} missing exchange relation, cannot resolve symbol`);
        return null;
      }

      const coin = await this.coinService.getCoinById(coinId);
      const quoteCurrency = EXCHANGE_QUOTE_CURRENCY[exchangeSlug] || DEFAULT_QUOTE_CURRENCY;
      return `${coin.symbol.toUpperCase()}/${quoteCurrency}`;
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to resolve trading symbol for coin ${coinId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Fetch total portfolio USD value for an activation's user
   * Returns 0 on error for graceful degradation
   */
  private async fetchPortfolioValue(activation: AlgorithmActivation): Promise<number> {
    try {
      const user = await this.usersService.getById(activation.userId);
      const balances = await this.balanceService.getUserBalances(user);
      return balances.totalUsdValue || 0;
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to fetch portfolio value for user ${activation.userId}: ${err.message}`);
      return 0;
    }
  }

  /**
   * Filter out activations belonging to robo-advisor users (algoTradingEnabled=true).
   * Those users are handled exclusively by Pipeline 1 (LiveTradingService).
   */
  private async filterRoboAdvisorUsers(activations: AlgorithmActivation[]): Promise<AlgorithmActivation[]> {
    if (activations.length === 0) return activations;

    const uniqueUserIds = [...new Set(activations.map((a) => a.userId))];

    const roboAdvisorUsers = await this.userRepo.find({
      where: { id: In(uniqueUserIds), algoTradingEnabled: true },
      select: ['id']
    });

    if (roboAdvisorUsers.length === 0) return activations;

    const roboUserIds = new Set(roboAdvisorUsers.map((u) => u.id));

    this.logger.log(
      `Filtering ${roboAdvisorUsers.length} robo-advisor user(s) from activation pipeline (handled by LiveTradingService)`
    );

    return activations.filter((a) => !roboUserIds.has(a.userId));
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private groupByExchangeKey(activations: AlgorithmActivation[]): AlgorithmActivation[][] {
    const groups = new Map<string, AlgorithmActivation[]>();
    for (const activation of activations) {
      const key = activation.exchangeKeyId;
      const group = groups.get(key) ?? [];
      group.push(activation);
      groups.set(key, group);
    }
    return [...groups.values()];
  }

  /** Get or create throttle state for an activation */
  private getThrottleState(activationId: string): ThrottleState {
    let state = this.throttleStates.get(activationId);
    if (!state) {
      state = this.signalThrottle.createState();
      this.throttleStates.set(activationId, state);
    }
    return state;
  }
}
