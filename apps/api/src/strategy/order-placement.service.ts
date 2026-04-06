import { Injectable, Logger } from '@nestjs/common';

import { MarketType, PositionSide, SignalReasonCode } from '@chansey/api-interfaces';

import { StrategyConfig } from './entities/strategy-config.entity';
import { PositionTrackingService } from './position-tracking.service';
import { TradingSignal } from './strategy-executor.service';

import { ExchangeSelectionService } from '../exchange/exchange-selection/exchange-selection.service';
import { MetricsService } from '../metrics/metrics.service';
import { OrderService } from '../order/order.service';
import { TradeExecutionService, TradeSignalWithExit } from '../order/services/trade-execution.service';
import { toErrorInfo } from '../shared/error.util';
import { TradeCooldownService } from '../shared/trade-cooldown.service';
import { User } from '../users/users.entity';

export type PlaceOrderResult =
  | { status: 'placed'; orderId: string; metadata?: Record<string, unknown> }
  | {
      status: 'blocked' | 'failed';
      reasonCode: SignalReasonCode;
      reason: string;
      metadata?: Record<string, unknown>;
    };

@Injectable()
export class OrderPlacementService {
  private readonly logger = new Logger(OrderPlacementService.name);

  constructor(
    private readonly exchangeSelectionService: ExchangeSelectionService,
    private readonly tradeCooldownService: TradeCooldownService,
    private readonly orderService: OrderService,
    private readonly tradeExecutionService: TradeExecutionService,
    private readonly positionTracking: PositionTrackingService,
    private readonly metricsService: MetricsService
  ) {}

  async placeOrder(
    user: User,
    strategyConfigId: string,
    signal: TradingSignal,
    strategy: StrategyConfig
  ): Promise<PlaceOrderResult> {
    try {
      // Dynamically select exchange key based on signal action
      const isBuyAction = signal.action === 'buy' || signal.action === 'short_exit';
      let exchangeKey;
      try {
        exchangeKey = isBuyAction
          ? await this.exchangeSelectionService.selectForBuy(user.id, signal.symbol)
          : await this.exchangeSelectionService.selectForSell(user.id, signal.symbol, strategyConfigId);
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        const reason = `No suitable exchange key found for user ${user.id} and symbol ${signal.symbol}: ${err.message}`;
        this.logger.error(reason);
        return {
          status: 'blocked',
          reasonCode: SignalReasonCode.EXCHANGE_SELECTION_FAILED,
          reason
        };
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
        const reason =
          `Trade cooldown blocked strategy ${strategyConfigId} for user ${user.id}: ` +
          `${direction} ${signal.symbol} already claimed by ${cooldownCheck.existingClaim?.pipeline}`;
        this.logger.warn(reason);
        return {
          status: 'blocked',
          reasonCode: SignalReasonCode.TRADE_COOLDOWN,
          reason,
          metadata: { direction, existingClaim: cooldownCheck.existingClaim?.pipeline }
        };
      }

      this.metricsService.recordTradeCooldownClaim(direction, signal.symbol);

      try {
        let placedOrderId = '';
        let orderMetadata: Record<string, unknown> | undefined;
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
            confidence: signal.confidence,
            marketType: 'futures',
            positionSide,
            leverage: Number(strategy.defaultLeverage) || 1,
            exitConfig: signal.exitConfig
          };

          const order = await this.tradeExecutionService.executeTradeSignal(tradeSignal);
          this.metricsService.recordLiveOrderPlaced('futures', action);
          placedOrderId = order.id;
          orderMetadata = {
            exchangeKeyId: exchangeKey.id,
            exchangeName: exchangeKey.name,
            marketType: 'futures',
            leverage: tradeSignal.leverage,
            positionSide
          };

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
          placedOrderId = order.id;
          orderMetadata = {
            exchangeKeyId: exchangeKey.id,
            exchangeName: exchangeKey.name,
            marketType: 'spot'
          };

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
          trackingSide === 'buy' ? exchangeKey.id : undefined
        );
        return {
          status: 'placed',
          orderId: placedOrderId,
          metadata: orderMetadata
        };
      } catch (error: unknown) {
        // Clear cooldown on failure so next cycle can retry
        await this.tradeCooldownService.clearCooldown(user.id, signal.symbol, direction);
        this.metricsService.recordTradeCooldownCleared('order_failure');
        const err = toErrorInfo(error);
        return {
          status: 'failed',
          reasonCode: SignalReasonCode.ORDER_EXECUTION_FAILED,
          reason: err.message,
          metadata: { direction }
        };
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to place order for user ${user.id}: ${err.message}`);
      return {
        status: 'failed',
        reasonCode: SignalReasonCode.ORDER_EXECUTION_FAILED,
        reason: err.message
      };
    }
  }

  /**
   * Map a signal action string to a BUY/SELL direction for cooldown keys.
   */
  mapSignalActionToDirection(action: string): string {
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
  mapLiveSignalToTradeAction(
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
  mapSignalToPositionTracking(action: string): { side: 'buy' | 'sell'; positionSide: 'long' | 'short' } {
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
}
