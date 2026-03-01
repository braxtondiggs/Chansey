import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { MarketType, PositionSide } from '@chansey/api-interfaces';

import { CapitalAllocationService } from './capital-allocation.service';
import { StrategyConfig } from './entities/strategy-config.entity';
import { PositionTrackingService } from './position-tracking.service';
import { PreTradeRiskGateService } from './pre-trade-risk-gate.service';
import { RiskPoolMappingService } from './risk-pool-mapping.service';
import { MarketData, StrategyExecutorService, TradingSignal } from './strategy-executor.service';

import { TradingStateService } from '../admin/trading-state/trading-state.service';
import { BalanceService } from '../balance/balance.service';
import { ExchangeBalanceDto } from '../balance/dto';
import { DEFAULT_QUOTE_CURRENCY, EXCHANGE_QUOTE_CURRENCY } from '../exchange/constants';
import { SupportedExchangeKeyDto } from '../exchange/exchange-key/dto';
import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { CompositeRegimeService } from '../market-regime/composite-regime.service';
import { RegimeGateService } from '../market-regime/regime-gate.service';
import { MetricsService } from '../metrics/metrics.service';
import { OrderService } from '../order/order.service';
import { TradeExecutionService, TradeSignalWithExit } from '../order/services/trade-execution.service';
import { LOCK_DEFAULTS, LOCK_KEYS } from '../shared/distributed-lock.constants';
import { DistributedLockService } from '../shared/distributed-lock.service';
import { toErrorInfo } from '../shared/error.util';
import { TradeCooldownService } from '../shared/trade-cooldown.service';
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
    private readonly tradingStateService: TradingStateService,
    private readonly compositeRegimeService: CompositeRegimeService,
    private readonly regimeGateService: RegimeGateService,
    private readonly preTradeRiskGate: PreTradeRiskGateService,
    private readonly tradeExecutionService: TradeExecutionService,
    private readonly tradeCooldownService: TradeCooldownService,
    private readonly metricsService: MetricsService
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

    // Get current composite regime for position sizing (reused for gate below)
    const compositeRegime = this.compositeRegimeService.getCompositeRegime();

    const capitalMap = await this.capitalAllocation.allocateCapitalByKelly(actualCapital, strategies, {
      compositeRegime,
      riskLevel: user.risk?.level ?? 3
    });

    const userPositions = await this.positionTracking.getPositions(user.id);

    const marketData = await this.fetchMarketData();

    const volatilityRegime = this.compositeRegimeService.getVolatilityRegime();
    const trendAboveSma = this.compositeRegimeService.getTrendAboveSma();
    const overrideActive = this.compositeRegimeService.isOverrideActive();
    let gateBlockedCount = 0;
    let drawdownBlockedCount = 0;

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
          const action: Exclude<typeof signal.action, 'hold'> = signal.action as Exclude<typeof signal.action, 'hold'>;

          const validation = this.strategyExecutor.validateSignal(signal, allocatedCapital);
          if (!validation.valid) {
            this.logger.warn(`Invalid signal for user ${user.id}, strategy ${strategy.id}: ${validation.reason}`);
            continue;
          }

          // Regime gate: block BUY signals in bear/extreme regimes
          const gateDecision = this.regimeGateService.filterLiveSignal(
            action,
            compositeRegime,
            overrideActive,
            volatilityRegime,
            trendAboveSma
          );
          if (!gateDecision.allowed) {
            this.metricsService.recordRegimeGateBlock(compositeRegime);
            gateBlockedCount++;
            continue;
          }

          // Drawdown gate: block BUY signals when deployment is in drawdown breach
          const drawdownCheck = await this.preTradeRiskGate.checkDrawdown(strategy.id, action);
          if (!drawdownCheck.allowed) {
            this.metricsService.recordDrawdownGateBlock();
            drawdownBlockedCount++;
            continue;
          }

          await this.placeOrder(user, strategy.id, signal, strategy);
        }
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Strategy ${strategy.id} execution failed for user ${user.id}: ${err.message}`);
      }
    }

    if (gateBlockedCount > 0) {
      this.logger.log(
        `Regime gate blocked ${gateBlockedCount} signal(s) for user ${user.id} (regime=${compositeRegime})`
      );
    }

    if (drawdownBlockedCount > 0) {
      this.logger.log(`Drawdown gate blocked ${drawdownBlockedCount} BUY signal(s) for user ${user.id}`);
    }
  }

  private async placeOrder(
    user: User,
    strategyConfigId: string,
    signal: TradingSignal,
    strategy: StrategyConfig
  ): Promise<void> {
    try {
      const exchangeKey = this.selectBestExchange(user.exchanges, signal.symbol);
      if (!exchangeKey) {
        this.logger.error(`No suitable exchange key found for user ${user.id} and symbol ${signal.symbol}`);
        return;
      }

      // Trade cooldown: prevent double-trading if Pipeline 2 already placed this trade
      const direction = this.mapSignalActionToDirection(signal.action);
      const cooldownCheck = await this.tradeCooldownService.checkAndClaim(
        user.id,
        signal.symbol,
        direction,
        `strategy:${strategyConfigId}`
      );

      if (!cooldownCheck.allowed) {
        this.metricsService.recordTradeCooldownBlock(direction, signal.symbol);
        this.logger.warn(
          `Trade cooldown blocked strategy ${strategyConfigId} for user ${user.id}: ` +
            `${direction} ${signal.symbol} already claimed by ${cooldownCheck.existingClaim?.pipeline}`
        );
        return;
      }

      this.metricsService.recordTradeCooldownClaim(direction, signal.symbol);

      try {
        const isFutures =
          signal.action === 'short_entry' ||
          signal.action === 'short_exit' ||
          strategy.marketType === MarketType.FUTURES;

        if (isFutures) {
          // Route futures signals through TradeExecutionService which has full futures support
          const { action, positionSide } = this.mapLiveSignalToTradeAction(signal.action, strategy.marketType);
          const tradeSignal: TradeSignalWithExit = {
            algorithmActivationId: strategyConfigId,
            userId: user.id,
            exchangeKeyId: exchangeKey.id,
            action,
            symbol: signal.symbol,
            quantity: signal.quantity,
            marketType: 'futures',
            positionSide,
            leverage: Number(strategy.defaultLeverage) || 1
          };

          await this.tradeExecutionService.executeTradeSignal(tradeSignal);
          this.metricsService.recordLiveOrderPlaced('futures', action);

          this.logger.log(
            `Futures order placed for user ${user.id}: ${action} ${signal.quantity} ${signal.symbol} ` +
              `positionSide=${positionSide} leverage=${tradeSignal.leverage}x on ${exchangeKey.name}`
          );
        } else {
          // Spot path — unchanged
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
          this.metricsService.recordLiveOrderPlaced('spot', signal.action);

          this.logger.log(
            `Order placed for user ${user.id}: ${signal.action} ${signal.quantity} ${signal.symbol} ` +
              `on ${exchangeKey.name} (Order ID: ${order.id})`
          );
        }

        const { side: trackingSide, positionSide: trackingPositionSide } = this.mapSignalToPositionTracking(
          signal.action
        );
        await this.positionTracking.updatePosition(
          user.id,
          strategyConfigId,
          signal.symbol,
          signal.quantity,
          signal.price,
          trackingSide,
          trackingPositionSide
        );
      } catch (error: unknown) {
        // Clear cooldown on failure so next cycle can retry
        await this.tradeCooldownService.clearCooldown(user.id, signal.symbol, direction);
        this.metricsService.recordTradeCooldownCleared('order_failure');
        throw error;
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to place order for user ${user.id}: ${err.message}`);
      throw error;
    }
  }

  /**
   * Map a signal action string to a BUY/SELL direction for cooldown keys.
   */
  private mapSignalActionToDirection(action: string): string {
    switch (action) {
      case 'buy':
      case 'short_exit':
        return 'BUY';
      case 'sell':
      case 'short_entry':
        return 'SELL';
      default:
        this.logger.warn(
          `Unexpected signal action "${action}" — using "${action.toUpperCase()}" as cooldown direction`
        );
        return action.toUpperCase();
    }
  }

  /**
   * Map a live trading signal action to the BUY/SELL + positionSide that TradeExecutionService expects.
   */
  private mapLiveSignalToTradeAction(
    action: string,
    marketType: string
  ): { action: 'BUY' | 'SELL'; positionSide?: 'long' | 'short' } {
    switch (action) {
      case 'short_entry':
        return { action: 'SELL', positionSide: PositionSide.SHORT };
      case 'short_exit':
        return { action: 'BUY', positionSide: PositionSide.SHORT };
      case 'buy':
        return { action: 'BUY', positionSide: marketType === MarketType.FUTURES ? PositionSide.LONG : undefined };
      case 'sell':
        return { action: 'SELL', positionSide: marketType === MarketType.FUTURES ? PositionSide.LONG : undefined };
      default:
        throw new Error(`Unknown signal action: ${action}`);
    }
  }

  /**
   * Map a signal action to the side + positionSide used by PositionTrackingService.
   *
   * | signal.action | side   | positionSide |
   * |---------------|--------|--------------|
   * | buy           | buy    | long         |
   * | sell          | sell   | long         |
   * | short_entry   | buy    | short        |  (opening a short = "buying" into a short position)
   * | short_exit    | sell   | short        |  (closing a short = "selling" the short position)
   */
  private mapSignalToPositionTracking(action: string): { side: 'buy' | 'sell'; positionSide: 'long' | 'short' } {
    switch (action) {
      case 'buy':
        return { side: 'buy', positionSide: 'long' };
      case 'sell':
        return { side: 'sell', positionSide: 'long' };
      case 'short_entry':
        return { side: 'buy', positionSide: 'short' };
      case 'short_exit':
        return { side: 'sell', positionSide: 'short' };
      default:
        this.logger.error(`Unknown signal action "${action}" for position tracking`);
        throw new Error(`Unknown signal action for position tracking: ${action}`);
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
    // Use Binance US as the default price source for consistency
    const exchangeSlug = 'binance_us';
    const quote = EXCHANGE_QUOTE_CURRENCY[exchangeSlug] ?? DEFAULT_QUOTE_CURRENCY;
    const tradingPairs = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA'].map((base) => `${base}/${quote}`);

    try {
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
