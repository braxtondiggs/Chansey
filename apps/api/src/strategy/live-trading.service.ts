import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { CapitalAllocationService } from './capital-allocation.service';
import { PositionTrackingService } from './position-tracking.service';
import { RiskPoolMappingService } from './risk-pool-mapping.service';
import { MarketData, StrategyExecutorService, TradingSignal } from './strategy-executor.service';

import { TradingStateService } from '../admin/trading-state/trading-state.service';
import { BalanceService } from '../balance/balance.service';
import { ExchangeBalanceDto } from '../balance/dto';
import { SupportedExchangeKeyDto } from '../exchange/exchange-key/dto';
import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { OrderService } from '../order/order.service';
import { LOCK_DEFAULTS, LOCK_KEYS } from '../shared/distributed-lock.constants';
import { DistributedLockService } from '../shared/distributed-lock.service';
import { toErrorInfo } from '../shared/error.util';
import { User } from '../users/users.entity';

/** Maximum consecutive errors before disabling algo trading for a user */
const MAX_ERROR_STRIKES = 3;

/**
 * Orchestrates live trading for all enrolled robo-advisor users.
 * Runs strategies every 2 minutes and places orders on user exchanges.
 */
@Injectable()
export class LiveTradingService implements OnApplicationShutdown {
  private readonly logger = new Logger(LiveTradingService.name);
  private currentLockId: string | null = null;
  /** Tracks consecutive error count per user for strike-based disabling */
  private readonly userErrorStrikes = new Map<string, number>();

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly riskPoolMapping: RiskPoolMappingService,
    private readonly capitalAllocation: CapitalAllocationService,
    private readonly positionTracking: PositionTrackingService,
    private readonly strategyExecutor: StrategyExecutorService,
    private readonly orderService: OrderService,
    private readonly balanceService: BalanceService,
    private readonly lockService: DistributedLockService,
    private readonly exchangeManager: ExchangeManagerService,
    private readonly tradingStateService: TradingStateService
  ) {}

  @Cron('*/2 * * * *')
  async executeLiveTrading(): Promise<void> {
    // KILL SWITCH CHECK - must be first before any trading activity
    if (!this.tradingStateService.isTradingEnabled()) {
      this.logger.warn('Live trading is globally halted - skipping execution cycle');
      return;
    }

    const lockResult = await this.lockService.acquire({
      key: LOCK_KEYS.LIVE_TRADING,
      ttlMs: LOCK_DEFAULTS.LIVE_TRADING_TTL_MS
    });

    if (!lockResult.acquired) {
      this.logger.debug('Live trading already running on another instance, skipping this cycle');
      return;
    }

    this.currentLockId = lockResult.lockId;

    try {
      const enrolledUsers = await this.userRepo.find({
        where: { algoTradingEnabled: true },
        relations: ['risk']
      });

      if (enrolledUsers.length === 0) {
        this.logger.debug('No users enrolled in algo trading');
        return;
      }

      this.logger.log(`Executing strategies for ${enrolledUsers.length} enrolled users`);

      for (const user of enrolledUsers) {
        try {
          await this.executeUserStrategies(user);
          // Clear error strikes on successful execution
          this.userErrorStrikes.delete(user.id);
        } catch (error: unknown) {
          const err = toErrorInfo(error);
          this.logger.error(`Failed to execute strategies for user ${user.id}: ${err.message}`);
          await this.handleUserError(user, error);
        }
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Live trading cycle failed: ${err.message}`, err.stack);
    } finally {
      await this.lockService.release(LOCK_KEYS.LIVE_TRADING, this.currentLockId);
      this.currentLockId = null;
    }
  }

  private async executeUserStrategies(user: User): Promise<void> {
    if (!user.algoCapitalAllocationPercentage || user.algoCapitalAllocationPercentage <= 0) {
      this.logger.debug(`User ${user.id} has no capital allocation percentage set, skipping`);
      return;
    }

    if (!user.exchanges || user.exchanges.length === 0) {
      this.logger.debug(`User ${user.id} has no exchange keys configured`);
      return;
    }

    // Fetch user's free balance from exchange
    const balances = await this.balanceService.getUserBalances(user, false);
    const totalFreeUsdValue = this.calculateFreeUsdValue(balances.current);

    if (totalFreeUsdValue <= 0) {
      this.logger.warn(`User ${user.id} has no free balance available`);
      return;
    }

    // Calculate actual capital from percentage
    const actualCapital = (totalFreeUsdValue * Number(user.algoCapitalAllocationPercentage)) / 100;

    this.logger.debug(
      `User ${user.id}: Free balance $${totalFreeUsdValue.toFixed(2)}, ` +
        `${user.algoCapitalAllocationPercentage}% = $${actualCapital.toFixed(2)} for algo trading`
    );

    const strategies = await this.riskPoolMapping.getActiveStrategiesForUser(user);

    if (strategies.length === 0) {
      this.logger.debug(`No active strategies for user ${user.id} (risk level ${user.risk?.level})`);
      return;
    }

    const capitalMap = await this.capitalAllocation.allocateCapitalByPerformance(actualCapital, strategies);

    const userPositions = await this.positionTracking.getPositions(user.id);

    const marketData = await this.fetchMarketData();

    for (const strategy of strategies) {
      try {
        const allocatedCapital = capitalMap.get(strategy.id) || 0;
        const strategyPositions = userPositions.filter((p) => p.strategyConfigId === strategy.id);

        const signal = await this.strategyExecutor.executeStrategy(
          strategy,
          marketData,
          strategyPositions,
          allocatedCapital
        );

        if (signal && signal.action !== 'hold') {
          const validation = this.strategyExecutor.validateSignal(signal, allocatedCapital);
          if (!validation.valid) {
            this.logger.warn(`Invalid signal for user ${user.id}, strategy ${strategy.id}: ${validation.reason}`);
            continue;
          }

          await this.placeOrder(user, strategy.id, signal);
        }
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Strategy ${strategy.id} execution failed for user ${user.id}: ${err.message}`);
      }
    }
  }

  private async placeOrder(user: User, strategyConfigId: string, signal: TradingSignal): Promise<void> {
    try {
      const exchangeKey = this.selectBestExchange(user.exchanges, signal.symbol);
      if (!exchangeKey) {
        this.logger.error(`No suitable exchange key found for user ${user.id} and symbol ${signal.symbol}`);
        return;
      }

      // Type guard: signal.action is guaranteed to be 'buy' | 'sell' by caller check
      const orderSignal = {
        action: signal.action as 'buy' | 'sell',
        symbol: signal.symbol,
        quantity: signal.quantity,
        price: signal.price
      };

      const order = await this.orderService.placeAlgorithmicOrder(
        user.id,
        strategyConfigId,
        orderSignal,
        exchangeKey.id
      );

      this.logger.log(
        `Order placed for user ${user.id}: ${signal.action} ${signal.quantity} ${signal.symbol} ` +
          `on ${exchangeKey.name} (Order ID: ${order.id})`
      );

      await this.positionTracking.updatePosition(
        user.id,
        strategyConfigId,
        signal.symbol,
        signal.quantity,
        signal.price,
        signal.action === 'buy' ? 'buy' : 'sell'
      );
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to place order for user ${user.id}: ${err.message}`);
      throw error;
    }
  }

  /**
   * Select the best exchange for a given trading symbol.
   * Prioritizes active exchanges that support the symbol.
   */
  private selectBestExchange(exchanges: SupportedExchangeKeyDto[], symbol: string): SupportedExchangeKeyDto | null {
    if (!exchanges || exchanges.length === 0) {
      return null;
    }

    // Filter to only active exchanges
    const activeExchanges = exchanges.filter((ex) => ex.isActive);

    if (activeExchanges.length === 0) {
      this.logger.warn('No active exchanges found');
      return null;
    }

    // For BTC pairs, prefer Binance US for better liquidity
    // For other pairs, use the first active exchange
    const baseCurrency = symbol.split('/')[0];
    if (baseCurrency === 'BTC' || baseCurrency === 'ETH') {
      const binance = activeExchanges.find((ex) => ex.slug === 'binance_us');
      if (binance) {
        return binance;
      }
    }

    // Default to first active exchange
    return activeExchanges[0];
  }

  /**
   * Fetch current market data for common trading pairs.
   * Uses the exchange manager to get real-time prices from connected exchanges.
   */
  private async fetchMarketData(): Promise<MarketData[]> {
    const marketData: MarketData[] = [];
    const tradingPairs = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'ADA/USDT'];

    try {
      // Use Binance US as the default price source for consistency
      const exchangeSlug = 'binance_us';

      for (const symbol of tradingPairs) {
        try {
          const priceData = await this.exchangeManager.getPrice(exchangeSlug, symbol);
          marketData.push({
            symbol,
            price: parseFloat(priceData.price),
            timestamp: new Date(priceData.timestamp),
            volume: undefined // Volume not available from basic price endpoint
          });
        } catch (error: unknown) {
          const err = toErrorInfo(error);
          this.logger.debug(`Failed to fetch price for ${symbol}: ${err.message}`);
          // Continue with other pairs even if one fails
        }
      }

      this.logger.debug(`Fetched market data for ${marketData.length} trading pairs`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to fetch market data: ${err.message}`);
    }

    return marketData;
  }

  /**
   * Handle user execution errors with strike-based disabling.
   * Users get MAX_ERROR_STRIKES chances before algo trading is disabled.
   */
  private async handleUserError(user: User, error: unknown): Promise<void> {
    const err = toErrorInfo(error);
    const currentStrikes = (this.userErrorStrikes.get(user.id) || 0) + 1;
    this.userErrorStrikes.set(user.id, currentStrikes);

    if (currentStrikes >= MAX_ERROR_STRIKES) {
      this.logger.error(
        `Disabling algo trading for user ${user.id} after ${currentStrikes} consecutive errors: ${err.message}`
      );

      try {
        user.algoTradingEnabled = false;
        await this.userRepo.save(user);
        this.userErrorStrikes.delete(user.id);
      } catch (saveError: unknown) {
        const innerErr = toErrorInfo(saveError);
        this.logger.error(`Failed to disable algo trading for user ${user.id}: ${innerErr.message}`);
      }
    } else {
      this.logger.warn(
        `User ${user.id} error strike ${currentStrikes}/${MAX_ERROR_STRIKES}: ${err.message}. ` +
          `Algo trading will be disabled after ${MAX_ERROR_STRIKES - currentStrikes} more errors.`
      );
    }
  }

  /**
   * Calculate total free (available) USD value across all exchanges.
   * Free balance = balance.free (not locked in orders).
   */
  private calculateFreeUsdValue(exchanges: ExchangeBalanceDto[]): number {
    let totalFree = 0;

    for (const exchange of exchanges) {
      for (const balance of exchange.balances || []) {
        const freeAmount = parseFloat(balance.free || '0');
        const usdValue = balance.usdValue || 0;

        // Calculate free portion of USD value
        const totalAmount = parseFloat(balance.free || '0') + parseFloat(balance.locked || '0');
        if (totalAmount > 0) {
          const freePercentage = freeAmount / totalAmount;
          totalFree += usdValue * freePercentage;
        }
      }
    }

    return totalFree;
  }

  async getStatus(): Promise<{ running: boolean; enrolledUsers: number; instanceId?: string }> {
    const [lockInfo, enrolledCount] = await Promise.all([
      this.lockService.getLockInfo(LOCK_KEYS.LIVE_TRADING),
      this.userRepo.count({ where: { algoTradingEnabled: true } })
    ]);

    return {
      running: lockInfo.exists,
      enrolledUsers: enrolledCount,
      instanceId: lockInfo.lockId ?? undefined
    };
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    if (this.currentLockId) {
      this.logger.log(`Releasing live trading lock on shutdown (signal: ${signal})`);
      await this.lockService.release(LOCK_KEYS.LIVE_TRADING, this.currentLockId);
      this.currentLockId = null;
    }
  }
}
