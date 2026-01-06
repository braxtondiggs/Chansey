import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import * as ccxt from 'ccxt';
import { DataSource, QueryRunner, Repository } from 'typeorm';

import { IndicatorService } from '../../algorithm/indicators/indicator.service';
import { Coin } from '../../coin/coin.entity';
import { CoinService } from '../../coin/coin.service';
import { ExchangeKey } from '../../exchange/exchange-key/exchange-key.entity';
import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { PriceSummary } from '../../price/price.entity';
import { User } from '../../users/users.entity';
import { PositionExit } from '../entities/position-exit.entity';
import {
  AttachExitOrdersResult,
  CalculatedExitPrices,
  DEFAULT_EXIT_CONFIG,
  ExitConfig,
  PlaceExitOrderParams,
  PositionExitStatus,
  StopLossType,
  TakeProfitType,
  TrailingActivationType,
  TrailingType
} from '../interfaces/exit-config.interface';
import { Order, OrderSide, OrderStatus, OrderType } from '../order.entity';

/**
 * Exchange OCO support configuration
 */
interface ExchangeOcoSupport {
  /** Exchange supports native OCO orders */
  native: boolean;
  /** Exchange supports simulated OCO (via position monitoring) */
  simulated: boolean;
}

/**
 * PositionManagementService
 *
 * Manages automated exit orders (stop-loss, take-profit, trailing stop) for positions.
 * Attaches exit orders to entry orders, calculates exit prices, and handles OCO linking.
 */
@Injectable()
export class PositionManagementService {
  private readonly logger = new Logger(PositionManagementService.name);

  /**
   * Known OCO support per exchange
   */
  private readonly exchangeOcoSupport: Record<string, ExchangeOcoSupport> = {
    binance_us: { native: true, simulated: true },
    binance: { native: true, simulated: true },
    coinbase: { native: false, simulated: true },
    gdax: { native: false, simulated: true },
    kraken: { native: false, simulated: true }
  };

  constructor(
    @InjectRepository(PositionExit)
    private readonly positionExitRepo: Repository<PositionExit>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly exchangeKeyService: ExchangeKeyService,
    private readonly exchangeManagerService: ExchangeManagerService,
    private readonly coinService: CoinService,
    private readonly indicatorService: IndicatorService,
    private readonly dataSource: DataSource
  ) {}

