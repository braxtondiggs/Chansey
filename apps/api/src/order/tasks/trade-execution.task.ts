import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { Job, Queue } from 'bullmq';

import { AlgorithmActivation } from '../../algorithm/algorithm-activation.entity';
import { SignalType, TradingSignal } from '../../algorithm/interfaces';
import { AlgorithmRegistry } from '../../algorithm/registry/algorithm-registry.service';
import { AlgorithmActivationService } from '../../algorithm/services/algorithm-activation.service';
import { AlgorithmContextBuilder } from '../../algorithm/services/algorithm-context-builder.service';
import { BalanceService } from '../../balance/balance.service';
import { CoinService } from '../../coin/coin.service';
import { toErrorInfo } from '../../shared/error.util';
import { UsersService } from '../../users/users.service';
import { TradeExecutionService, TradeSignalWithExit } from '../services/trade-execution.service';

const MIN_CONFIDENCE_THRESHOLD = 0.6;
const ACTIONABLE_SIGNAL_TYPES = new Set([SignalType.BUY, SignalType.SELL]);
const EXCHANGE_QUOTE_CURRENCY: Record<string, string> = {
  binance_us: 'USDT',
  coinbase: 'USD'
};
const DEFAULT_QUOTE_CURRENCY = 'USDT';

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

  constructor(
    @InjectQueue('trade-execution') private readonly tradeExecutionQueue: Queue,
    private readonly tradeExecutionService: TradeExecutionService,
    private readonly algorithmActivationService: AlgorithmActivationService,
    private readonly algorithmRegistry: AlgorithmRegistry,
    private readonly contextBuilder: AlgorithmContextBuilder,
    private readonly balanceService: BalanceService,
    private readonly coinService: CoinService,
    private readonly usersService: UsersService
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

  /**
   * Handle trade execution for all active algorithm activations
   */
  private async handleExecuteTrades(job: Job) {
    try {
      await job.updateProgress(10);

      const activeActivations = await this.algorithmActivationService.findAllActiveAlgorithms();

      this.logger.log(`Found ${activeActivations.length} active algorithm activations`);

      if (activeActivations.length === 0) {
        return {
          totalActivations: 0,
          successCount: 0,
          failCount: 0,
          skippedCount: 0,
          timestamp: new Date().toISOString()
        };
      }

      await job.updateProgress(20);

      let successCount = 0;
      let failCount = 0;
      let skippedCount = 0;

      const totalActivations = activeActivations.length;
      let processedActivations = 0;

      // Cache portfolio value per user to avoid redundant exchange API calls
      const portfolioCache = new Map<string, number>();

      for (const activation of activeActivations) {
        try {
          // Get cached or fetch portfolio value
          let portfolioValue = portfolioCache.get(activation.userId);
          if (portfolioValue === undefined) {
            portfolioValue = await this.fetchPortfolioValue(activation);
            portfolioCache.set(activation.userId, portfolioValue);
          }

          const signal = await this.generateTradeSignal(activation, portfolioValue);

          if (signal) {
            await this.tradeExecutionService.executeTradeSignal(signal);
            this.logger.log(
              `Executed trade for activation ${activation.id} (${activation.algorithm.name}): ${signal.action} ${signal.symbol}`
            );
            successCount++;
          } else {
            this.logger.debug(`No actionable signal for activation ${activation.id} (${activation.algorithm.name})`);
            skippedCount++;
          }
        } catch (error: unknown) {
          const err = toErrorInfo(error);
          this.logger.error(`Failed to execute trade for activation ${activation.id}: ${err.message}`, err.stack);
          failCount++;
        }

        processedActivations++;
        const progressPercentage = Math.floor(20 + (processedActivations / totalActivations) * 70);
        await job.updateProgress(progressPercentage);
      }

      await job.updateProgress(100);
      this.logger.log(
        `Trade execution complete: ${totalActivations} activations — ${successCount} executed, ${skippedCount} skipped, ${failCount} failed`
      );

      return {
        totalActivations,
        successCount,
        failCount,
        skippedCount,
        timestamp: new Date().toISOString()
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Trade execution failed: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Generate a trade signal for an algorithm activation
   * @returns TradeSignalWithExit or null if no actionable trade
   */
  async generateTradeSignal(
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

    // Pick the strongest signal by strength × confidence
    const bestSignal = actionableSignals.reduce((best: TradingSignal, current: TradingSignal) =>
      current.strength * current.confidence > best.strength * best.confidence ? current : best
    );

    // Resolve trading symbol (e.g. "BTC/USDT")
    const symbol = await this.resolveTradingSymbol(bestSignal.coinId, activation);
    if (!symbol) {
      this.logger.warn(`Could not resolve trading symbol for coin ${bestSignal.coinId}, skipping`);
      return null;
    }

    return {
      algorithmActivationId: activation.id,
      userId: activation.userId,
      exchangeKeyId: activation.exchangeKeyId,
      action: bestSignal.type as 'BUY' | 'SELL',
      symbol,
      quantity: 0,
      autoSize: true,
      portfolioValue
    };
  }

  /**
   * Resolve a coin ID + exchange into a trading symbol (e.g. "BTC/USDT")
   */
  async resolveTradingSymbol(coinId: string, activation: AlgorithmActivation): Promise<string | null> {
    try {
      const coin = await this.coinService.getCoinById(coinId);
      const exchangeSlug = activation.exchangeKey?.exchange?.slug;
      const quoteCurrency = EXCHANGE_QUOTE_CURRENCY[exchangeSlug] || DEFAULT_QUOTE_CURRENCY;
      return `${coin.symbol.toUpperCase()}/${quoteCurrency}`;
    } catch {
      return null;
    }
  }

  /**
   * Fetch total portfolio USD value for an activation's user
   * Returns 0 on error for graceful degradation
   */
  async fetchPortfolioValue(activation: AlgorithmActivation): Promise<number> {
    try {
      const user = await this.usersService.getById(activation.userId, true);
      const balances = await this.balanceService.getUserBalances(user);
      return balances.totalUsdValue || 0;
    } catch (error) {
      this.logger.warn(`Failed to fetch portfolio value for user ${activation.userId}: ${error.message}`);
      return 0;
    }
  }
}
