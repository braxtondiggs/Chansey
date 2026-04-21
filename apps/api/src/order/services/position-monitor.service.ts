import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import * as ccxt from 'ccxt';
import { Decimal } from 'decimal.js';
import { DataSource, Repository } from 'typeorm';

import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { TickerBatcherService } from '../../exchange/ticker-batcher/ticker-batcher.service';
import { tickerCircuitKey } from '../../shared/circuit-breaker.constants';
import { CircuitBreakerService } from '../../shared/circuit-breaker.service';
import { toErrorInfo } from '../../shared/error.util';
import { PositionExit } from '../entities/position-exit.entity';
import {
  ExitConfig,
  PositionExitStatus,
  TrailingActivationType,
  TrailingType
} from '../interfaces/exit-config.interface';
import { Order, OrderSide, OrderStatus, OrderType } from '../order.entity';

export interface MonitorResult {
  monitored: number;
  updated: number;
  triggered: number;
  timestamp: string;
}

@Injectable()
export class PositionMonitorService {
  private readonly logger = new Logger(PositionMonitorService.name);
  static readonly TRAILING_FALLBACK_PERCENTAGE = 0.02;

  constructor(
    @InjectRepository(PositionExit)
    private readonly positionExitRepo: Repository<PositionExit>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    private readonly exchangeManagerService: ExchangeManagerService,
    private readonly exchangeKeyService: ExchangeKeyService,
    private readonly dataSource: DataSource,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly tickerBatcher: TickerBatcherService
  ) {}

  /**
   * Monitor all active positions with trailing stops.
   * Returns summary counts of monitored, updated, and triggered positions.
   */
  async monitorPositions(): Promise<MonitorResult> {
    const activePositions = await this.getActiveTrailingPositions();

    if (activePositions.length === 0) {
      this.logger.debug('No active trailing stop positions to monitor');
      return { monitored: 0, updated: 0, triggered: 0, timestamp: new Date().toISOString() };
    }

    this.logger.log(`Monitoring ${activePositions.length} active trailing stop positions`);

    let updated = 0;
    let triggered = 0;
    const totalPositions = activePositions.length;

    const positionsByExchange = this.groupPositionsByExchange(activePositions);

    for (const [exchangeKeyId, positions] of Object.entries(positionsByExchange)) {
      try {
        const { tickers, exchangeClient } = await this.fetchPricesForExchange(exchangeKeyId, positions);

        if (!exchangeClient) continue;

        for (const pos of positions) {
          try {
            const currentPrice = tickers[pos.symbol];
            if (currentPrice == null) {
              this.logger.warn(`No price available for ${pos.symbol}`);
              continue;
            }

            const result = await this.updateTrailingStop(pos, currentPrice, exchangeClient);

            if (result.updated) updated++;
            if (result.triggered) triggered++;
          } catch (posError: unknown) {
            const err = toErrorInfo(posError);
            this.logger.error(`Failed to update trailing stop for position ${pos.id}: ${err.message}`);
          }
        }
      } catch (exchangeError: unknown) {
        const err = toErrorInfo(exchangeError);
        this.logger.error(`Failed to process positions for exchange ${exchangeKeyId}: ${err.message}`);
      }
    }

    this.logger.log(
      `Position monitoring complete: ${totalPositions} monitored, ${updated} updated, ${triggered} triggered`
    );

    return { monitored: totalPositions, updated, triggered, timestamp: new Date().toISOString() };
  }

  /**
   * Get active positions with trailing stops enabled
   */
  private async getActiveTrailingPositions(): Promise<PositionExit[]> {
    return this.positionExitRepo
      .createQueryBuilder('pe')
      .where('pe.status = :status', { status: PositionExitStatus.ACTIVE })
      .andWhere('pe."exitConfig"->>\'enableTrailingStop\' = :enabled', { enabled: 'true' })
      .leftJoinAndSelect('pe.user', 'user')
      .leftJoinAndSelect('pe.entryOrder', 'entryOrder')
      .getMany();
  }

