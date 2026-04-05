import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { Job, Queue } from 'bullmq';
import { In, Repository } from 'typeorm';

import { MarketType, SignalReasonCode, SignalSource, SignalStatus } from '@chansey/api-interfaces';

import { TradingStateService } from '../../admin/trading-state/trading-state.service';
import { AlgorithmActivation } from '../../algorithm/algorithm-activation.entity';
import { SignalType, TradingSignal } from '../../algorithm/interfaces';
import { AlgorithmRegistry } from '../../algorithm/registry/algorithm-registry.service';
import { AlgorithmActivationService } from '../../algorithm/services/algorithm-activation.service';
import { AlgorithmContextBuilder } from '../../algorithm/services/algorithm-context-builder.service';
import { BalanceService } from '../../balance/balance.service';
import { CoinService } from '../../coin/coin.service';
import { DEFAULT_QUOTE_CURRENCY, EXCHANGE_QUOTE_CURRENCY } from '../../exchange/constants';
import { ExchangeSelectionService } from '../../exchange/exchange-selection/exchange-selection.service';
import { FailedJobService } from '../../failed-jobs/failed-job.service';
import { MetricsService } from '../../metrics/metrics.service';
import { toErrorInfo } from '../../shared/error.util';
import { TradeCooldownService } from '../../shared/trade-cooldown.service';
import { ConcentrationGateService } from '../../strategy/concentration-gate.service';
import { DailyLossLimitGateService } from '../../strategy/daily-loss-limit-gate.service';
import { LiveTradingSignalAction } from '../../strategy/entities/live-trading-signal.entity';
import { StrategyConfig } from '../../strategy/entities/strategy-config.entity';
import { LiveSignalService } from '../../strategy/live-signal.service';
import { AssetAllocation } from '../../strategy/risk/concentration-check.service';
import { User } from '../../users/users.entity';
import { UsersService } from '../../users/users.service';
import { SignalThrottleService, ThrottleState } from '../backtest/shared/throttle';
import { TradeExecutionService, TradeSignalWithExit } from '../services/trade-execution.service';

