import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Job, Queue } from 'bullmq';
import * as ccxt from 'ccxt';
import { DataSource, Repository } from 'typeorm';

import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { toErrorInfo } from '../../shared/error.util';
import { PositionExit } from '../entities/position-exit.entity';
import {
  ExitConfig,
  PositionExitStatus,
  TrailingActivationType,
  TrailingType
} from '../interfaces/exit-config.interface';
import { Order, OrderSide, OrderStatus, OrderType } from '../order.entity';
import { PositionManagementService } from '../services/position-management.service';

/**
 * PositionMonitorTask
 *
 * BullMQ processor for monitoring positions with trailing stops.
 * Runs every 60 seconds to update trailing stop prices as market moves.
 */
@Processor('position-monitor', {
  concurrency: 1,
  lockDuration: 120_000
})
@Injectable()
export class PositionMonitorTask extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(PositionMonitorTask.name);
  private jobScheduled = false;

  constructor(
    @InjectQueue('position-monitor') private readonly positionMonitorQueue: Queue,
    @InjectRepository(PositionExit)
    private readonly positionExitRepo: Repository<PositionExit>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    private readonly positionManagementService: PositionManagementService,
    private readonly exchangeManagerService: ExchangeManagerService,
    private readonly exchangeKeyService: ExchangeKeyService,
    private readonly dataSource: DataSource
  ) {
    super();
  }

  /**
   * Lifecycle hook that runs once when the module is initialized
   * Schedules the repeatable job for position monitoring
   */
  async onModuleInit() {
    // Skip scheduling jobs in local development
    if (process.env.NODE_ENV === 'development' || process.env.DISABLE_POSITION_MONITOR === 'true') {
      this.logger.log('Position monitor jobs disabled for local development');
      return;
    }

    if (!this.jobScheduled) {
      await this.schedulePositionMonitorJob();
      this.jobScheduled = true;
    }
  }

  /**
   * Schedule the recurring job for position monitoring
   */
  private async schedulePositionMonitorJob() {
    // Check if there's already a scheduled job with the same name
    const repeatedJobs = await this.positionMonitorQueue.getRepeatableJobs();
    const existingJob = repeatedJobs.find((job) => job.name === 'monitor-positions');

    if (existingJob) {
      this.logger.log(`Position monitor job already scheduled with pattern: ${existingJob.pattern}`);
      return;
    }

    // Schedule every 60 seconds (at second 0 of each minute)
    await this.positionMonitorQueue.add(
      'monitor-positions',
      {
        timestamp: new Date().toISOString(),
        description: 'Scheduled position monitoring job'
      },
      {
        repeat: {
          pattern: '0 * * * * *' // Every 60 seconds (at the start of each minute)
        },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 3000
        },
        removeOnComplete: 100,
        removeOnFail: 50
      }
    );

    this.logger.log('Position monitor job scheduled with 60-second interval');
  }

  /**
   * BullMQ worker process method
   */
  async process(job: Job) {
    this.logger.debug(`Processing job ${job.id} of type ${job.name}`);

    try {
      if (job.name === 'monitor-positions') {
        return await this.handleMonitorPositions(job);
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
   * Monitor all active positions with trailing stops
   */
  private async handleMonitorPositions(job: Job) {
    try {
      await job.updateProgress(10);

      // Get all active positions with trailing stops enabled
      const activePositions = await this.getActiveTrailingPositions();

      if (activePositions.length === 0) {
        this.logger.debug('No active trailing stop positions to monitor');
        return {
          monitored: 0,
          updated: 0,
          triggered: 0,
          timestamp: new Date().toISOString()
        };
      }

      this.logger.log(`Monitoring ${activePositions.length} active trailing stop positions`);

      await job.updateProgress(20);

      let updated = 0;
      let triggered = 0;
      const totalPositions = activePositions.length;
      let processedPositions = 0;

      // Group positions by exchange to batch price fetches
      const positionsByExchange = this.groupPositionsByExchange(activePositions);

      for (const [exchangeKeyId, positions] of Object.entries(positionsByExchange)) {
        try {
          // Get exchange client
          const position = positions[0];
          const exchangeKey = await this.exchangeKeyService.findOne(exchangeKeyId, position.userId);

          if (!exchangeKey?.exchange) {
            this.logger.warn(`Exchange key ${exchangeKeyId} not found, skipping positions`);
            processedPositions += positions.length;
            continue;
          }

          const exchangeClient = await this.exchangeManagerService.getExchangeClient(
            exchangeKey.exchange.slug,
            position.user
          );

          // Batch fetch tickers for all symbols
          const symbols = [...new Set(positions.map((p) => p.symbol))];
          const tickers: Record<string, number> = {};

          for (const symbol of symbols) {
            try {
              const ticker = await exchangeClient.fetchTicker(symbol);
              const price = ticker.last ?? ticker.close ?? null;
              if (price != null && price > 0) {
                tickers[symbol] = price;
              }
            } catch (tickerError: unknown) {
              const err = toErrorInfo(tickerError);
              this.logger.warn(`Failed to fetch ticker for ${symbol}: ${err.message}`);
            }
          }

          // Process each position
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

            processedPositions++;
            const progressPercentage = Math.floor(20 + (processedPositions / totalPositions) * 70);
            await job.updateProgress(progressPercentage);
          }
        } catch (exchangeError: unknown) {
          const err = toErrorInfo(exchangeError);
          this.logger.error(`Failed to process positions for exchange ${exchangeKeyId}: ${err.message}`);
          processedPositions += positions.length;
        }
      }

      await job.updateProgress(100);

      this.logger.log(
        `Position monitoring complete: ${totalPositions} monitored, ${updated} updated, ${triggered} triggered`
      );

      return {
        monitored: totalPositions,
        updated,
        triggered,
        timestamp: new Date().toISOString()
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Position monitoring failed: ${err.message}`, err.stack);
      throw error;
    }
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
    const grouped: Record<string, PositionExit[]> = {};

    for (const position of positions) {
      const key = position.exchangeKeyId || 'unknown';
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(position);
    }

    return grouped;
  }

  /**
   * Update trailing stop for a single position
   */
  private async updateTrailingStop(
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
      if (side === 'BUY') {
        // Long position: track highest price
        if (currentPrice > (position.trailingHighWaterMark || 0)) {
          position.trailingHighWaterMark = currentPrice;

          // Calculate new stop price
          const newStopPrice = this.calculateTrailingStopPrice(currentPrice, config, side, position.entryAtr);

          // Only update if new stop is higher (ratchet mechanism)
          if (newStopPrice > (position.currentTrailingStopPrice || 0)) {
            this.logger.log(
              `Updating trailing stop for position ${position.id}: ${position.currentTrailingStopPrice} -> ${newStopPrice}`
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
        if (currentPrice <= (position.currentTrailingStopPrice || 0)) {
          triggered = true;
          position.status = PositionExitStatus.TRAILING_TRIGGERED;
          position.triggeredAt = new Date();
          position.exitPrice = currentPrice;
          this.logger.log(`Trailing stop triggered for position ${position.id} at price ${currentPrice}`);
        }
      } else {
        // Short position: track lowest price
        if (currentPrice < (position.trailingLowWaterMark || Infinity)) {
          position.trailingLowWaterMark = currentPrice;

          // Calculate new stop price
          const newStopPrice = this.calculateTrailingStopPrice(currentPrice, config, side, position.entryAtr);

          // Only update if new stop is lower (ratchet mechanism for shorts)
          if (newStopPrice < (position.currentTrailingStopPrice || Infinity)) {
            this.logger.log(
              `Updating trailing stop for short position ${position.id}: ${position.currentTrailingStopPrice} -> ${newStopPrice}`
            );

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
        if (currentPrice >= (position.currentTrailingStopPrice || Infinity)) {
          triggered = true;
          position.status = PositionExitStatus.TRAILING_TRIGGERED;
          position.triggeredAt = new Date();
          position.exitPrice = currentPrice;
          this.logger.log(`Trailing stop triggered for short position ${position.id} at price ${currentPrice}`);
        }
      }
    }

    // Save position updates
    if (updated || triggered) {
      await this.positionExitRepo.save(position);
    }

    return { updated, triggered };
  }

  /**
   * Check if trailing stop should activate based on activation settings
   */
  private shouldActivateTrailing(position: PositionExit, currentPrice: number): boolean {
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
        const targetPrice =
          side === 'BUY'
            ? position.entryPrice * (1 + percentGain / 100)
            : position.entryPrice * (1 - percentGain / 100);
        return side === 'BUY' ? currentPrice >= targetPrice : currentPrice <= targetPrice;
      }

      default:
        return false;
    }
  }

  /**
   * Calculate trailing stop price from current price
   */
  private calculateTrailingStopPrice(
    currentPrice: number,
    config: ExitConfig,
    side: 'BUY' | 'SELL',
    entryAtr?: number
  ): number {
    let trailingDistance: number;

    switch (config.trailingType) {
      case TrailingType.AMOUNT:
        trailingDistance = config.trailingValue;
        break;

      case TrailingType.PERCENTAGE:
        trailingDistance = currentPrice * (config.trailingValue / 100);
        break;

      case TrailingType.ATR: {
        if (!entryAtr || isNaN(entryAtr)) {
          trailingDistance = currentPrice * 0.02; // Fallback to 2%
          this.logger.warn('ATR value unavailable for trailing stop, using 2% fallback');
          break;
        }
        // trailingValue = ATR multiplier, entryAtr = raw ATR reading
        trailingDistance = entryAtr * config.trailingValue;
        break;
      }

      default:
        trailingDistance = currentPrice * 0.02; // 2% default
    }

    return side === 'BUY' ? currentPrice - trailingDistance : currentPrice + trailingDistance;
  }

  /**
   * Update stop order on exchange using cancel-and-replace pattern.
   *
   * Most exchanges don't support modifying stop orders in-place.
   * This method cancels the existing stop order and places a new one
   * at the updated price. If the replacement order fails, the position
   * is marked as ERROR since it is now unprotected.
   */
  private async updateStopOrderOnExchange(
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
        // Order was already filled or cancelled externally
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
      // CRITICAL: Position is now unprotected — old stop cancelled but new one failed
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
      // Mark old order CANCELED
      existingOrder.status = OrderStatus.CANCELED;
      await manager.save(Order, existingOrder);

      // Save new order
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

      // Update position reference
      position.trailingStopOrderId = savedNewOrder.id;
    });

    this.logger.log(
      `Stop order updated for position ${position.id}: ${existingOrder.orderId} -> ${ccxtOrder.id} at price ${newStopPrice}`
    );
  }
}
