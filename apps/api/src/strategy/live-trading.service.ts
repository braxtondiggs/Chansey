import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { MarketType, PositionSide } from '@chansey/api-interfaces';

import { CapitalAllocationService } from './capital-allocation.service';
import { ConcentrationGateService } from './concentration-gate.service';
import { DailyLossLimitGateService } from './daily-loss-limit-gate.service';
import { StrategyConfig } from './entities/strategy-config.entity';
import { UserStrategyPosition } from './entities/user-strategy-position.entity';
import { PositionTrackingService } from './position-tracking.service';
import { PreTradeRiskGateService } from './pre-trade-risk-gate.service';
import { RiskPoolMappingService } from './risk-pool-mapping.service';
import { MarketData, StrategyExecutorService, TradingSignal } from './strategy-executor.service';

import { TradingStateService } from '../admin/trading-state/trading-state.service';
import { BalanceService } from '../balance/balance.service';
import { ExchangeBalanceDto } from '../balance/dto';
import { DEFAULT_QUOTE_CURRENCY, EXCHANGE_QUOTE_CURRENCY } from '../exchange/constants';
import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { ExchangeSelectionService } from '../exchange/exchange-selection/exchange-selection.service';
import { FailedJobService } from '../failed-jobs/failed-job.service';
import { CompositeRegimeService } from '../market-regime/composite-regime.service';
import { RegimeGateService } from '../market-regime/regime-gate.service';
import { MetricsService } from '../metrics/metrics.service';
import { OpportunitySellDecision } from '../order/interfaces/opportunity-selling.interface';
import { OrderService } from '../order/order.service';
import { OpportunitySellService } from '../order/services/opportunity-sell.service';
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
    private readonly dailyLossLimitGate: DailyLossLimitGateService,
    private readonly concentrationGate: ConcentrationGateService,
    private readonly tradeExecutionService: TradeExecutionService,
    private readonly tradeCooldownService: TradeCooldownService,
    private readonly metricsService: MetricsService,
    private readonly exchangeSelectionService: ExchangeSelectionService,
    private readonly opportunitySellService: OpportunitySellService,
    private readonly failedJobService: FailedJobService
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
        relations: ['coinRisk']
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

          try {
            await this.failedJobService.recordFailure({
              queueName: 'live-trading-cron',
              jobId: `user:${user.id}`,
              jobName: 'executeUserStrategies',
              jobData: { userId: user.id },
              errorMessage: err.message,
              stackTrace: err.stack
            });
          } catch {
            // fail-safe
          }
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

    // Fetch user's free balance from exchange
    let balances = await this.balanceService.getUserBalances(user, false);
    const totalFreeUsdValue = this.calculateFreeUsdValue(balances.current);

    if (totalFreeUsdValue <= 0 && !user.enableOpportunitySelling) {
      this.logger.warn(`User ${user.id} has no free balance available`);
      return;
    }

    // When fully invested with opportunity selling enabled, use a nominal capital
    // so strategies can still generate signals (actual capital comes from selling)
    const effectiveFreeValue = totalFreeUsdValue > 0 ? totalFreeUsdValue : 0;
    const actualCapital =
      effectiveFreeValue > 0
        ? (effectiveFreeValue * Number(user.algoCapitalAllocationPercentage)) / 100
        : this.estimatePortfolioCapital(balances.current);

    this.logger.debug(
      `User ${user.id}: Free balance $${totalFreeUsdValue.toFixed(2)}, ` +
        `${user.algoCapitalAllocationPercentage}% = $${actualCapital.toFixed(2)} for algo trading`
    );

    const strategies = await this.riskPoolMapping.getActiveStrategiesForUser(user);

    if (strategies.length === 0) {
      this.logger.debug(`No active strategies for user ${user.id} (risk level ${user.coinRisk?.level})`);
      return;
    }

    // Get current composite regime for position sizing (reused for gate below)
    const compositeRegime = this.compositeRegimeService.getCompositeRegime();

    const capitalMap = await this.capitalAllocation.allocateCapitalByKelly(actualCapital, strategies, {
      compositeRegime,
      riskLevel: user.effectiveCalculationRiskLevel
    });

    const userPositions = await this.positionTracking.getPositions(user.id);

    const marketData = await this.fetchMarketData();

    const volatilityRegime = this.compositeRegimeService.getVolatilityRegime();
    const trendAboveSma = this.compositeRegimeService.getTrendAboveSma();
    const overrideActive = this.compositeRegimeService.isOverrideActive();
    // Build asset allocations for concentration gate (reuse fetched balances)
    let assetAllocations = this.concentrationGate.buildAssetAllocations(balances.current);

    let gateBlockedCount = 0;
    let drawdownBlockedCount = 0;
    let dailyLossBlockedCount = 0;
    let concentrationBlockedCount = 0;
    let concentrationReducedCount = 0;

    // Daily loss limit gate: user-level check before strategy loop
    const dailyLossCheck = await this.dailyLossLimitGate.isEntryBlocked(
      user.id,
      actualCapital,
      user.effectiveCalculationRiskLevel
    );
    const dailyLossBlocked = dailyLossCheck.blocked;

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

          // Daily loss limit gate: block BUY/short_entry when rolling 24h losses exceed threshold
          if (dailyLossBlocked && (action === 'buy' || action === 'short_entry')) {
            this.metricsService.recordDailyLossGateBlock();
            dailyLossBlockedCount++;
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

          // Concentration gate: block/reduce BUY/short_entry when single-asset concentration is too high
          if (action === 'buy' || action === 'short_entry') {
            const tradeUsdValue = signal.quantity * signal.price;
            const concCheck = this.concentrationGate.checkTrade(
              assetAllocations,
              signal.symbol,
              tradeUsdValue,
              user.effectiveCalculationRiskLevel,
              action
            );
            if (!concCheck.allowed) {
              this.metricsService.recordConcentrationGateBlock();
              concentrationBlockedCount++;
              continue;
            }
            if (concCheck.adjustedQuantity != null && concCheck.adjustedQuantity < 1) {
              signal.quantity *= concCheck.adjustedQuantity;
              concentrationReducedCount++;
            }
          }

          // Proactive opportunity selling: check if BUY needs capital freed up
          if ((action === 'buy' || action === 'short_entry') && user.enableOpportunitySelling) {
            const buyAmount = signal.quantity * signal.price;
            const availableCash = this.calculateFreeUsdValue(balances.current);

            if (buyAmount > availableCash) {
              const freed = await this.attemptOpportunitySelling(
                user,
                signal,
                strategy.id,
                compositeRegime,
                userPositions,
                marketData,
                buyAmount,
                availableCash
              );
              if (!freed) continue;

              // Re-verify available cash after opportunity sells (Fix #2)
              const updatedBalances = await this.balanceService.getUserBalances(user, false);
              const newAvailableCash = this.calculateFreeUsdValue(updatedBalances.current);
              if (newAvailableCash < buyAmount * 0.95) {
                this.logger.warn(
                  `Insufficient funds after opportunity sells: needed $${buyAmount.toFixed(2)}, ` +
                    `available $${newAvailableCash.toFixed(2)} — skipping buy`
                );
                continue;
              }

              // Refresh balances so subsequent strategies see updated cash and concentrations
              balances = updatedBalances;
              assetAllocations = this.concentrationGate.buildAssetAllocations(balances.current);
            }
          }

          await this.placeOrder(user, strategy.id, signal, strategy);
        }
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Strategy ${strategy.id} execution failed for user ${user.id}: ${err.message}`);

        try {
          await this.failedJobService.recordFailure({
            queueName: 'live-trading-cron',
            jobId: `strategy:${strategy.id}:user:${user.id}`,
            jobName: 'executeStrategy',
            jobData: { userId: user.id, strategyId: strategy.id },
            errorMessage: err.message,
            stackTrace: err.stack
          });
        } catch {
          // fail-safe
        }
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

    if (concentrationBlockedCount > 0) {
      this.logger.log(`Concentration gate blocked ${concentrationBlockedCount} entry signal(s) for user ${user.id}`);
    }

    if (concentrationReducedCount > 0) {
      this.logger.log(`Concentration gate reduced ${concentrationReducedCount} entry signal(s) for user ${user.id}`);
    }

    if (dailyLossBlockedCount > 0) {
      this.logger.log(
        `Daily loss limit gate blocked ${dailyLossBlockedCount} entry signal(s) for user ${user.id}: ${dailyLossCheck.reason}`
      );
    }
  }

  private async placeOrder(
    user: User,
    strategyConfigId: string,
    signal: TradingSignal,
    strategy: StrategyConfig
  ): Promise<void> {
    try {
      // Dynamically select exchange key based on signal action
      const isBuyAction = signal.action === 'buy' || signal.action === 'short_exit';
      let exchangeKey;
      try {
        exchangeKey = isBuyAction
          ? await this.exchangeSelectionService.selectForBuy(user.id, signal.symbol)
          : await this.exchangeSelectionService.selectForSell(user.id, signal.symbol, strategyConfigId);
      } catch {
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
            leverage: Number(strategy.defaultLeverage) || 1,
            exitConfig: signal.exitConfig
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
          trackingPositionSide,
          isBuyAction ? exchangeKey.id : undefined
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
   * Attempt to free up capital by selling underperforming positions.
   * Returns true if enough capital was freed, false otherwise.
   */
  private async attemptOpportunitySelling(
    user: User,
    buySignal: TradingSignal,
    strategyConfigId: string,
    compositeRegime: string,
    positions: UserStrategyPosition[],
    marketData: MarketData[],
    requiredBuyAmount: number,
    availableCash: number
  ): Promise<boolean> {
    // Regime guard — selling in extreme/bear conditions is counterproductive
    const regime = compositeRegime.toLowerCase();
    if (regime === 'extreme' || regime === 'bear') {
      this.logger.log(
        `Skipping opportunity selling for user ${user.id}: regime=${compositeRegime} is too risky for liquidation`
      );
      return false;
    }

    // Re-fetch market data for fresh prices (Fix #3)
    const freshMarketData = await this.fetchMarketData();
    const effectiveMarketData = freshMarketData.length > 0 ? freshMarketData : marketData;

    // Build positions map: coinId -> { averagePrice, quantity, entryDate }
    // Filter to long positions only — short positions aren't eligible for opportunity selling (Fix #5)
    const longPositions = positions.filter((p) => p.positionSide === 'long');
    const positionsMap = new Map<
      string,
      {
        averagePrice: number;
        quantity: number;
        entryDate?: Date;
        sourcePositions: Array<{ strategyConfigId: string; quantity: number; symbol: string }>;
      }
    >();
    for (const pos of longPositions) {
      const coinId = this.extractCoinIdFromSymbol(pos.symbol);
      const existing = positionsMap.get(coinId);
      if (existing) {
        // Merge positions for the same coin
        const totalQty = existing.quantity + Number(pos.quantity);
        existing.averagePrice =
          (existing.averagePrice * existing.quantity + Number(pos.avgEntryPrice) * Number(pos.quantity)) / totalQty;
        existing.quantity = totalQty;
        if (pos.createdAt && (!existing.entryDate || pos.createdAt < existing.entryDate)) {
          existing.entryDate = pos.createdAt;
        }
        existing.sourcePositions.push({
          strategyConfigId: pos.strategyConfigId,
          quantity: Number(pos.quantity),
          symbol: pos.symbol
        });
      } else {
        positionsMap.set(coinId, {
          averagePrice: Number(pos.avgEntryPrice),
          quantity: Number(pos.quantity),
          entryDate: pos.createdAt,
          sourcePositions: [
            { strategyConfigId: pos.strategyConfigId, quantity: Number(pos.quantity), symbol: pos.symbol }
          ]
        });
      }
    }

    // Build price map from market data
    const priceMap = new Map<string, number>();
    for (const md of effectiveMarketData) {
      const coinId = this.extractCoinIdFromSymbol(md.symbol);
      priceMap.set(coinId, md.price);
    }

    // Calculate portfolio value
    let portfolioValue = availableCash;
    for (const [coinId, pos] of positionsMap) {
      const price = priceMap.get(coinId);
      if (price) portfolioValue += pos.quantity * price;
    }

    const buySignalCoinId = this.extractCoinIdFromSymbol(buySignal.symbol);

    const plan = await this.opportunitySellService.evaluateAndPersist(
      {
        buySignalCoinId,
        buySignalConfidence: buySignal.confidence ?? 0.7,
        requiredBuyAmount,
        availableCash,
        portfolioValue,
        positions: positionsMap,
        currentPrices: priceMap,
        config: user.opportunitySellingConfig,
        enabled: user.enableOpportunitySelling
      },
      user.id,
      false
    );

    if (plan.decision !== OpportunitySellDecision.APPROVED || plan.sellOrders.length === 0) {
      this.logger.log(`Opportunity selling rejected for user ${user.id}, coin=${buySignalCoinId}: ${plan.reason}`);
      return false;
    }

    // Execute sell orders sequentially
    this.logger.log(
      `Executing ${plan.sellOrders.length} opportunity sell(s) for user ${user.id} ` +
        `to fund ${buySignalCoinId} buy ($${requiredBuyAmount.toFixed(2)} needed)`
    );

    const executedSells: Array<{ symbol: string; quantity: number; proceeds: number }> = [];

    for (const sellOrder of plan.sellOrders) {
      try {
        const sellSymbol = this.findSymbolForCoinId(sellOrder.coinId, effectiveMarketData);
        if (!sellSymbol) {
          this.logger.error(`No market symbol found for coinId ${sellOrder.coinId}, aborting opportunity sells`);
          await this.cleanupOrphanedSells(user.id, executedSells);
          return false;
        }

        // Look up source positions for this coin to use correct strategyConfigIds
        const coinSourcePositions = positionsMap.get(sellOrder.coinId)?.sourcePositions ?? [];
        const primaryStrategyConfigId = coinSourcePositions[0]?.strategyConfigId ?? strategyConfigId;

        let exchangeKey;
        try {
          exchangeKey = await this.exchangeSelectionService.selectForSell(user.id, sellSymbol, primaryStrategyConfigId);
        } catch {
          this.logger.error(`No exchange key for opportunity sell: user=${user.id}, symbol=${sellSymbol}`);
          await this.cleanupOrphanedSells(user.id, executedSells);
          return false;
        }

        // Trade cooldown check
        const cooldownCheck = await this.tradeCooldownService.checkAndClaim(
          user.id,
          sellSymbol,
          'SELL',
          `opportunity-sell:${primaryStrategyConfigId}`
        );
        if (!cooldownCheck.allowed) {
          this.logger.warn(`Opportunity sell cooldown blocked for ${sellSymbol}, aborting remaining sells`);
          await this.cleanupOrphanedSells(user.id, executedSells);
          return false;
        }

        try {
          const order = await this.orderService.placeAlgorithmicOrder(
            user.id,
            primaryStrategyConfigId,
            {
              action: 'sell',
              symbol: sellSymbol,
              quantity: sellOrder.quantity,
              price: sellOrder.currentPrice
            },
            exchangeKey.id
          );

          this.metricsService.recordLiveOrderPlaced('spot', 'sell');

          executedSells.push({
            symbol: sellSymbol,
            quantity: sellOrder.quantity,
            proceeds: sellOrder.estimatedProceeds
          });

          this.logger.log(
            `Opportunity sell executed: user=${user.id}, ${sellOrder.quantity} ${sellSymbol} ` +
              `@ $${sellOrder.currentPrice.toFixed(2)} = $${sellOrder.estimatedProceeds.toFixed(2)} ` +
              `(Order ID: ${order.id})`
          );

          // Update position tracking: split across source positions proportionally
          let remainingSellQty = sellOrder.quantity;
          for (const srcPos of coinSourcePositions) {
            if (remainingSellQty <= 0) break;
            const decrementQty = Math.min(srcPos.quantity, remainingSellQty);
            await this.positionTracking.updatePosition(
              user.id,
              srcPos.strategyConfigId,
              sellSymbol,
              decrementQty,
              sellOrder.currentPrice,
              'sell',
              'long'
            );
            srcPos.quantity -= decrementQty;
            remainingSellQty -= decrementQty;
          }

          // Fallback: if no source positions matched, update with the primary strategy
          if (coinSourcePositions.length === 0) {
            await this.positionTracking.updatePosition(
              user.id,
              primaryStrategyConfigId,
              sellSymbol,
              sellOrder.quantity,
              sellOrder.currentPrice,
              'sell',
              'long'
            );
          }
        } catch (error: unknown) {
          const err = toErrorInfo(error);
          await this.tradeCooldownService.clearCooldown(user.id, sellSymbol, 'SELL');
          this.logger.error(`Opportunity sell failed for ${sellSymbol}, aborting: ${err.message}`);
          await this.cleanupOrphanedSells(user.id, executedSells);
          return false;
        }
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Unexpected error during opportunity sell for coinId ${sellOrder.coinId}: ${err.message}`);
        await this.cleanupOrphanedSells(user.id, executedSells);
        return false;
      }
    }

    this.logger.log(
      `All opportunity sells completed for user ${user.id}: ` +
        `freed $${plan.projectedProceeds.toFixed(2)} to fund ${buySignalCoinId} buy`
    );
    return true;
  }

  /**
   * Extract the base coin ID (e.g., "BTC") from a trading pair symbol (e.g., "BTC/USDT").
   */
  private extractCoinIdFromSymbol(symbol: string): string {
    if (!symbol.includes('/')) {
      this.logger.warn(`Unexpected symbol format (no separator): "${symbol}" — using as-is`);
      return symbol;
    }
    return symbol.split('/')[0];
  }

  /**
   * Clean up orphaned sells by clearing cooldowns when a sell sequence is aborted.
   */
  private async cleanupOrphanedSells(
    userId: string,
    executedSells: Array<{ symbol: string; quantity: number; proceeds: number }>
  ): Promise<void> {
    if (executedSells.length === 0) return;

    this.logger.warn(
      `Opportunity sell sequence aborted after ${executedSells.length} successful sell(s) — ` +
        `these sells are orphaned (capital freed but buy will not proceed)`
    );
    for (const executed of executedSells) {
      await this.tradeCooldownService.clearCooldown(userId, executed.symbol, 'SELL');
    }
  }

  /**
   * Estimate total portfolio capital from exchange balances (positions + cash).
   * Used as a fallback when free cash is zero but opportunity selling is enabled.
   */
  private estimatePortfolioCapital(exchanges: ExchangeBalanceDto[]): number {
    let total = 0;
    for (const exchange of exchanges) {
      for (const balance of exchange.balances || []) {
        total += balance.usdValue || 0;
      }
    }
    return total > 0 ? total : 1; // Minimum $1 to avoid zero-division in Kelly allocation
  }

  /**
   * Find the full trading pair symbol for a given coin ID from available market data.
   */
  private findSymbolForCoinId(coinId: string, marketData: MarketData[]): string | null {
    const entry = marketData.find((m) => this.extractCoinIdFromSymbol(m.symbol) === coinId);
    return entry?.symbol ?? null;
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