interface GenerateSignalResult {
  signal: TradeSignalWithExit | null;
  skipReason?: {
    reasonCode: SignalReasonCode;
    reason: string;
    metadata?: Record<string, unknown>;
    partialSignal?: { action?: 'BUY' | 'SELL'; symbol?: string; confidence?: number; positionSide?: 'long' | 'short' };
  };
}

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
    private readonly signalThrottle: SignalThrottleService,
    private readonly dailyLossLimitGate: DailyLossLimitGateService,
    private readonly concentrationGate: ConcentrationGateService,
    private readonly metricsService: MetricsService,
    private readonly exchangeSelectionService: ExchangeSelectionService,
    private readonly failedJobService: FailedJobService,
    private readonly liveSignalService: LiveSignalService
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

  @OnWorkerEvent('failed')
  async onFailed(job: Job, error: Error): Promise<void> {
    try {
      await this.failedJobService.recordFailure({
        queueName: 'trade-execution',
        jobId: String(job.id),
        jobName: job.name,
        jobData: job.data,
        errorMessage: error.message,
        stackTrace: error.stack,
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts?.attempts ?? 0
      });
    } catch {
      // fail-safe
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

      // Phase 1: Pre-populate portfolio cache, balance cache, and daily loss limit check (one per unique user)
      const portfolioCache = new Map<string, number>();
      const balanceCache = new Map<string, AssetAllocation[]>();
      const userRiskLevels = new Map<string, number>();
      const dailyLossBlockedUsers = new Set<string>();
      const uniqueUserIds = [...new Set(activeActivations.map((a) => a.userId))];
      for (const userId of uniqueUserIds) {
        try {
          const user = await this.usersService.getById(userId);
          const balances = await this.balanceService.getUserBalances(user);
          const portfolioValue = balances.totalUsdValue || 0;
          portfolioCache.set(userId, portfolioValue);
          balanceCache.set(userId, this.concentrationGate.buildAssetAllocations(balances.current));
          userRiskLevels.set(userId, user.effectiveCalculationRiskLevel);

          // Daily loss limit gate: check per user
          const riskLevel = user.effectiveCalculationRiskLevel;
          const dailyLossCheck = await this.dailyLossLimitGate.isEntryBlocked(userId, portfolioValue, riskLevel);
          if (dailyLossCheck.blocked) {
            dailyLossBlockedUsers.add(userId);
            this.logger.warn(`Daily loss limit gate blocked user ${userId}: ${dailyLossCheck.reason}`);
          }
        } catch (error) {
          // Fail closed: set portfolio=0 (will skip activations) and block user
          const err = toErrorInfo(error);
          this.logger.warn(`User ${userId} pre-flight failed: ${err.message}, blocking as precaution`);
          portfolioCache.set(userId, 0);
          dailyLossBlockedUsers.add(userId);
        }
      }

      // Phase 2: Group by userId to serialize each user's trades,
      // then process groups in parallel (up to CONCURRENCY_LIMIT) with sequential
      // processing within each group.
      let successCount = 0;
      let failCount = 0;
      let skippedCount = 0;
      let blockedCount = 0;
      let processedActivations = 0;

      const groups = this.groupByUser(activeActivations);
      const chunks = this.chunkArray(groups, TradeExecutionTask.CONCURRENCY_LIMIT);

      for (const chunk of chunks) {
        const results = await Promise.allSettled(
          chunk.map(async (group) => {
            const groupCounts = { success: 0, fail: 0, skipped: 0, blocked: 0 };
            for (const activation of group) {
              try {
                const outcome = await this.processActivation(
                  activation,
                  portfolioCache.get(activation.userId) ?? 0,
                  dailyLossBlockedUsers,
                  balanceCache,
                  userRiskLevels
                );
                if (outcome === 'executed') groupCounts.success++;
                else if (outcome === 'blocked') groupCounts.blocked++;
                else groupCounts.skipped++;
              } catch (error: unknown) {
                const err = toErrorInfo(error);
                this.logger.error(`Activation ${activation.id} processing failed: ${err.message}`, err.stack);
                groupCounts.fail++;

                try {
                  await this.failedJobService.recordFailure({
                    queueName: 'trade-execution',
                    jobId: `activation:${activation.id}`,
                    jobName: 'processActivation',
                    jobData: {
                      userId: activation.userId,
                      activationId: activation.id,
                      algorithmId: activation.algorithmId
                    },
                    errorMessage: err.message,
                    stackTrace: err.stack
                  });
                } catch {
                  // fail-safe
                }
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
    portfolioValue: number,
    dailyLossBlockedUsers: Set<string> = new Set(),
    balanceCache: Map<string, AssetAllocation[]> = new Map(),
    userRiskLevels: Map<string, number> = new Map()
  ): Promise<'executed' | 'skipped' | 'blocked'> {
    if (portfolioValue <= 0) {
      this.logger.warn(
        `Skipping activation ${activation.id}: portfolio value is $${portfolioValue} (cannot auto-size)`
      );
      return 'skipped';
    }

    const { signal, skipReason } = await this.generateTradeSignal(activation, portfolioValue);

    if (signal) {
      // Skip BUY if user already holds this asset
      if (signal.action === 'BUY' && signal.positionSide !== 'short') {
        const userAssets = balanceCache.get(activation.userId) ?? [];
        const [baseCurrency] = signal.symbol.split('/');
        const existingHolding = userAssets.find(
          (a) => a.symbol.toUpperCase() === baseCurrency.toUpperCase() && a.usdValue > 1.0
        );
        if (existingHolding) {
          this.logger.debug(
            `Skipped BUY for ${signal.symbol}: user ${activation.userId} already holds ${baseCurrency}`
          );
          return 'skipped';
        }
      }

      // Daily loss limit gate: block entry signals when user's rolling 24h losses exceed threshold
      const isEntryAction =
        (signal.action === 'BUY' && signal.positionSide !== 'short') ||
        (signal.action === 'SELL' && signal.positionSide === 'short');
      if (dailyLossBlockedUsers.has(activation.userId) && isEntryAction) {
        this.metricsService.recordDailyLossGateBlock();
        this.logger.warn(
          `Daily loss limit blocked activation ${activation.id}: ${signal.action} ${signal.symbol} (entry) for user ${activation.userId}`
        );
        await this.recordActivationSignalOutcome(activation, signal, SignalStatus.BLOCKED, {
          reasonCode: SignalReasonCode.DAILY_LOSS_LIMIT,
          reason: `Daily loss limit blocked ${signal.action} ${signal.symbol}`,
          metadata: { portfolioValue }
        });
        return 'blocked';
      }

      // Concentration gate: block entry signals when single-asset concentration is too high
      if (isEntryAction) {
        const assets = balanceCache.get(activation.userId) ?? [];
        const riskLevel = userRiskLevels.get(activation.userId) ?? 3;
        const estimatedTradeUsd =
          (signal.portfolioValue ?? portfolioValue) * ((signal.allocationPercentage ?? 5) / 100);
        const concCheck = this.concentrationGate.checkTrade(
          assets,
          signal.symbol,
          estimatedTradeUsd,
          riskLevel,
          signal.action
        );
        if (!concCheck.allowed) {
          this.metricsService.recordConcentrationGateBlock();
          this.logger.warn(
            `Concentration gate blocked activation ${activation.id}: ${signal.action} ${signal.symbol} for user ${activation.userId}: ${concCheck.reason}`
          );
          await this.recordActivationSignalOutcome(activation, signal, SignalStatus.BLOCKED, {
            reasonCode: SignalReasonCode.CONCENTRATION_LIMIT,
            reason: concCheck.reason,
            metadata: { estimatedTradeUsd }
          });
          return 'blocked';
        }
      }

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
        await this.recordActivationSignalOutcome(activation, signal, SignalStatus.BLOCKED, {
          reasonCode: SignalReasonCode.TRADE_COOLDOWN,
          reason:
            `Trade cooldown blocked activation ${activation.id}: ${signal.action} ${signal.symbol} ` +
            `already claimed by ${cooldownCheck.existingClaim?.pipeline}`,
          metadata: { existingClaim: cooldownCheck.existingClaim?.pipeline }
        });
        return 'blocked';
      }

      try {
        const order = await this.tradeExecutionService.executeTradeSignal(signal);
        await this.recordActivationSignalOutcome(activation, signal, SignalStatus.PLACED, {
          orderId: order.id,
          quantity: Number(order.executedQuantity ?? order.quantity ?? signal.quantity)
        });
        this.logger.log(
          `Executed trade for activation ${activation.id} (${activation.algorithm.name}): ${signal.action} ${signal.symbol}`
        );
        return 'executed';
      } catch (error: unknown) {
        // Clear cooldown on failure so next cycle can retry
        await this.tradeCooldownService.clearCooldown(signal.userId, signal.symbol, signal.action);
        const err = toErrorInfo(error);
        await this.recordActivationSignalOutcome(activation, signal, SignalStatus.FAILED, {
          reasonCode: SignalReasonCode.ORDER_EXECUTION_FAILED,
          reason: err.message
        });
        throw error;
      }
    }

    if (skipReason) {
      await this.recordSkippedSignalOutcome(activation, skipReason);
      return 'blocked';
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
  ): Promise<GenerateSignalResult> {
    const algorithm = activation.algorithm;

    // Skip algorithms without a strategy
    if (!algorithm.strategyId && !algorithm.service) {
      this.logger.debug(`Algorithm ${algorithm.name} has no strategy configured, skipping`);
      return { signal: null };
    }

    // Build execution context
    const context = await this.contextBuilder.buildContext(algorithm);

    if (!this.contextBuilder.validateContext(context)) {
      this.logger.debug(`Context validation failed for algorithm ${algorithm.name}, skipping`);
      return { signal: null };
    }

    // Execute the algorithm strategy
    const result = await this.algorithmRegistry.executeAlgorithm(activation.algorithmId, context);

    if (!result.success || !result.signals || result.signals.length === 0) {
      return { signal: null };
    }

    // Filter to actionable signals with sufficient confidence
    const actionableSignals = result.signals.filter(
      (s) => ACTIONABLE_SIGNAL_TYPES.has(s.type) && s.confidence >= MIN_CONFIDENCE_THRESHOLD
    );

    if (actionableSignals.length === 0) {
      return { signal: null };
    }

    // Apply signal throttle: cooldowns, daily cap, min sell %
    const throttleState = this.getThrottleState(activation.id);
    const throttleConfig = this.signalThrottle.resolveConfig(activation.config as Record<string, unknown> | undefined);
    const throttleInput = actionableSignals.map((s) => this.signalThrottle.toThrottleSignal(s));
    const throttleOutput = this.signalThrottle.filterSignals(
      throttleInput,
      throttleState,
      throttleConfig,
      Date.now()
    ).accepted;

    if (throttleOutput.length === 0) {
      const bestThrottled = actionableSignals.reduce((best, cur) =>
        cur.strength * cur.confidence > best.strength * best.confidence ? cur : best
      );
      return {
        signal: null,
        skipReason: {
          reasonCode: SignalReasonCode.SIGNAL_THROTTLED,
          reason: `All ${actionableSignals.length} actionable signal(s) filtered by throttle`,
          metadata: { filteredCount: actionableSignals.length },
          partialSignal: {
            action: this.mapSignalToAction(bestThrottled.type, 'spot')?.action,
            symbol: bestThrottled.coinId,
            confidence: bestThrottled.confidence,
            positionSide: this.mapSignalToAction(bestThrottled.type, 'spot')?.positionSide
          }
        }
      };
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

    // Per-signal exitConfig takes priority over result-level exitConfig
    const exitConfig = bestSignal.exitConfig ?? result.exitConfig;

    // Resolve trading symbol (e.g. "BTC/USDT") — use default quote currency first
    const symbol = await this.resolveTradingSymbol(bestSignal.coinId);
    if (!symbol) {
      this.logger.warn(`Could not resolve trading symbol for coin ${bestSignal.coinId}, skipping`);
      return {
        signal: null,
        skipReason: {
          reasonCode: SignalReasonCode.SYMBOL_RESOLUTION_FAILED,
          reason: `Could not resolve trading symbol for coin ${bestSignal.coinId}`,
          metadata: { coinId: bestSignal.coinId },
          partialSignal: { confidence: bestSignal.confidence }
        }
      };
    }

    const marketContext = await this.resolveMarketContext(activation);
    const mapped = this.mapSignalToAction(bestSignal.type, marketContext.marketType);
    if (!mapped) {
      this.logger.warn(`Unknown signal type ${bestSignal.type} for activation ${activation.id}, skipping`);
      return {
        signal: null,
        skipReason: {
          reasonCode: SignalReasonCode.SIGNAL_VALIDATION_FAILED,
          reason: `Unknown signal type ${bestSignal.type} for activation ${activation.id}`,
          metadata: { signalType: bestSignal.type },
          partialSignal: { symbol, confidence: bestSignal.confidence }
        }
      };
    }
    const { action, positionSide } = mapped;

    // Dynamically select exchange key based on signal action
    let exchangeKey;
    try {
      exchangeKey =
        action === 'BUY'
          ? await this.exchangeSelectionService.selectForBuy(activation.userId, symbol)
          : await this.exchangeSelectionService.selectForSell(activation.userId, symbol);
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.warn(`Exchange selection failed for activation ${activation.id}: ${err.message}`);
      return {
        signal: null,
        skipReason: {
          reasonCode: SignalReasonCode.EXCHANGE_SELECTION_FAILED,
          reason: `Exchange selection failed: ${err.message}`,
          metadata: { errorMessage: err.message },
          partialSignal: { action, symbol, confidence: bestSignal.confidence, positionSide }
        }
      };
    }

    // Re-resolve symbol with correct exchange-specific quote currency if needed
    const exchangeSlug = exchangeKey.exchange?.slug;
    const finalSymbol = exchangeSlug
      ? ((await this.resolveTradingSymbol(bestSignal.coinId, exchangeSlug)) ?? symbol)
      : symbol;

    return {
      signal: {
        algorithmActivationId: activation.id,
        userId: activation.userId,
        exchangeKeyId: exchangeKey.id,
        action,
        symbol: finalSymbol,
        quantity: 0,
        confidence: bestSignal.confidence,
        autoSize: true,
        portfolioValue,
        allocationPercentage: activation.allocationPercentage || 5.0,
        marketType: marketContext.marketType,
        leverage: marketContext.leverage,
        positionSide,
        exitConfig
      }
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
   * Resolve a coin ID into a trading symbol (e.g. "BTC/USDT")
   * @param exchangeSlug - Exchange slug for quote currency lookup (optional)
   */
  private async resolveTradingSymbol(coinId: string, exchangeSlug?: string): Promise<string | null> {
    try {
      const coin = await this.coinService.getCoinById(coinId);
      const quoteCurrency = exchangeSlug
        ? EXCHANGE_QUOTE_CURRENCY[exchangeSlug] || DEFAULT_QUOTE_CURRENCY
        : DEFAULT_QUOTE_CURRENCY;
      return `${coin.symbol.toUpperCase()}/${quoteCurrency}`;
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to resolve trading symbol for coin ${coinId}: ${err.message}`);
      return null;
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

  /**
   * Groups activations by userId (not exchangeKeyId) because exchange keys are
   * selected dynamically per-activation at trade time. Per-user serialization
   * prevents concurrent portfolio/balance reads for the same user, while different
   * users' trades are parallelized via CONCURRENCY_LIMIT chunking.
   */
  private groupByUser(activations: AlgorithmActivation[]): AlgorithmActivation[][] {
    const groups = new Map<string, AlgorithmActivation[]>();
    for (const activation of activations) {
      const key = activation.userId;
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

  private async recordActivationSignalOutcome(
    activation: AlgorithmActivation,
    signal: TradeSignalWithExit,
    status: SignalStatus,
    details: {
      reasonCode?: SignalReasonCode;
      reason?: string;
      metadata?: Record<string, unknown>;
      orderId?: string;
      quantity?: number;
    }
  ): Promise<void> {
    try {
      await this.liveSignalService.recordOutcome({
        userId: activation.userId,
        algorithmActivationId: activation.id,
        action: this.toLiveSignalAction(signal.action, signal.positionSide),
        symbol: signal.symbol,
        quantity: details.quantity ?? signal.quantity,
        confidence: signal.confidence,
        status,
        reasonCode: details.reasonCode,
        reason: details.reason,
        metadata: details.metadata,
        orderId: details.orderId,
        source: SignalSource.LIVE_TRADING
      });
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to record signal outcome for activation ${activation.id}: ${err.message}`, err.stack);
    }
  }

  private async recordSkippedSignalOutcome(
    activation: AlgorithmActivation,
    skipReason: NonNullable<GenerateSignalResult['skipReason']>
  ): Promise<void> {
    try {
      const partial = skipReason.partialSignal ?? {};
      const action = partial.action ?? 'BUY';
      const symbol = partial.symbol ?? 'UNKNOWN';
      await this.liveSignalService.recordOutcome({
        userId: activation.userId,
        algorithmActivationId: activation.id,
        action: this.toLiveSignalAction(action, partial.positionSide),
        symbol,
        quantity: 0,
        confidence: partial.confidence,
        status: SignalStatus.BLOCKED,
        reasonCode: skipReason.reasonCode,
        reason: skipReason.reason,
        metadata: skipReason.metadata,
        source: SignalSource.LIVE_TRADING
      });
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(
        `Failed to record skipped signal outcome for activation ${activation.id}: ${err.message}`,
        err.stack
      );
    }
  }

  private toLiveSignalAction(action: 'BUY' | 'SELL', positionSide?: 'long' | 'short'): LiveTradingSignalAction {
    if (positionSide === 'short') {
      return action === 'BUY' ? LiveTradingSignalAction.SHORT_EXIT : LiveTradingSignalAction.SHORT_ENTRY;
    }

    return action === 'BUY' ? LiveTradingSignalAction.BUY : LiveTradingSignalAction.SELL;
  }
}