  /**
   * Group positions by exchange key for batched price fetches
   */
  private groupPositionsByExchange(positions: PositionExit[]): Record<string, PositionExit[]> {
    return positions.reduce<Record<string, PositionExit[]>>((grouped, position) => {
      const key = position.exchangeKeyId || 'unknown';
      (grouped[key] ??= []).push(position);
      return grouped;
    }, {});
  }

  /**
   * Fetch current prices for all symbols held by positions under one exchange key.
   * Routes through TickerBatcherService so we participate in the shared ticker
   * circuit breaker — during rate-limit storms we fail fast instead of amplifying
   * load. Returns a null client when the circuit is open or the exchange key is
   * missing so the caller's existing `!exchangeClient` guard skips all positions.
   */
  private async fetchPricesForExchange(
    exchangeKeyId: string,
    positions: PositionExit[]
  ): Promise<{ tickers: Record<string, number>; exchangeClient: ccxt.Exchange | null }> {
    const position = positions[0];
    const exchangeKey = await this.exchangeKeyService.findOne(exchangeKeyId, position.userId);

    if (!exchangeKey?.exchange) {
      this.logger.warn(`Exchange key ${exchangeKeyId} not found, skipping positions`);
      return { tickers: {}, exchangeClient: null };
    }

    const slug = exchangeKey.exchange.slug;

    if (this.circuitBreaker.isOpen(tickerCircuitKey(slug))) {
      this.logger.debug(`ticker_circuit_open: skipping ${positions.length} positions on ${slug}`);
      return { tickers: {}, exchangeClient: null };
    }

    const exchangeClient = await this.exchangeManagerService.getExchangeClient(slug, position.user);

    const symbols = [...new Set(positions.map((p) => p.symbol))];
    const tickers: Record<string, number> = {};

    if (symbols.length === 0) {
      return { tickers, exchangeClient };
    }

    try {
      const batched = await this.tickerBatcher.getTickers(slug, symbols);
      for (const [sym, ticker] of batched) {
        if (ticker.price > 0) {
          tickers[sym] = ticker.price;
        }
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Ticker batch fetch failed for ${slug}: ${err.message}`);
      return { tickers: {}, exchangeClient: null };
    }

    return { tickers, exchangeClient };
  }

  /**
   * Update trailing stop for a single position
   */
  async updateTrailingStop(
    position: PositionExit,
    currentPrice: number,
    exchangeClient: ccxt.Exchange
  ): Promise<{ updated: boolean; triggered: boolean }> {
    const config = position.exitConfig;
    const side = position.side;
    let updated = false;
    let triggered = false;

    // Check if trailing stop should activate (if not already activated)
    if (!position.trailingActivated) {
      const shouldActivate = this.shouldActivateTrailing(position, currentPrice);

      if (shouldActivate) {
        position.trailingActivated = true;
        position.trailingHighWaterMark = side === 'BUY' ? currentPrice : undefined;
        position.trailingLowWaterMark = side === 'SELL' ? currentPrice : undefined;
        this.logger.log(`Trailing stop activated for position ${position.id} at price ${currentPrice}`);
        updated = true;
      }
    }

    // Update trailing stop if activated
    if (position.trailingActivated) {
      const isLong = side === 'BUY';
      const waterMark = isLong ? position.trailingHighWaterMark || 0 : position.trailingLowWaterMark || Infinity;
      const currentStop = position.currentTrailingStopPrice;

      // Check if price sets a new water mark
      if (this.isNewWaterMark(currentPrice, waterMark, isLong)) {
        if (isLong) {
          position.trailingHighWaterMark = currentPrice;
        } else {
          position.trailingLowWaterMark = currentPrice;
        }

        // Calculate new stop price
        const newStopPrice = this.calculateTrailingStopPrice(currentPrice, config, side, position.entryAtr);

        // Only update if stop ratchets in the favorable direction
        const stopDefault = isLong ? 0 : Infinity;
        if (this.isNewWaterMark(newStopPrice, currentStop || stopDefault, isLong)) {
          this.logger.log(
            `Updating trailing stop for ${isLong ? '' : 'short '}position ${position.id}: ${currentStop} -> ${newStopPrice}`
          );

          // Update stop order on exchange if possible
          if (position.trailingStopOrderId) {
            try {
              await this.updateStopOrderOnExchange(position, newStopPrice, exchangeClient);
            } catch (updateError: unknown) {
              const err = toErrorInfo(updateError);
              this.logger.warn(`Failed to update stop order on exchange: ${err.message}`);
            }

            if (position.status === PositionExitStatus.ERROR) {
              return { updated: true, triggered: false };
            }
          }

          position.currentTrailingStopPrice = newStopPrice;
          updated = true;
        }
      }

      // Check if stop loss triggered
      if (this.shouldTriggerStop(currentPrice, currentStop, isLong)) {
        triggered = true;
        position.status = PositionExitStatus.TRAILING_TRIGGERED;
        position.triggeredAt = new Date();
        position.exitPrice = currentPrice;
        this.logger.log(
          `Trailing stop triggered for ${isLong ? '' : 'short '}position ${position.id} at price ${currentPrice}`
        );
      }
    }

    // Save position updates
    if (updated || triggered) {
      await this.positionExitRepo.save(position);
    }

    return { updated, triggered };
  }

  /**
   * Returns true when the current price exceeds the water mark in the favorable direction.
   * Long: price > waterMark (new high). Short: price < waterMark (new low).
   */
  isNewWaterMark(price: number, waterMark: number, isLong: boolean): boolean {
    return isLong ? price > waterMark : price < waterMark;
  }

  /**
   * Returns true when the current price has crossed the stop price (triggered).
   * Long: price <= stop. Short: price >= stop.
   */
  shouldTriggerStop(price: number, stopPrice: number | undefined, isLong: boolean): boolean {
    if (stopPrice == null) return false;
    return isLong ? price <= stopPrice : price >= stopPrice;
  }

  /**
   * Check if trailing stop should activate based on activation settings
   */
  shouldActivateTrailing(position: PositionExit, currentPrice: number): boolean {
    const config = position.exitConfig;
    const side = position.side;

    switch (config.trailingActivation) {
      case TrailingActivationType.IMMEDIATE:
        return true;

      case TrailingActivationType.PRICE: {
        const activationPrice = config.trailingActivationValue || 0;
        return side === 'BUY' ? currentPrice >= activationPrice : currentPrice <= activationPrice;
      }

      case TrailingActivationType.PERCENTAGE: {
        const percentGain = config.trailingActivationValue || 0;
        const entryDec = new Decimal(position.entryPrice);
        const pctFactor = new Decimal(percentGain).div(100);
        const targetPrice =
          side === 'BUY'
            ? entryDec.times(new Decimal(1).plus(pctFactor)).toNumber()
            : entryDec.times(new Decimal(1).minus(pctFactor)).toNumber();
        return side === 'BUY' ? currentPrice >= targetPrice : currentPrice <= targetPrice;
      }

      default:
        return false;
    }
  }

  /**
   * Calculate trailing stop price from current price
   */
  calculateTrailingStopPrice(
    currentPrice: number,
    config: ExitConfig,
    side: 'BUY' | 'SELL',
    entryAtr?: number
  ): number {
    let trailingDistance: number;

    const priceDec = new Decimal(currentPrice);

    switch (config.trailingType) {
      case TrailingType.AMOUNT:
        trailingDistance = config.trailingValue;
        break;

      case TrailingType.PERCENTAGE:
        trailingDistance = priceDec.times(new Decimal(config.trailingValue).div(100)).toNumber();
        break;

      case TrailingType.ATR: {
        if (!entryAtr || isNaN(entryAtr)) {
          trailingDistance = priceDec.times(PositionMonitorService.TRAILING_FALLBACK_PERCENTAGE).toNumber();
          this.logger.warn('ATR value unavailable for trailing stop, using 2% fallback');
          break;
        }
        trailingDistance = new Decimal(entryAtr).times(config.trailingValue).toNumber();
        break;
      }

      default:
        trailingDistance = priceDec.times(PositionMonitorService.TRAILING_FALLBACK_PERCENTAGE).toNumber();
    }

    return side === 'BUY' ? priceDec.minus(trailingDistance).toNumber() : priceDec.plus(trailingDistance).toNumber();
  }

  /**
   * Update stop order on exchange using cancel-and-replace pattern.
   *
   * Most exchanges don't support modifying stop orders in-place.
   * This method cancels the existing stop order and places a new one
   * at the updated price. If the replacement order fails, the position
   * is marked as ERROR since it is now unprotected.
   */
  async updateStopOrderOnExchange(
    position: PositionExit,
    newStopPrice: number,
    exchangeClient: ccxt.Exchange
  ): Promise<void> {
    // 1. Check exchange capability
    if (!exchangeClient.has['createStopOrder'] && !exchangeClient.has['createOrder']) {
      this.logger.warn(`Exchange does not support stop orders, skipping update for position ${position.id}`);
      return;
    }

    // 2. Look up existing Order entity for the exchange-specific orderId
    const existingOrder = await this.orderRepo.findOne({
      where: { id: position.trailingStopOrderId }
    });

    if (!existingOrder) {
      this.logger.warn(
        `Order ${position.trailingStopOrderId} not found in DB for position ${position.id}, clearing reference`
      );
      position.trailingStopOrderId = undefined;
      return;
    }

    // 3. Cancel old stop order on exchange (external, irreversible)
    try {
      await exchangeClient.cancelOrder(existingOrder.orderId, position.symbol);
    } catch (cancelError) {
      if (cancelError instanceof ccxt.OrderNotFound) {
        this.logger.warn(
          `Stop order ${existingOrder.orderId} not found on exchange (already filled/cancelled), clearing reference`
        );
        position.trailingStopOrderId = undefined;
        existingOrder.status = OrderStatus.CANCELED;
        await this.orderRepo.save(existingOrder);
        return;
      }
      throw cancelError;
    }

    // 4. Create new stop order on exchange (external, irreversible)
    const exitSide = position.side === 'BUY' ? 'sell' : 'buy';
    let ccxtOrder: ccxt.Order;

    try {
      ccxtOrder = await exchangeClient.createOrder(
        position.symbol,
        'stop_loss',
        exitSide,
        position.quantity,
        undefined,
        { stopPrice: newStopPrice }
      );
    } catch (createError: unknown) {
      const err = toErrorInfo(createError);
      this.logger.error(
        `CRITICAL: Failed to place replacement stop order for position ${position.id}. ` +
          `Position is UNPROTECTED. Error: ${err.message}`
      );
      position.status = PositionExitStatus.ERROR;
      position.trailingStopOrderId = undefined;
      position.warnings = [
        ...(position.warnings || []),
        `Failed to place replacement stop order at ${newStopPrice}: ${err.message}`
      ];
      await this.positionExitRepo.save(position);
      throw createError;
    }

    // 5. Atomically update DB state (all-or-nothing)
    await this.dataSource.transaction(async (manager) => {
      existingOrder.status = OrderStatus.CANCELED;
      await manager.save(Order, existingOrder);

      const newOrder = manager.create(Order, {
        symbol: position.symbol,
        orderId: ccxtOrder.id,
        clientOrderId: ccxtOrder.clientOrderId || ccxtOrder.id,
        transactTime: new Date(ccxtOrder.timestamp || Date.now()),
        quantity: position.quantity,
        price: 0,
        executedQuantity: 0,
        fee: 0,
        commission: 0,
        status: OrderStatus.NEW,
        side: position.side === 'BUY' ? OrderSide.SELL : OrderSide.BUY,
        type: OrderType.STOP_LOSS,
        user: position.user,
        stopPrice: newStopPrice,
        isAlgorithmicTrade: true,
        isManual: false,
        exchangeKeyId: position.exchangeKeyId,
        info: ccxtOrder.info as Record<string, unknown>
      });
      const savedNewOrder = await manager.save(Order, newOrder);

      position.trailingStopOrderId = savedNewOrder.id;
    });

    this.logger.log(
      `Stop order updated for position ${position.id}: ${existingOrder.orderId} -> ${ccxtOrder.id} at price ${newStopPrice}`
    );
  }
}