  /**
   * Attach exit orders to a newly created entry order
   *
   * @param entryOrder - The entry order to attach exits to
   * @param exitConfig - Exit configuration (SL/TP/trailing settings)
   * @param priceData - Historical price data for ATR calculation (optional)
   * @returns Result with exit order IDs and calculated prices
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

    // Get entry price (use average or executed price)
    const entryPrice = entryOrder.averagePrice || entryOrder.price || 0;
    if (entryPrice <= 0) {
      throw new BadRequestException('Entry order must have a valid price');
    }

    // Get user from the entry order relation
    // The user relation must be loaded on the entry order
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
      currentAtr = await this.calculateCurrentAtr(
        entryOrder.baseCoin?.id || entryOrder.symbol.split('/')[0],
        priceData,
        config.atrPeriod || 14
      );

      if (!currentAtr || isNaN(currentAtr)) {
        warnings.push('ATR calculation failed, falling back to percentage-based stops');
        // Fallback to percentage
        if (config.stopLossType === StopLossType.ATR) {
          config.stopLossType = StopLossType.PERCENTAGE;
          config.stopLossValue = 2.0; // 2% default
        }
      }
    }

    // Calculate exit prices
    const side = entryOrder.side as 'BUY' | 'SELL';
    const calculatedPrices = this.calculateExitPrices(entryPrice, side, config, currentAtr);

    // Start transaction for exit order creation
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let stopLossOrder: Order | undefined;
    let takeProfitOrder: Order | undefined;
    let trailingStopOrder: Order | undefined;
    let ocoLinked = false;

    try {
      // Get exchange client if available
      let exchangeClient: ccxt.Exchange | null = null;
      let exchangeSlug: string | undefined;

      if (exchangeKey?.exchange) {
        exchangeSlug = exchangeKey.exchange.slug;
        exchangeClient = await this.exchangeManagerService.getExchangeClient(exchangeSlug, user);
        await exchangeClient.loadMarkets();
      }

      // Determine exit order side (opposite of entry)
      const exitSide: 'BUY' | 'SELL' = side === 'BUY' ? 'SELL' : 'BUY';

      // Place stop loss order
      if (config.enableStopLoss && calculatedPrices.stopLossPrice) {
        try {
          stopLossOrder = await this.placeStopLossOrder(
            {
              userId: user.id,
              exchangeKeyId: entryOrder.exchangeKeyId || '',
              symbol: entryOrder.symbol,
              side: exitSide,
              quantity: entryOrder.executedQuantity || entryOrder.quantity,
              price: calculatedPrices.stopLossPrice,
              orderType: 'stop_loss',
              stopPrice: calculatedPrices.stopLossPrice
            },
            exchangeClient,
            user,
            exchangeKey,
            queryRunner
          );
        } catch (slError) {
          warnings.push(`Stop loss placement failed: ${slError.message}`);
          this.logger.warn(`Failed to place stop loss: ${slError.message}`);
        }
      }

      // Place take profit order
      if (config.enableTakeProfit && calculatedPrices.takeProfitPrice) {
        try {
          takeProfitOrder = await this.placeTakeProfitOrder(
            {
              userId: user.id,
              exchangeKeyId: entryOrder.exchangeKeyId || '',
              symbol: entryOrder.symbol,
              side: exitSide,
              quantity: entryOrder.executedQuantity || entryOrder.quantity,
              price: calculatedPrices.takeProfitPrice,
              orderType: 'take_profit'
            },
            exchangeClient,
            user,
            exchangeKey,
            queryRunner
          );
        } catch (tpError) {
          warnings.push(`Take profit placement failed: ${tpError.message}`);
          this.logger.warn(`Failed to place take profit: ${tpError.message}`);
        }
      }

      // Link as OCO if both exist and config enables it
      if (config.useOco && stopLossOrder && takeProfitOrder && exchangeSlug) {
        const ocoSupport = this.checkExchangeOcoSupport(exchangeSlug);

        if (ocoSupport.native && exchangeClient) {
          try {
            await this.linkOcoOrdersNative(stopLossOrder, takeProfitOrder, exchangeClient);
            ocoLinked = true;
          } catch (ocoError) {
            warnings.push(`Native OCO linking failed: ${ocoError.message}`);
            // Will use simulated OCO via position monitor
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
        positionId: entryOrder.algorithmActivationId, // Link to strategy position if available
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
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Failed to attach exit orders: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to attach exit orders: ${error.message}`);
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Calculate exit prices based on entry and configuration
   */
  calculateExitPrices(
    entryPrice: number,
    side: 'BUY' | 'SELL',
    config: ExitConfig,
    currentAtr?: number
  ): CalculatedExitPrices {
    const result: CalculatedExitPrices = { entryPrice };

    // Calculate stop loss price
    if (config.enableStopLoss) {
      result.stopLossPrice = this.calculateStopLossPrice(entryPrice, side, config, currentAtr);
    }

    // Calculate take profit price
    if (config.enableTakeProfit) {
      result.takeProfitPrice = this.calculateTakeProfitPrice(entryPrice, side, config, result.stopLossPrice);
    }

    // Calculate trailing stop initial price
    if (config.enableTrailingStop) {
      result.trailingStopPrice = this.calculateTrailingStopPrice(entryPrice, side, config, currentAtr);

      // Calculate activation price if not immediate
      if (config.trailingActivation !== TrailingActivationType.IMMEDIATE) {
        result.trailingActivationPrice = this.calculateTrailingActivationPrice(entryPrice, side, config);
      }
    }

    return result;
  }

  /**
   * Calculate stop loss price
   */
  private calculateStopLossPrice(
    entryPrice: number,
    side: 'BUY' | 'SELL',
    config: ExitConfig,
    currentAtr?: number
  ): number {
    let stopDistance: number;

    switch (config.stopLossType) {
      case StopLossType.FIXED:
        return config.stopLossValue;

      case StopLossType.PERCENTAGE:
        stopDistance = entryPrice * (config.stopLossValue / 100);
        break;

      case StopLossType.ATR:
        if (!currentAtr || isNaN(currentAtr)) {
          // Fallback to 2% if ATR not available
          stopDistance = entryPrice * 0.02;
          this.logger.warn('ATR not available for stop loss, using 2% fallback');
        } else {
          stopDistance = currentAtr * config.stopLossValue;
        }
        break;

      default:
        stopDistance = entryPrice * 0.02;
    }

    // Long position: stop below entry, Short position: stop above entry
    return side === 'BUY' ? entryPrice - stopDistance : entryPrice + stopDistance;
  }

