import { Injectable, Logger } from '@nestjs/common';

import { UserStrategyPosition } from './entities/user-strategy-position.entity';
import { extractCoinIdFromSymbol } from './live-trading.utils';
import { PositionTrackingService } from './position-tracking.service';
import { MarketData, TradingSignal } from './strategy-executor.service';

import { DEFAULT_QUOTE_CURRENCY, EXCHANGE_QUOTE_CURRENCY } from '../exchange/constants';
import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { ExchangeSelectionService } from '../exchange/exchange-selection/exchange-selection.service';
import { MetricsService } from '../metrics/metrics.service';
import { OpportunitySellDecision } from '../order/interfaces/opportunity-selling.interface';
import { OrderService } from '../order/order.service';
import { OpportunitySellService } from '../order/services/opportunity-sell.service';
import { toErrorInfo } from '../shared/error.util';
import { TradeCooldownService } from '../shared/trade-cooldown.service';
import { User } from '../users/users.entity';

export interface OpportunitySellingResult {
  freed: boolean;
  reason?: string;
}

@Injectable()
export class OpportunitySellingExecutionService {
  private readonly logger = new Logger(OpportunitySellingExecutionService.name);

  constructor(
    private readonly opportunitySellService: OpportunitySellService,
    private readonly exchangeSelectionService: ExchangeSelectionService,
    private readonly tradeCooldownService: TradeCooldownService,
    private readonly orderService: OrderService,
    private readonly positionTracking: PositionTrackingService,
    private readonly metricsService: MetricsService,
    private readonly exchangeManager: ExchangeManagerService
  ) {}

  /**
   * Attempt to free up capital by selling underperforming positions.
   * Returns true if enough capital was freed, false otherwise.
   */
  async execute(
    user: User,
    buySignal: TradingSignal,
    strategyConfigId: string,
    compositeRegime: string,
    positions: UserStrategyPosition[],
    marketData: MarketData[],
    requiredBuyAmount: number,
    availableCash: number
  ): Promise<OpportunitySellingResult> {
    // Regime guard — selling in extreme/bear conditions is counterproductive
    const regime = compositeRegime.toLowerCase();
    if (regime === 'extreme' || regime === 'bear') {
      this.logger.log(
        `Skipping opportunity selling for user ${user.id}: regime=${compositeRegime} is too risky for liquidation`
      );
      return {
        freed: false,
        reason: `Skipping opportunity selling: regime=${compositeRegime} is too risky for liquidation`
      };
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
      const coinId = extractCoinIdFromSymbol(pos.symbol);
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
      const coinId = extractCoinIdFromSymbol(md.symbol);
      priceMap.set(coinId, md.price);
    }

    // Calculate portfolio value
    let portfolioValue = availableCash;
    for (const [coinId, pos] of positionsMap) {
      const price = priceMap.get(coinId);
      if (price) portfolioValue += pos.quantity * price;
    }

    const buySignalCoinId = extractCoinIdFromSymbol(buySignal.symbol);

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
      return {
        freed: false,
        reason: plan.reason || 'Opportunity selling was rejected'
      };
    }

    // Execute sell orders sequentially
    this.logger.log(
      `Executing ${plan.sellOrders.length} opportunity sell(s) for user ${user.id} ` +
        `to fund ${buySignalCoinId} buy ($${requiredBuyAmount.toFixed(2)} needed)`
    );

    const executedSells: Array<{ symbol: string; quantity: number; proceeds: number }> = [];
    const remainingQtyByCoin = new Map<string, Map<string, number>>();

    for (const sellOrder of plan.sellOrders) {
      try {
        const sellSymbol = this.findSymbolForCoinId(sellOrder.coinId, effectiveMarketData);
        if (!sellSymbol) {
          this.logger.error(`No market symbol found for coinId ${sellOrder.coinId}, aborting opportunity sells`);
          await this.cleanupOrphanedSells(user.id, executedSells);
          return {
            freed: false,
            reason: `No market symbol found for coinId ${sellOrder.coinId}`
          };
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
          return {
            freed: false,
            reason: `No exchange key available for opportunity sell on ${sellSymbol}`
          };
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
          return {
            freed: false,
            reason: `Opportunity sell cooldown blocked for ${sellSymbol}`
          };
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
          // Track remaining quantities in a local map to avoid mutating input data
          if (!remainingQtyByCoin.has(sellOrder.coinId)) {
            remainingQtyByCoin.set(
              sellOrder.coinId,
              new Map(coinSourcePositions.map((sp) => [sp.strategyConfigId, sp.quantity]))
            );
          }
          const remainingQty = remainingQtyByCoin.get(sellOrder.coinId)!;
          let remainingSellQty = sellOrder.quantity;
          for (const srcPos of coinSourcePositions) {
            if (remainingSellQty <= 0) break;
            const available = remainingQty.get(srcPos.strategyConfigId) ?? 0;
            const decrementQty = Math.min(available, remainingSellQty);
            await this.positionTracking.updatePosition(
              user.id,
              srcPos.strategyConfigId,
              sellSymbol,
              decrementQty,
              sellOrder.currentPrice,
              'sell',
              'long'
            );
            remainingQty.set(srcPos.strategyConfigId, available - decrementQty);
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
          return {
            freed: false,
            reason: `Opportunity sell failed for ${sellSymbol}: ${err.message}`
          };
        }
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Unexpected error during opportunity sell for coinId ${sellOrder.coinId}: ${err.message}`);
        await this.cleanupOrphanedSells(user.id, executedSells);
        return {
          freed: false,
          reason: `Unexpected opportunity sell error for coinId ${sellOrder.coinId}: ${err.message}`
        };
      }
    }

    this.logger.log(
      `All opportunity sells completed for user ${user.id}: ` +
        `freed $${plan.projectedProceeds.toFixed(2)} to fund ${buySignalCoinId} buy`
    );
    return { freed: true };
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
   * Find the full trading pair symbol for a given coin ID from available market data.
   */
  private findSymbolForCoinId(coinId: string, marketData: MarketData[]): string | null {
    const entry = marketData.find((m) => extractCoinIdFromSymbol(m.symbol) === coinId);
    return entry?.symbol ?? null;
  }

  /**
   * Fetch current market data for common trading pairs.
   * Uses the exchange manager to get real-time prices from connected exchanges.
   */
  async fetchMarketData(coinSymbols?: string[]): Promise<MarketData[]> {
    const marketData: MarketData[] = [];
    // Use Binance US as the default price source for consistency
    const exchangeSlug = 'binance_us';
    const quote = EXCHANGE_QUOTE_CURRENCY[exchangeSlug] ?? DEFAULT_QUOTE_CURRENCY;
    const bases = coinSymbols?.length ? [...new Set(coinSymbols)] : ['BTC', 'ETH', 'SOL', 'XRP', 'ADA'];
    const tradingPairs = bases.map((base) => `${base}/${quote}`);

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
}
