import {
  BadRequestException,
  forwardRef,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import * as ccxt from 'ccxt';
import { Repository } from 'typeorm';

import { getSupportedOrderTypes } from '@chansey/api-interfaces';

import { ManualOrderValidatorService } from './manual-order-validator.service';
import { OcoOrderService } from './oco-order.service';
import { PositionManagementService } from './position-management.service';
import { TradingFeesService } from './trading-fees.service';

import { Coin } from '../../coin/coin.entity';
import { CoinService } from '../../coin/coin.service';
import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { mapCcxtError } from '../../shared/ccxt-error-mapper.util';
import { toErrorInfo } from '../../shared/error.util';
import { extractMarketLimits } from '../../shared/precision.util';
import { User } from '../../users/users.entity';
import { OrderPreviewRequestDto } from '../dto/order-preview-request.dto';
import { OrderPreviewDto } from '../dto/order-preview.dto';
import { PlaceManualOrderDto } from '../dto/place-manual-order.dto';
import { Order, OrderSide, OrderStatus, OrderType } from '../order.entity';
import { CcxtOrderParams, mapOrderTypeToCcxt } from '../utils/ccxt-order-type.util';
import { mapExchangeStatusToOrderStatus } from '../utils/order-status-mapper.util';

/**
 * Handles manual (user-initiated) order operations: preview, place (single-order path), and cancel.
 *
 * Validation is delegated to {@link ManualOrderValidatorService}.
 * OCO pair creation is delegated to {@link OcoOrderService}.
 */
@Injectable()
export class ManualOrderService {
  private readonly logger = new Logger(ManualOrderService.name);

  constructor(
    @InjectRepository(Order) private readonly orderRepository: Repository<Order>,
    private readonly exchangeKeyService: ExchangeKeyService,
    private readonly exchangeManager: ExchangeManagerService,
    private readonly coinService: CoinService,
    private readonly tradingFeesService: TradingFeesService,
    private readonly manualOrderValidator: ManualOrderValidatorService,
    private readonly ocoOrderService: OcoOrderService,
    @Inject(forwardRef(() => PositionManagementService))
    private readonly positionManagementService: PositionManagementService
  ) {}

  /**
   * Preview a manual order to calculate costs and validate
   */
  async previewManualOrder(dto: OrderPreviewRequestDto, user: User): Promise<OrderPreviewDto> {
    this.logger.log(`Previewing manual ${dto.side} ${dto.orderType} order for user: ${user.id}`);

    try {
      const exchangeKey = await this.exchangeKeyService.findOne(dto.exchangeKeyId, user.id);
      if (!exchangeKey || !exchangeKey.exchange) {
        throw new NotFoundException('Exchange key not found');
      }

      const exchangeSlug = exchangeKey.exchange.slug;
      const exchange = await this.exchangeManager.getExchangeClient(exchangeSlug, user);
      await exchange.loadMarkets();

      this.manualOrderValidator.assertOrderTypeSupported(exchangeSlug, dto.orderType, exchangeKey.exchange.name);

      const ticker = await exchange.fetchTicker(dto.symbol);
      const marketPrice = ticker.last || ticker.close || 0;

      let executionPrice = marketPrice;
      if (dto.orderType === OrderType.LIMIT && dto.price) {
        executionPrice = dto.price;
      } else if (dto.orderType === OrderType.STOP_LIMIT && dto.price) {
        executionPrice = dto.price;
      }

      const estimatedCost = dto.quantity * executionPrice;

      const market = exchange.markets[dto.symbol];
      const isMaker = dto.orderType === OrderType.LIMIT;
      const feeRate = isMaker ? market?.maker || 0.001 : market?.taker || 0.001;
      const estimatedFee = estimatedCost * feeRate;
      const totalRequired = dto.side === OrderSide.BUY ? estimatedCost + estimatedFee : estimatedCost;

      const extracted = extractMarketLimits(market, exchange.precisionMode);
      const limits = {
        ...extracted,
        maxQuantity: market?.limits?.amount?.max ?? Infinity
      };

      const balances = await exchange.fetchBalance();
      const [baseCurrency, quoteCurrency] = dto.symbol.split('/');
      const balanceCurrency = dto.side === OrderSide.BUY ? quoteCurrency : baseCurrency;
      const availableBalance = balances[balanceCurrency]?.free || 0;

      const hasSufficientBalance =
        dto.side === OrderSide.BUY ? availableBalance >= totalRequired : availableBalance >= dto.quantity;

      const warnings: string[] = [];

      if (dto.price && marketPrice > 0) {
        const deviation = Math.abs((dto.price - marketPrice) / marketPrice) * 100;
        if (deviation > 5) {
          const direction = dto.price > marketPrice ? 'above' : 'below';
          warnings.push(`Price is ${deviation.toFixed(2)}% ${direction} current market price`);
        }
      }

      if (!hasSufficientBalance) {
        const required = dto.side === OrderSide.BUY ? totalRequired : dto.quantity;
        warnings.push(
          `Insufficient ${balanceCurrency} balance. Available: ${availableBalance.toFixed(8)}, Required: ${required.toFixed(8)}`
        );
      }

      if (limits.minQuantity > 0 && dto.quantity < limits.minQuantity) {
        warnings.push(`Minimum quantity is ${limits.minQuantity} ${baseCurrency}`);
      }

      if (limits.maxQuantity < Infinity && dto.quantity > limits.maxQuantity) {
        warnings.push(`Maximum quantity is ${limits.maxQuantity} ${baseCurrency}`);
      }

      if (limits.minCost > 0 && estimatedCost < limits.minCost) {
        warnings.push(`Minimum order value is ${limits.minCost} ${quoteCurrency}`);
      }

      let estimatedSlippage: number | undefined;
      if (dto.orderType === OrderType.MARKET) {
        try {
          const orderBook = await exchange.fetchOrderBook(dto.symbol, 20);
          estimatedSlippage = this.tradingFeesService.calculateSlippage(orderBook, dto.quantity, dto.side);
          if (estimatedSlippage > 1) {
            warnings.push(`High estimated slippage: ${estimatedSlippage.toFixed(2)}%`);
          }
        } catch (error: unknown) {
          const err = toErrorInfo(error);
          this.logger.warn(`Failed to calculate slippage: ${err.message}`);
        }
      }

      const supportedOrderTypes = getSupportedOrderTypes(exchangeSlug);

      const preview: OrderPreviewDto = {
        symbol: dto.symbol,
        side: dto.side,
        orderType: dto.orderType,
        quantity: dto.quantity,
        price: dto.price,
        stopPrice: dto.stopPrice,
        trailingAmount: dto.trailingAmount,
        trailingType: dto.trailingType,
        estimatedCost,
        estimatedFee,
        feeRate,
        feeCurrency: quoteCurrency,
        costCurrency: quoteCurrency,
        totalRequired,
        marketPrice,
        availableBalance,
        balanceCurrency,
        hasSufficientBalance,
        estimatedSlippage,
        warnings,
        exchange: exchangeKey.exchange.name,
        supportedOrderTypes,
        minQuantity: limits.minQuantity > 0 ? limits.minQuantity : undefined,
        maxQuantity: limits.maxQuantity < Infinity ? limits.maxQuantity : undefined,
        minCost: limits.minCost > 0 ? limits.minCost : undefined,
        quantityStep: limits.quantityStep > 0 ? limits.quantityStep : undefined,
        priceStep: limits.priceStep > 0 ? limits.priceStep : undefined
      };

      return preview;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Manual order preview failed: ${err.message}`, err.stack);
      // Preserve NestJS HTTP exceptions (404 NotFound, 400 BadRequest from validator, etc.)
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException(`Failed to preview order: ${err.message}`);
    }
  }

  /**
   * Place a manual order on the exchange with transaction safety
   */
  async placeManualOrder(dto: PlaceManualOrderDto, user: User): Promise<Order> {
    this.logger.log(`Placing manual ${dto.side} ${dto.orderType} order for user: ${user.id}`);

    const exchangeKey = await this.exchangeKeyService.findOne(dto.exchangeKeyId, user.id);
    if (!exchangeKey || !exchangeKey.exchange) {
      throw new NotFoundException('Exchange key not found');
    }

    const exchangeSlug = exchangeKey.exchange.slug;
    const exchange = await this.exchangeManager.getExchangeClient(exchangeSlug, user);
    await exchange.loadMarkets();

    await this.manualOrderValidator.validate(dto, exchange, exchangeSlug);

    if (dto.orderType === OrderType.OCO) {
      return await this.ocoOrderService.createOcoOrder(dto, user, exchange, exchangeKey);
    }

    let ccxtOrder: ccxt.Order | null = null;

    try {
      const ccxtOrderType = mapOrderTypeToCcxt(dto.orderType);
      const params: CcxtOrderParams = {};

      if (dto.stopPrice) {
        params.stopPrice = dto.stopPrice;
      }
      if (dto.trailingAmount && dto.trailingType) {
        // NOTE: This branch is currently unreachable. No exchange routed by ExchangeManagerService
        // (binance_us, coinbase, gdax, kraken, kraken_futures) has `hasTrailingStopSupport: true`
        // in EXCHANGE_ORDER_TYPE_SUPPORT, so ManualOrderValidatorService rejects TRAILING_STOP
        // before we reach this code.
        //
        // When wiring up an exchange that supports trailing stops (binance, kucoin, okx), replace
        // this with CCXT's unified params:
        //   - PERCENTAGE → params.trailingPercent = dto.trailingAmount  (percent value, e.g. 5 = 5%)
        //   - AMOUNT     → params.trailingAmount  = dto.trailingAmount  (absolute price distance)
        // Caveat: Binance spot only supports percent trailing. Block TrailingType.AMOUNT for
        // binance in the validator (or convert to percent using current price) before enabling.
        params.trailingDelta = dto.trailingAmount;
      }
      if (dto.timeInForce) {
        params.timeInForce = dto.timeInForce;
      }

      ccxtOrder = await exchange.createOrder(
        dto.symbol,
        ccxtOrderType,
        dto.side.toLowerCase(),
        dto.quantity,
        dto.price,
        params
      );

      const [baseSymbol, quoteSymbol] = dto.symbol.split('/');
      let baseCoin: Coin | null = null;
      let quoteCoin: Coin | null = null;

      try {
        const coins = await this.coinService.getMultipleCoinsBySymbol([baseSymbol, quoteSymbol]);
        baseCoin = coins.find((c) => c.symbol.toLowerCase() === baseSymbol.toLowerCase()) || null;
        quoteCoin = coins.find((c) => c.symbol.toLowerCase() === quoteSymbol.toLowerCase()) || null;
        if (!baseCoin) this.logger.warn(`Base coin ${baseSymbol} not found`);
        if (!quoteCoin) this.logger.warn(`Quote coin ${quoteSymbol} not found`);
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.warn(`Could not find coins for order: ${err.message}`);
      }

      const order = this.orderRepository.create({
        orderId: ccxtOrder.id?.toString() || '',
        clientOrderId: ccxtOrder.clientOrderId || ccxtOrder.id?.toString() || '',
        symbol: dto.symbol,
        side: dto.side,
        type: dto.orderType,
        quantity: dto.quantity,
        price: ccxtOrder.price || dto.price || 0,
        executedQuantity: ccxtOrder.filled || 0,
        cost: ccxtOrder.cost || 0,
        fee: ccxtOrder.fee?.cost || 0,
        feeCurrency: ccxtOrder.fee?.currency,
        status: mapExchangeStatusToOrderStatus(ccxtOrder.status || 'open'),
        transactTime: new Date(ccxtOrder.timestamp || Date.now()),
        isManual: true,
        exchangeKeyId: dto.exchangeKeyId,
        stopPrice: dto.stopPrice,
        trailingAmount: dto.trailingAmount,
        trailingType: dto.trailingType,
        takeProfitPrice: dto.takeProfitPrice,
        stopLossPrice: dto.stopLossPrice,
        timeInForce: dto.timeInForce,
        user,
        baseCoin: baseCoin && !CoinService.isVirtualCoin(baseCoin) ? baseCoin : undefined,
        quoteCoin: quoteCoin && !CoinService.isVirtualCoin(quoteCoin) ? quoteCoin : undefined,
        exchange: exchangeKey.exchange,
        trades: ccxtOrder.trades,
        info: ccxtOrder.info
      });

      const savedOrder = await this.orderRepository.save(order);

      this.logger.log(`Manual order created successfully: ${savedOrder.id}`);

      // Attach exit orders if exitConfig is provided (after transaction commits)
      if (dto.exitConfig && this.positionManagementService) {
        const hasExitEnabled =
          dto.exitConfig.enableStopLoss || dto.exitConfig.enableTakeProfit || dto.exitConfig.enableTrailingStop;

        if (hasExitEnabled) {
          try {
            await this.positionManagementService.attachExitOrders(savedOrder, dto.exitConfig);
            this.logger.log(`Exit orders attached for manual order ${savedOrder.id}`);
          } catch (exitError: unknown) {
            const err = toErrorInfo(exitError);
            // Log but don't fail the order - the entry order was successful
            this.logger.warn(
              `Failed to attach exit orders for manual order ${savedOrder.id}: ${err.message}. ` +
                `Manual intervention may be required.`
            );
          }
        }
      }

      return savedOrder;
    } catch (error: unknown) {
      const err = toErrorInfo(error);

      // If we created an order on the exchange but failed to save to DB, log it for manual reconciliation
      if (ccxtOrder) {
        this.logger.error(
          `CRITICAL: Order created on exchange but failed to save to database. ` +
            `Exchange order ID: ${ccxtOrder.id}, Symbol: ${dto.symbol}, Quantity: ${dto.quantity}. ` +
            `Manual reconciliation required.`,
          err.stack
        );
      }

      this.logger.error(`Manual order placement failed: ${err.message}`, err.stack);
      throw mapCcxtError(error, exchangeKey.exchange.name);
    }
  }

  /**
   * Cancel an open manual order. For OCO orders, cancels the linked pair as well.
   */
  async cancelManualOrder(orderId: string, user: User): Promise<Order> {
    return this.cancelManualOrderInternal(orderId, user, false);
  }

  private async cancelManualOrderInternal(orderId: string, user: User, skipLinked: boolean): Promise<Order> {
    this.logger.log(`Canceling order ${orderId} for user: ${user.id}`);

    try {
      const order = await this.orderRepository.findOne({
        where: { id: orderId, user: { id: user.id } },
        relations: ['exchange', 'user']
      });

      if (!order) {
        throw new NotFoundException(`Order with ID ${orderId} not found`);
      }

      if (order.status === OrderStatus.FILLED) {
        throw new BadRequestException('Cannot cancel order with status "filled"');
      }

      if (order.status === OrderStatus.CANCELED) {
        throw new BadRequestException('Order is already canceled');
      }

      if (order.status === OrderStatus.REJECTED || order.status === OrderStatus.EXPIRED) {
        throw new BadRequestException(`Cannot cancel order with status "${order.status}"`);
      }

      if (!order.exchangeKeyId) {
        throw new BadRequestException('Order does not have an associated exchange key');
      }

      const exchangeKey = await this.exchangeKeyService.findOne(order.exchangeKeyId, user.id);
      if (!exchangeKey || !exchangeKey.exchange) {
        throw new NotFoundException('Exchange key not found');
      }

      const exchange = await this.exchangeManager.getExchangeClient(exchangeKey.exchange.slug, user);

      try {
        await exchange.cancelOrder(order.orderId, order.symbol);
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        if (err.message?.includes('filled') || err.message?.includes('closed')) {
          throw new BadRequestException('Order was filled before cancellation');
        }
        throw mapCcxtError(error, exchangeKey.exchange.name);
      }

      order.status = OrderStatus.CANCELED;
      order.updatedAt = new Date();
      const savedOrder = await this.orderRepository.save(order);

      // If OCO order, also cancel linked order — pass skipLinked=true to prevent
      // the partner from recursing back into this order.
      if (order.ocoLinkedOrderId && !skipLinked) {
        try {
          await this.cancelManualOrderInternal(order.ocoLinkedOrderId, user, true);
        } catch (error: unknown) {
          const err = toErrorInfo(error);
          this.logger.warn(`Failed to cancel linked OCO order: ${err.message}`);
        }
      }

      this.logger.log(`Order ${orderId} canceled successfully`);
      return savedOrder;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Order cancellation failed: ${err.message}`, err.stack);
      throw error;
    }
  }
}