  /**
   * Calculate take profit price
   */
  private calculateTakeProfitPrice(
    entryPrice: number,
    side: 'BUY' | 'SELL',
    config: ExitConfig,
    stopLossPrice?: number
  ): number {
    let profitDistance: number;

    switch (config.takeProfitType) {
      case TakeProfitType.FIXED:
        return config.takeProfitValue;

      case TakeProfitType.PERCENTAGE:
        profitDistance = entryPrice * (config.takeProfitValue / 100);
        break;

      case TakeProfitType.RISK_REWARD:
        if (!stopLossPrice) {
          // Fallback to 4% if no stop loss for R:R calculation
          profitDistance = entryPrice * 0.04;
          this.logger.warn('No stop loss for R:R calculation, using 4% fallback');
        } else {
          const riskDistance = Math.abs(entryPrice - stopLossPrice);
          profitDistance = riskDistance * config.takeProfitValue;
        }
        break;

      default:
        profitDistance = entryPrice * 0.04;
    }

    // Long position: profit above entry, Short position: profit below entry
    return side === 'BUY' ? entryPrice + profitDistance : entryPrice - profitDistance;
  }

  /**
   * Calculate initial trailing stop price
   */
  private calculateTrailingStopPrice(
    entryPrice: number,
    side: 'BUY' | 'SELL',
    config: ExitConfig,
    currentAtr?: number
  ): number {
    let trailingDistance: number;

    switch (config.trailingType) {
      case TrailingType.AMOUNT:
        trailingDistance = config.trailingValue;
        break;

      case TrailingType.PERCENTAGE:
        trailingDistance = entryPrice * (config.trailingValue / 100);
        break;

      case TrailingType.ATR:
        if (!currentAtr || isNaN(currentAtr)) {
          trailingDistance = entryPrice * 0.01; // 1% fallback
        } else {
          trailingDistance = currentAtr * config.trailingValue;
        }
        break;

      default:
        trailingDistance = entryPrice * 0.01;
    }

    return side === 'BUY' ? entryPrice - trailingDistance : entryPrice + trailingDistance;
  }

  /**
   * Calculate trailing stop activation price
   */
  private calculateTrailingActivationPrice(entryPrice: number, side: 'BUY' | 'SELL', config: ExitConfig): number {
    switch (config.trailingActivation) {
      case TrailingActivationType.PRICE:
        return config.trailingActivationValue || entryPrice;

      case TrailingActivationType.PERCENTAGE: {
        const activationGain = entryPrice * ((config.trailingActivationValue || 1) / 100);
        return side === 'BUY' ? entryPrice + activationGain : entryPrice - activationGain;
      }

      default:
        return entryPrice;
    }
  }

  /**
   * Calculate current ATR value from price data
   */
  private async calculateCurrentAtr(
    coinId: string,
    priceData: PriceSummary[],
    period: number
  ): Promise<number | undefined> {
    try {
      if (priceData.length < period + 1) {
        this.logger.warn(`Insufficient price data for ATR calculation: ${priceData.length} < ${period + 1}`);
        return undefined;
      }

      const atrResult = await this.indicatorService.calculateATR({
        coinId,
        prices: priceData,
        period
      });

      // Get the most recent non-NaN ATR value
      for (let i = atrResult.values.length - 1; i >= 0; i--) {
        if (!isNaN(atrResult.values[i])) {
          return atrResult.values[i];
        }
      }

      return undefined;
    } catch (error) {
      this.logger.error(`ATR calculation failed: ${error.message}`);
      return undefined;
    }
  }

