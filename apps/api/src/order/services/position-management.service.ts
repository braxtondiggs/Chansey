import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import * as ccxt from 'ccxt';
import { Decimal } from 'decimal.js';
import { DataSource, Repository } from 'typeorm';

import { ExitOrderPlacementService } from './exit-order-placement.service';
import { ExitPriceService } from './exit-price.service';

import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { PriceSummary } from '../../ohlc/ohlc-candle.entity';
import { CircuitOpenError } from '../../shared/circuit-breaker.service';
import { toErrorInfo } from '../../shared/error.util';
import { User } from '../../users/users.entity';
import { PositionExit } from '../entities/position-exit.entity';
import {
  AttachExitOrdersResult,
  DEFAULT_EXIT_CONFIG,
  ExchangeMarketLimits,
  ExitConfig,
  PositionExitStatus,
  StopLossType,
  TrailingActivationType,
  TrailingType
} from '../interfaces/exit-config.interface';
import { ORDER_EVENTS, PositionExitFilledPayload } from '../interfaces/order-events.interface';
import { Order } from '../order.entity';

/**
 * PositionManagementService
 *
 * Facade for managing automated exit orders (stop-loss, take-profit, trailing stop) for positions.
 * Delegates price calculation to ExitPriceService and exchange interaction to ExitOrderPlacementService.
 */
@Injectable()
export class PositionManagementService {
  private readonly logger = new Logger(PositionManagementService.name);

  constructor(
    @InjectRepository(PositionExit)
    private readonly positionExitRepo: Repository<PositionExit>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    private readonly exchangeKeyService: ExchangeKeyService,
    private readonly exitPriceService: ExitPriceService,
    private readonly exitOrderPlacementService: ExitOrderPlacementService,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2
  ) {}

  /**
   * Attach exit orders to a newly created entry order
   */
  async attachExitOrders(
    entryOrder: Order,
    exitConfig: Partial<ExitConfig>,
    priceData?: PriceSummary[]
  ): Promise<AttachExitOrdersResult> {
    const config = { ...DEFAULT_EXIT_CONFIG, ...exitConfig };
    const warnings: string[] = [];

    this.logger.log(`Attaching exit orders to entry ${entryOrder.id} (${entryOrder.symbol} ${entryOrder.side})`);

    // Validate exit config
    if (!config.enableStopLoss && !config.enableTakeProfit && !config.enableTrailingStop) {
      throw new BadRequestException('At least one exit type must be enabled');
    }

    // Input sanitization
    this.exitPriceService.validateExitConfigInputs(config);

    // Get entry price
    const entryPrice = entryOrder.averagePrice || entryOrder.price || 0;
    if (entryPrice <= 0) {
      throw new BadRequestException('Entry order must have a valid price');
    }

    const user = entryOrder.user;
    if (!user) {
      throw new BadRequestException('User not found for entry order. Ensure entry order has user relation loaded.');
    }

    const exchangeKey = entryOrder.exchangeKeyId
      ? await this.exchangeKeyService.findOne(entryOrder.exchangeKeyId, user.id)
      : null;

    // Calculate ATR if needed
    let currentAtr: number | undefined;
    if (
      (config.stopLossType === StopLossType.ATR || config.trailingType === TrailingType.ATR) &&
      priceData &&
      priceData.length > 0
    ) {
      currentAtr = await this.exitPriceService.calculateCurrentAtr(
        entryOrder.baseCoin?.id || entryOrder.symbol.split('/')[0],
        priceData,
        config.atrPeriod || 14
      );

      if (!currentAtr || isNaN(currentAtr)) {
        warnings.push('ATR calculation failed, falling back to percentage-based stops');
        if (config.stopLossType === StopLossType.ATR) {
          config.stopLossType = StopLossType.PERCENTAGE;
          config.stopLossValue = 2.0;
        }
      }
    }

    // Calculate exit prices
    const side = entryOrder.side as 'BUY' | 'SELL';
    const calculatedPrices = this.exitPriceService.calculateExitPrices(entryPrice, side, config, currentAtr);

    // Validate exit prices
    const validationResult = this.exitPriceService.validateExitPrices(calculatedPrices, side);
    if (!validationResult.isValid) {
      const errorMessages = validationResult.errors.map((e) => e.message).join('; ');
      this.logger.error(`Exit price validation failed: ${errorMessages}`);
      throw new BadRequestException(`Invalid exit prices: ${errorMessages}`);
    }

    // Start transaction for exit order creation
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let stopLossOrder: Order | undefined;
    let takeProfitOrder: Order | undefined;
    let trailingStopOrder: Order | undefined;
    let ocoLinked = false;

    try {
      // Get exchange client if available (with resilience)
      let exchangeClient: ccxt.Exchange | null = null;
      let exchangeSlug: string | undefined;
      let marketLimits: ExchangeMarketLimits | null = null;

      if (exchangeKey?.exchange) {
        exchangeSlug = exchangeKey.exchange.slug;
        try {
          exchangeClient = await this.exitOrderPlacementService.getExchangeClient(exchangeSlug, user);
          const client = exchangeClient;
          await this.exitOrderPlacementService.executeWithResilience(
            exchangeSlug,
            async () => {
              await client.loadMarkets();
            },
            'loadMarkets'
          );
          marketLimits = this.exitOrderPlacementService.getMarketLimits(exchangeClient, entryOrder.symbol);
        } catch (clientError: unknown) {
          const err = toErrorInfo(clientError);
          if (clientError instanceof CircuitOpenError) {
            warnings.push(`Exchange ${exchangeSlug} circuit open - orders will be tracked locally`);
          } else {
            warnings.push(`Exchange client initialization failed: ${err.message}`);
          }
          this.logger.warn(`Exchange client unavailable for ${exchangeSlug}: ${err.message}`);
          exchangeClient = null;
        }
      }

      // Determine exit order side (opposite of entry)
      const exitSide: 'BUY' | 'SELL' = side === 'BUY' ? 'SELL' : 'BUY';

      // Get raw quantity from entry order
      const rawQuantity = entryOrder.executedQuantity || entryOrder.quantity;

      // Validate quantity for stop loss
      let stopLossQuantity = rawQuantity;
      if (config.enableStopLoss && calculatedPrices.stopLossPrice) {
        const slValidation = this.exitPriceService.validateExitOrderQuantity(
          rawQuantity,
          calculatedPrices.stopLossPrice,
          marketLimits
        );
        if (!slValidation.isValid) {
          warnings.push(`Stop loss quantity invalid: ${slValidation.error}`);
          this.logger.warn(`Stop loss quantity validation failed: ${slValidation.error}`);
        } else {
          stopLossQuantity = slValidation.adjustedQuantity;
          if (slValidation.adjustedQuantity !== slValidation.originalQuantity) {
            this.logger.debug(
              `Stop loss quantity adjusted from ${slValidation.originalQuantity} to ${slValidation.adjustedQuantity}`
            );
          }
        }
      }

      // Validate quantity for take profit
      let takeProfitQuantity = rawQuantity;
      if (config.enableTakeProfit && calculatedPrices.takeProfitPrice) {
        const tpValidation = this.exitPriceService.validateExitOrderQuantity(
          rawQuantity,
          calculatedPrices.takeProfitPrice,
          marketLimits
        );
        if (!tpValidation.isValid) {
          warnings.push(`Take profit quantity invalid: ${tpValidation.error}`);
          this.logger.warn(`Take profit quantity validation failed: ${tpValidation.error}`);
        } else {
          takeProfitQuantity = tpValidation.adjustedQuantity;
          if (tpValidation.adjustedQuantity !== tpValidation.originalQuantity) {
            this.logger.debug(
              `Take profit quantity adjusted from ${tpValidation.originalQuantity} to ${tpValidation.adjustedQuantity}`
            );
          }
        }
      }

      // Place stop loss order (using validated quantity)
      if (config.enableStopLoss && calculatedPrices.stopLossPrice && stopLossQuantity > 0) {
        try {
          stopLossOrder = await this.exitOrderPlacementService.placeStopLossOrder(
            {
              userId: user.id,
              exchangeKeyId: entryOrder.exchangeKeyId || undefined,
              symbol: entryOrder.symbol,
              side: exitSide,
              quantity: stopLossQuantity,
              price: calculatedPrices.stopLossPrice,
              orderType: 'stop_loss',
              stopPrice: calculatedPrices.stopLossPrice
            },
            exchangeClient,
            user,
            exchangeKey,
            queryRunner,
            exchangeSlug
          );
        } catch (slError: unknown) {
          const err = toErrorInfo(slError);
          warnings.push(`Stop loss placement failed: ${err.message}`);
          this.logger.warn(`Failed to place stop loss: ${err.message}`);
        }
      }

      // Place take profit order (using validated quantity)
      if (config.enableTakeProfit && calculatedPrices.takeProfitPrice && takeProfitQuantity > 0) {
        try {
          takeProfitOrder = await this.exitOrderPlacementService.placeTakeProfitOrder(
            {
              userId: user.id,
              exchangeKeyId: entryOrder.exchangeKeyId || undefined,
              symbol: entryOrder.symbol,
              side: exitSide,
              quantity: takeProfitQuantity,
              price: calculatedPrices.takeProfitPrice,
              orderType: 'take_profit'
            },
            exchangeClient,
            user,
            exchangeKey,
            queryRunner,
            exchangeSlug
          );
        } catch (tpError: unknown) {
          const err = toErrorInfo(tpError);
          warnings.push(`Take profit placement failed: ${err.message}`);
          this.logger.warn(`Failed to place take profit: ${err.message}`);
        }
      }

      // Link as OCO if both exist and config enables it
      if (config.useOco && stopLossOrder && takeProfitOrder && exchangeSlug) {
        const ocoSupport = this.exitOrderPlacementService.checkExchangeOcoSupport(exchangeSlug);

        if (ocoSupport.native && exchangeClient) {
          try {
            await this.exitOrderPlacementService.linkOcoOrdersNative(stopLossOrder, takeProfitOrder, exchangeClient);
            ocoLinked = true;
          } catch (ocoError: unknown) {
            const err = toErrorInfo(ocoError);
            warnings.push(`Native OCO linking failed: ${err.message}`);
          }
        }

        // Even without native OCO, mark as linked for simulated OCO
        if (!ocoLinked && ocoSupport.simulated) {
          stopLossOrder.ocoLinkedOrderId = takeProfitOrder.id;
          takeProfitOrder.ocoLinkedOrderId = stopLossOrder.id;
          await queryRunner.manager.save(stopLossOrder);
          await queryRunner.manager.save(takeProfitOrder);
          ocoLinked = true;
          this.logger.log('OCO orders linked for simulated monitoring');
        }
      }

      // Create position exit tracking record
      const positionExit = queryRunner.manager.create(PositionExit, {
        positionId: entryOrder.algorithmActivationId,
        entryOrder,
        entryOrderId: entryOrder.id,
        stopLossOrder,
        stopLossOrderId: stopLossOrder?.id,
        takeProfitOrder,
        takeProfitOrderId: takeProfitOrder?.id,
        trailingStopOrder,
        trailingStopOrderId: trailingStopOrder?.id,
        entryPrice,
        stopLossPrice: calculatedPrices.stopLossPrice,
        takeProfitPrice: calculatedPrices.takeProfitPrice,
        currentTrailingStopPrice: calculatedPrices.trailingStopPrice,
        trailingHighWaterMark: side === 'BUY' ? entryPrice : undefined,
        trailingLowWaterMark: side === 'SELL' ? entryPrice : undefined,
        trailingActivated: config.trailingActivation === TrailingActivationType.IMMEDIATE,
        ocoLinked,
        exitConfig: config,
        status: PositionExitStatus.ACTIVE,
        symbol: entryOrder.symbol,
        quantity: entryOrder.executedQuantity || entryOrder.quantity,
        side,
        user,
        userId: user.id,
        strategyConfigId: entryOrder.strategyConfigId,
        exchangeKeyId: entryOrder.exchangeKeyId,
        entryAtr: currentAtr,
        warnings: warnings.length > 0 ? warnings : undefined
      });

      const savedPositionExit = await queryRunner.manager.save(positionExit);

      await queryRunner.commitTransaction();

      this.logger.log(
        `Exit orders attached: SL=${stopLossOrder?.id || 'none'}, TP=${takeProfitOrder?.id || 'none'}, ` +
          `OCO=${ocoLinked}, PositionExit=${savedPositionExit.id}`
      );

      return {
        positionExitId: savedPositionExit.id,
        stopLossOrderId: stopLossOrder?.id,
        takeProfitOrderId: takeProfitOrder?.id,
        trailingStopOrderId: trailingStopOrder?.id,
        calculatedPrices,
        ocoLinked,
        warnings: warnings.length > 0 ? warnings : undefined
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      await queryRunner.rollbackTransaction();
      this.logger.error(`Failed to attach exit orders: ${err.message}`, err.stack);
      throw new BadRequestException(`Failed to attach exit orders: ${err.message}`);
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Handle OCO fill - cancel the other leg when one fills
   */
  async handleOcoFill(filledOrderId: string): Promise<void> {
    const positionExit = await this.positionExitRepo.findOne({
      where: [{ stopLossOrderId: filledOrderId }, { takeProfitOrderId: filledOrderId }],
      relations: ['user', 'stopLossOrder', 'takeProfitOrder']
    });

    if (!positionExit || !positionExit.ocoLinked) {
      return;
    }

    // Determine which order filled and which to cancel
    const isStopLossFilled = positionExit.stopLossOrderId === filledOrderId;
    const otherOrderId = isStopLossFilled ? positionExit.takeProfitOrderId : positionExit.stopLossOrderId;

    if (otherOrderId) {
      await this.exitOrderPlacementService.cancelOrderById(otherOrderId, positionExit.user);
    }

    // Update position exit status
    positionExit.status = isStopLossFilled
      ? PositionExitStatus.STOP_LOSS_TRIGGERED
      : PositionExitStatus.TAKE_PROFIT_TRIGGERED;
    positionExit.triggeredAt = new Date();

    // Get exit price from filled order
    const filledOrder = await this.orderRepo.findOneBy({ id: filledOrderId });
    if (filledOrder) {
      positionExit.exitPrice = filledOrder.averagePrice || filledOrder.price;
      positionExit.realizedPnL = this.calculateRealizedPnL(
        positionExit.entryPrice,
        positionExit.exitPrice,
        positionExit.quantity,
        positionExit.side
      );
    }

    await this.positionExitRepo.save(positionExit);

    // Downstream modules (e.g. listing-tracker) listen for this to close hedge legs
    // and update their own position status. Only emit for actual fills — cancelled
    // / expired / error transitions are handled by their own paths.
    if (
      positionExit.status === PositionExitStatus.STOP_LOSS_TRIGGERED ||
      positionExit.status === PositionExitStatus.TAKE_PROFIT_TRIGGERED ||
      positionExit.status === PositionExitStatus.TRAILING_TRIGGERED
    ) {
      this.eventEmitter.emit(ORDER_EVENTS.POSITION_EXIT_FILLED, {
        positionExitId: positionExit.id,
        entryOrderId: positionExit.entryOrderId,
        userId: positionExit.user.id,
        status: positionExit.status,
        exitPrice: positionExit.exitPrice ?? null,
        realizedPnL: positionExit.realizedPnL ?? null
      } satisfies PositionExitFilledPayload);
    }

    this.logger.log(
      `OCO fill handled: ${isStopLossFilled ? 'SL' : 'TP'} triggered, cancelled ${isStopLossFilled ? 'TP' : 'SL'}`
    );
  }

  /**
   * Cancel all exit orders for a position
   */
  async cancelExitOrders(positionExitId: string, user: User): Promise<void> {
    const positionExit = await this.positionExitRepo.findOne({
      where: { id: positionExitId, userId: user.id },
      relations: ['stopLossOrder', 'takeProfitOrder', 'trailingStopOrder']
    });

    if (!positionExit) {
      throw new BadRequestException('Position exit not found');
    }

    // Cancel all exit orders
    if (positionExit.stopLossOrderId) {
      await this.exitOrderPlacementService.cancelOrderById(positionExit.stopLossOrderId, user);
    }
    if (positionExit.takeProfitOrderId) {
      await this.exitOrderPlacementService.cancelOrderById(positionExit.takeProfitOrderId, user);
    }
    if (positionExit.trailingStopOrderId) {
      await this.exitOrderPlacementService.cancelOrderById(positionExit.trailingStopOrderId, user);
    }

    // Update position exit status
    positionExit.status = PositionExitStatus.CANCELLED;
    await this.positionExitRepo.save(positionExit);

    this.logger.log(`All exit orders cancelled for position exit ${positionExitId}`);
  }

  /**
   * Calculate realized P&L from exit
   */
  private calculateRealizedPnL(entryPrice: number, exitPrice: number, quantity: number, side: 'BUY' | 'SELL'): number {
    const entry = new Decimal(entryPrice);
    const exit = new Decimal(exitPrice);
    const qty = new Decimal(quantity);
    const diff = side === 'BUY' ? exit.minus(entry) : entry.minus(exit);
    return diff.times(qty).toNumber();
  }
}