  /**
   * Lookup base and quote coins for a trading symbol
   * @param symbol - Trading pair symbol (e.g., 'BTC/USDT')
   * @returns Object containing baseCoin and quoteCoin (or null if not found)
   */
  private async lookupCoinsForSymbol(symbol: string): Promise<{ baseCoin: Coin | null; quoteCoin: Coin | null }> {
    const [baseSymbol, quoteSymbol] = symbol.split('/');
    let baseCoin: Coin | null = null;
    let quoteCoin: Coin | null = null;

    try {
      const coins = await this.coinService.getMultipleCoinsBySymbol([baseSymbol, quoteSymbol]);
      baseCoin = coins.find((c) => c.symbol.toLowerCase() === baseSymbol.toLowerCase()) || null;
      quoteCoin = coins.find((c) => c.symbol.toLowerCase() === quoteSymbol.toLowerCase()) || null;

      if (!baseCoin) {
        this.logger.debug(`Base coin ${baseSymbol} not found in database`);
      }
      if (!quoteCoin) {
        this.logger.debug(`Quote coin ${quoteSymbol} not found in database`);
      }
    } catch (error) {
      this.logger.warn(`Could not lookup coins for symbol ${symbol}: ${error.message}`);
    }

    return { baseCoin, quoteCoin };
  }

  /**
   * Place stop loss order on exchange
   */
  private async placeStopLossOrder(
    params: PlaceExitOrderParams,
    exchangeClient: ccxt.Exchange | null,
    user: User,
    exchangeKey: ExchangeKey | null,
    queryRunner: QueryRunner
  ): Promise<Order> {
    let ccxtOrder: ccxt.Order | null = null;

    if (exchangeClient) {
      try {
        ccxtOrder = await exchangeClient.createOrder(
          params.symbol,
          'stop_loss',
          params.side.toLowerCase(),
          params.quantity,
          undefined, // No limit price for market stop
          { stopPrice: params.stopPrice }
        );
      } catch (exchangeError) {
        this.logger.warn(`Exchange stop loss creation failed: ${exchangeError.message}`);
        // Will create a tracking order for monitoring
      }
    }

    // Lookup coins for the symbol
    const { baseCoin, quoteCoin } = await this.lookupCoinsForSymbol(params.symbol);

    // Create order entity
    const order = queryRunner.manager.create(Order, {
      orderId: ccxtOrder?.id?.toString() || `sl_pending_${Date.now()}`,
      clientOrderId: ccxtOrder?.clientOrderId || `sl_pending_${Date.now()}`,
      symbol: params.symbol,
      side: params.side as OrderSide,
      type: OrderType.STOP_LOSS,
      quantity: params.quantity,
      price: 0, // Market order
      executedQuantity: 0,
      status: ccxtOrder ? OrderStatus.NEW : OrderStatus.NEW, // Mark as pending if not placed
      transactTime: new Date(),
      isManual: false,
      exchangeKeyId: params.exchangeKeyId,
      stopPrice: params.stopPrice,
      stopLossPrice: params.stopPrice,
      user,
      baseCoin: baseCoin || undefined,
      quoteCoin: quoteCoin || undefined,
      exchange: exchangeKey?.exchange,
      info: ccxtOrder?.info
    });

    return queryRunner.manager.save(order);
  }

  /**
   * Place take profit order on exchange
   */
  private async placeTakeProfitOrder(
    params: PlaceExitOrderParams,
    exchangeClient: ccxt.Exchange | null,
    user: User,
    exchangeKey: ExchangeKey | null,
    queryRunner: QueryRunner
  ): Promise<Order> {
    let ccxtOrder: ccxt.Order | null = null;

    if (exchangeClient) {
      try {
        // Take profit is typically a limit order
        ccxtOrder = await exchangeClient.createOrder(
          params.symbol,
          'limit',
          params.side.toLowerCase(),
          params.quantity,
          params.price
        );
      } catch (exchangeError) {
        this.logger.warn(`Exchange take profit creation failed: ${exchangeError.message}`);
      }
    }

    // Lookup coins for the symbol
    const { baseCoin, quoteCoin } = await this.lookupCoinsForSymbol(params.symbol);

    // Create order entity
    const order = queryRunner.manager.create(Order, {
      orderId: ccxtOrder?.id?.toString() || `tp_pending_${Date.now()}`,
      clientOrderId: ccxtOrder?.clientOrderId || `tp_pending_${Date.now()}`,
      symbol: params.symbol,
      side: params.side as OrderSide,
      type: OrderType.TAKE_PROFIT,
      quantity: params.quantity,
      price: params.price,
      executedQuantity: 0,
      status: ccxtOrder ? OrderStatus.NEW : OrderStatus.NEW,
      transactTime: new Date(),
      isManual: false,
      exchangeKeyId: params.exchangeKeyId,
      takeProfitPrice: params.price,
      user,
      baseCoin: baseCoin || undefined,
      quoteCoin: quoteCoin || undefined,
      exchange: exchangeKey?.exchange,
      info: ccxtOrder?.info
    });

    return queryRunner.manager.save(order);
  }

  /**
   * Link OCO orders natively on exchange (for exchanges that support it)
   */
  private async linkOcoOrdersNative(
    stopLossOrder: Order,
    takeProfitOrder: Order,
    exchangeClient: ccxt.Exchange
  ): Promise<void> {
    // Most exchanges don't support modifying orders to link them after creation
    // This would typically require creating a native OCO order type
    // For now, we rely on simulated OCO via the position monitor
    this.logger.log('Native OCO linking not implemented, using simulated OCO');
  }

  /**
   * Check exchange OCO support
   */
  checkExchangeOcoSupport(exchangeSlug: string): ExchangeOcoSupport {
    return this.exchangeOcoSupport[exchangeSlug] || { native: false, simulated: true };
  }

  /**
   * Handle OCO fill - cancel the other leg when one fills
   */
  async handleOcoFill(filledOrderId: string): Promise<void> {
    // Find position exit record with this order
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
      await this.cancelOrderById(otherOrderId, positionExit.user);
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

    this.logger.log(
      `OCO fill handled: ${isStopLossFilled ? 'SL' : 'TP'} triggered, cancelled ${isStopLossFilled ? 'TP' : 'SL'}`
    );
  }

  /**
   * Cancel an order by ID
   */
  private async cancelOrderById(orderId: string, user: User): Promise<void> {
    try {
      const order = await this.orderRepo.findOne({
        where: { id: orderId },
        relations: ['exchange']
      });

      if (!order) {
        this.logger.warn(`Order ${orderId} not found for cancellation`);
        return;
      }

      // Try to cancel on exchange if we have exchange key
      if (order.exchangeKeyId && order.exchange) {
        try {
          const exchangeKey = await this.exchangeKeyService.findOne(order.exchangeKeyId, user.id);
          if (exchangeKey) {
            const exchangeClient = await this.exchangeManagerService.getExchangeClient(order.exchange.slug, user);
            await exchangeClient.cancelOrder(order.orderId, order.symbol);
          }
        } catch (cancelError) {
          this.logger.warn(`Exchange order cancellation failed: ${cancelError.message}`);
        }
      }

      // Update order status in DB
      order.status = OrderStatus.CANCELED;
      await this.orderRepo.save(order);

      this.logger.log(`Order ${orderId} cancelled`);
    } catch (error) {
      this.logger.error(`Failed to cancel order ${orderId}: ${error.message}`);
    }
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
      await this.cancelOrderById(positionExit.stopLossOrderId, user);
    }
    if (positionExit.takeProfitOrderId) {
      await this.cancelOrderById(positionExit.takeProfitOrderId, user);
    }
    if (positionExit.trailingStopOrderId) {
      await this.cancelOrderById(positionExit.trailingStopOrderId, user);
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
    if (side === 'BUY') {
      // Long position: profit when exit > entry
      return (exitPrice - entryPrice) * quantity;
    } else {
      // Short position: profit when exit < entry
      return (entryPrice - exitPrice) * quantity;
    }
  }

  /**
   * Get active position exits for monitoring
   */
  async getActivePositionExits(): Promise<PositionExit[]> {
    return this.positionExitRepo.find({
      where: { status: PositionExitStatus.ACTIVE },
      relations: ['user', 'entryOrder', 'stopLossOrder', 'takeProfitOrder']
    });
  }

  /**
   * Get position exits with trailing stops that need monitoring
   */
  async getActiveTrailingStops(): Promise<PositionExit[]> {
    return this.positionExitRepo
      .createQueryBuilder('pe')
      .where('pe.status = :status', { status: PositionExitStatus.ACTIVE })
      .andWhere("pe.exitConfig->>'enableTrailingStop' = :enabled", { enabled: 'true' })
      .leftJoinAndSelect('pe.user', 'user')
      .leftJoinAndSelect('pe.entryOrder', 'entryOrder')
      .getMany();
  }

  /**
   * Update trailing stop price for a position
   */
  async updateTrailingStopPrice(positionExitId: string, newStopPrice: number, highWaterMark: number): Promise<void> {
    await this.positionExitRepo.update(positionExitId, {
      currentTrailingStopPrice: newStopPrice,
      trailingHighWaterMark: highWaterMark,
      trailingActivated: true
    });
  }
}
