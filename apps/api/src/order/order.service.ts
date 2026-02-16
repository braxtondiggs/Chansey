import { BadRequestException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import * as ccxt from 'ccxt';
import { DataSource, FindManyOptions, In, Repository } from 'typeorm';

import {
  getExchangeOrderTypeSupport,
  getSupportedOrderTypes,
  isOrderTypeSupported,
  UserHoldingsDto
} from '@chansey/api-interfaces';

import { ExchangeService } from '@chansey-api/exchange/exchange.service';

import { OrderPreviewRequestDto } from './dto/order-preview-request.dto';
import { OrderPreviewDto } from './dto/order-preview.dto';
import { OrderDto } from './dto/order.dto';
import { PlaceManualOrderDto } from './dto/place-manual-order.dto';
import { Order, OrderSide, OrderStatus, OrderType, TrailingType } from './order.entity';
import { OrderCalculationService } from './services/order-calculation.service';
import { OrderValidationService } from './services/order-validation.service';
import { PositionManagementService } from './services/position-management.service';

import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import { ExchangeKey } from '../exchange/exchange-key/exchange-key.entity';
import { ExchangeKeyService } from '../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { Exchange } from '../exchange/exchange.entity';
import { toErrorInfo } from '../shared/error.util';
import { User } from '../users/users.entity';

/** CCXT order creation parameters */
interface CcxtOrderParams {
  stopPrice?: number;
  trailingDelta?: number;
  timeInForce?: string;
  [key: string]: unknown;
}

export interface OrderFilters {
  status?: OrderStatus | string;
  side?: OrderSide | string;
  orderType?: OrderType | string;
  isManual?: boolean;
  limit?: number;
}

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    @InjectRepository(Order) private readonly orderRepository: Repository<Order>,
    private readonly dataSource: DataSource,
    private readonly exchangeService: ExchangeService,
    private readonly exchangeManager: ExchangeManagerService,
    private readonly exchangeKeyService: ExchangeKeyService,
    private readonly coinService: CoinService,
    private readonly orderValidationService: OrderValidationService,
    private readonly orderCalculationService: OrderCalculationService,
    @Inject(forwardRef(() => PositionManagementService))
    private readonly positionManagementService: PositionManagementService
  ) {}

  /**
   * Create a new order (buy or sell) - Legacy method for coin-id based orders
   * @deprecated Use placeManualOrder instead for better exchange integration
   */
  async createOrder(orderDto: OrderDto, user: User): Promise<Order> {
    this.logger.log(`Creating ${orderDto.side} order for user: ${user.id} on exchange: ${orderDto.exchangeId}`);

    try {
      // 1. Validate and get coins
      const { baseCoin, quoteCoin } = await this.validateAndGetCoins(orderDto);

      // 2. Get exchange client
      const { slug: exchangeSlug } = await this.exchangeService.getExchangeById(orderDto.exchangeId);
      const exchange = await this.exchangeManager.getExchangeClient(exchangeSlug, user);

      // 3. Build and format trading symbol using the exchange manager's formatSymbol method
      const rawSymbol = `${baseCoin.symbol.toUpperCase()}${quoteCoin.symbol.toUpperCase()}`;
      const symbol = this.exchangeManager.formatSymbol(exchangeSlug, rawSymbol);

      this.logger.debug(`Formatted symbol for ${exchangeSlug}: ${rawSymbol} -> ${symbol}`);

      // 4. Validate order with exchange
      await this.orderValidationService.validateOrder(orderDto, symbol, exchange);

      // 5. Create order on exchange
      const exchangeOrder = await this.executeOrderOnExchange(exchange, symbol, orderDto);

      // 6. Save order to database with exchange reference
      const exchangeEntity = await this.exchangeService.getExchangeById(orderDto.exchangeId);
      const savedOrder = await this.saveOrderToDatabase(
        exchangeOrder,
        orderDto,
        baseCoin,
        quoteCoin,
        user,
        exchangeEntity
      );

      this.logger.log(`Order created successfully: ${savedOrder.id}`);
      return savedOrder;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Order creation failed: ${err.message}`, err.stack);
      throw new BadRequestException(`Failed to create order: ${err.message}`);
    }
  }

  /**
   * Preview an order to calculate fees and validate without executing
   */
  async previewOrder(orderDto: OrderDto, user: User): Promise<OrderPreviewDto> {
    this.logger.log(`Previewing ${orderDto.side} order for user: ${user.id} on exchange: ${orderDto.exchangeId}`);

    try {
      // 1. Validate and get coins
      const { baseCoin, quoteCoin } = await this.validateAndGetCoins(orderDto);

      // 2. Get exchange client
      const { slug: exchangeSlug } = await this.exchangeService.getExchangeById(orderDto.exchangeId);
      const exchange = await this.exchangeManager.getExchangeClient(exchangeSlug, user);

      // 3. Build and format trading symbol using the exchange manager's formatSymbol method
      const rawSymbol = `${baseCoin.symbol.toUpperCase()}${quoteCoin.symbol.toUpperCase()}`;
      const symbol = this.exchangeManager.formatSymbol(exchangeSlug, rawSymbol);

      // 4. Get current market data
      const ticker = await exchange.fetchTicker(symbol);
      const marketPrice = ticker.last || ticker.close || 0;

      // 5. Calculate order details
      const quantity = parseFloat(orderDto.quantity);
      let price = marketPrice;

      if (orderDto.type === OrderType.LIMIT && orderDto.price) {
        price = parseFloat(orderDto.price);
      }

      const orderValue = quantity * price;

      // 6. Get trading fees with proper maker/taker determination
      const { feeRate, feeAmount } = await this.getTradingFees(exchange, exchangeSlug, orderDto.type, orderValue);

      // 7. Get user balance
      const balances = await exchange.fetchBalance();
      const balanceCurrency = orderDto.side === OrderSide.BUY ? quoteCoin.symbol : baseCoin.symbol;
      const availableBalance = balances[balanceCurrency]?.free || 0;

      // 8. Calculate total cost or net amount
      let totalRequired: number;
      let hasSufficientBalance = false;

      if (orderDto.side === OrderSide.BUY) {
        totalRequired = orderValue + feeAmount;
        hasSufficientBalance = availableBalance >= totalRequired;
      } else {
        totalRequired = orderValue;
        hasSufficientBalance = availableBalance >= quantity;
      }

      // 9. Estimate slippage for market orders
      let estimatedSlippage: number | undefined;
      if (orderDto.type === OrderType.MARKET) {
        const orderBook = await exchange.fetchOrderBook(symbol, 20);
        estimatedSlippage = this.calculateSlippage(orderBook, quantity, orderDto.side);
      }

      // 10. Get supported order types
      const supportedOrderTypes = this.getSupportedOrderTypesForExchange(exchangeSlug);

      // 11. Build warnings
      const warnings: string[] = [];
      if (!hasSufficientBalance) {
        warnings.push(
          `Insufficient ${balanceCurrency} balance. Available: ${availableBalance.toFixed(8)}, Required: ${totalRequired.toFixed(8)}`
        );
      }

      const preview: OrderPreviewDto = {
        symbol,
        side: orderDto.side,
        orderType: orderDto.type,
        quantity,
        price,
        estimatedCost: orderValue,
        estimatedFee: feeAmount,
        feeRate,
        feeCurrency: balanceCurrency,
        totalRequired,
        marketPrice,
        availableBalance,
        balanceCurrency,
        hasSufficientBalance,
        estimatedSlippage,
        warnings,
        exchange: exchangeSlug,
        supportedOrderTypes
      };

      this.logger.log(`Order preview calculated for user: ${user.id}`);
      return preview;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Order preview failed: ${err.message}`, err.stack);
      throw new BadRequestException(`Failed to preview order: ${err.message}`);
    }
  }

  /**
   * Get orders for a user with optional filtering
   */
  async getOrders(user: User, filters: OrderFilters = {}): Promise<Order[]> {
    const queryOptions: FindManyOptions<Order> = {
      where: { user: { id: user.id } },
      relations: ['baseCoin', 'quoteCoin', 'exchange', 'algorithmActivation'],
      order: { createdAt: 'DESC' }
    };

    // Apply filters - handle comma-separated values
    if (filters.status) {
      const statusValues =
        typeof filters.status === 'string'
          ? filters.status.split(',').map((s) => s.trim() as OrderStatus)
          : [filters.status];
      queryOptions.where = {
        ...queryOptions.where,
        status: statusValues.length > 1 ? In(statusValues) : statusValues[0]
      };
    }
    if (filters.side) {
      const sideValues =
        typeof filters.side === 'string' ? filters.side.split(',').map((s) => s.trim() as OrderSide) : [filters.side];
      queryOptions.where = {
        ...queryOptions.where,
        side: sideValues.length > 1 ? In(sideValues) : sideValues[0]
      };
    }
    if (filters.orderType) {
      const typeValues =
        typeof filters.orderType === 'string'
          ? filters.orderType.split(',').map((t) => t.trim() as OrderType)
          : [filters.orderType];
      queryOptions.where = {
        ...queryOptions.where,
        type: typeValues.length > 1 ? In(typeValues) : typeValues[0]
      };
    }
    if (filters.isManual !== undefined) {
      queryOptions.where = { ...queryOptions.where, isManual: filters.isManual };
    }
    if (filters.limit) {
      queryOptions.take = filters.limit;
    }

    return this.orderRepository.find(queryOptions);
  }

  /**
   * Get a specific order by ID
   */
  async getOrder(user: User, orderId: string): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId, user: { id: user.id } },
      relations: ['baseCoin', 'quoteCoin', 'exchange']
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${orderId} not found`);
    }

    return order;
  }

  /**
   * Validate coins and return them
   */
  private async validateAndGetCoins(orderDto: OrderDto) {
    const baseCoin = await this.coinService.getCoinById(orderDto.baseCoinId);
    if (!baseCoin) {
      throw new BadRequestException(`Invalid base coin ID: ${orderDto.baseCoinId}`);
    }

    let quoteCoin;
    if (orderDto.quoteCoinId) {
      quoteCoin = await this.coinService.getCoinById(orderDto.quoteCoinId);
      if (!quoteCoin) {
        throw new BadRequestException(`Invalid quote coin ID: ${orderDto.quoteCoinId}`);
      }
    } else {
      // Default to USDT
      quoteCoin = await this.coinService.getCoinBySymbol('USDT');
      if (!quoteCoin) {
        throw new BadRequestException('USDT not found in system');
      }
    }

    return { baseCoin, quoteCoin };
  }

  /**
   * Execute order on exchange
   */
  private async executeOrderOnExchange(exchange: ccxt.Exchange, symbol: string, orderDto: OrderDto) {
    const orderType = orderDto.type.toLowerCase();
    const side = orderDto.side.toLowerCase();
    const quantity = parseFloat(orderDto.quantity);
    const price = orderDto.price ? parseFloat(orderDto.price) : undefined;

    try {
      return await exchange.createOrder(symbol, orderType, side, quantity, price);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Exchange order failed: ${err.message}`);
      throw new BadRequestException(`Exchange error: ${err.message}`);
    }
  }

  /**
   * Save order to database with exchange reference
   */
  private async saveOrderToDatabase(
    exchangeOrder: ccxt.Order,
    orderDto: OrderDto,
    baseCoin: Coin,
    quoteCoin: Coin,
    user: User,
    exchangeEntity?: Exchange
  ): Promise<Order> {
    const order = this.orderRepository.create({
      orderId: exchangeOrder.id?.toString(),
      clientOrderId: String(exchangeOrder.clientOrderId || exchangeOrder.id || ''),
      symbol: String(exchangeOrder.symbol ?? ''),
      side: orderDto.side,
      type: orderDto.type,
      quantity: parseFloat(orderDto.quantity),
      price: Number(exchangeOrder.price ?? 0) || (orderDto.price ? parseFloat(orderDto.price) : 0),
      executedQuantity: Number(exchangeOrder.filled ?? 0),
      cost: Number(exchangeOrder.cost ?? 0),
      fee: Number(exchangeOrder.fee?.cost ?? 0),
      feeCurrency: exchangeOrder.fee?.currency?.toString(),
      status: this.mapExchangeStatusToOrderStatus(exchangeOrder.status ?? 'open'),
      transactTime: new Date(Number(exchangeOrder.timestamp ?? Date.now())),
      baseCoin,
      quoteCoin,
      user,
      exchange: exchangeEntity,
      trades: exchangeOrder.trades,
      info: exchangeOrder.info
    });

    return this.orderRepository.save(order);
  }

  /**
   * Map exchange status to our OrderStatus enum
   */
  private mapExchangeStatusToOrderStatus(exchangeStatus: string): OrderStatus {
    const statusMap: Record<string, OrderStatus> = {
      open: OrderStatus.NEW,
      closed: OrderStatus.FILLED,
      canceled: OrderStatus.CANCELED,
      cancelled: OrderStatus.CANCELED,
      expired: OrderStatus.EXPIRED,
      rejected: OrderStatus.REJECTED,
      partial: OrderStatus.PARTIALLY_FILLED,
      partially_filled: OrderStatus.PARTIALLY_FILLED
    };

    return statusMap[exchangeStatus?.toLowerCase()] || OrderStatus.NEW;
  }

  /**
   * Get trading fees with proper maker/taker determination
   * Maker/Taker is determined by order type, NOT by side (buy/sell)
   * - LIMIT orders that add liquidity (not immediately matched) are maker orders
   * - MARKET orders always take liquidity, so they're taker orders
   * - STOP and other advanced orders typically execute as market orders (taker)
   */
  private async getTradingFees(
    exchange: ccxt.Exchange,
    exchangeSlug: string,
    orderType: OrderType,
    orderValue: number
  ): Promise<{ feeRate: number; feeAmount: number }> {
    // Determine if this is a maker or taker order
    // LIMIT orders add liquidity (maker), all others typically take liquidity (taker)
    const isMaker = orderType === OrderType.LIMIT;

    try {
      // Try to get trading fees from exchange API
      const tradingFees = await exchange.fetchTradingFees();
      this.logger.debug(`Trading fees from API for ${exchangeSlug}:`, tradingFees);

      // CCXT types fetchTradingFees() as Dictionary<TradingFeeInterface>,
      // but many exchanges return global maker/taker as plain numbers
      const fees = tradingFees as Record<string, unknown>;
      const rawRate = isMaker ? fees.maker : fees.taker;
      const feeRate = typeof rawRate === 'number' ? rawRate : 0.001;
      const feeAmount = orderValue * feeRate;

      return { feeRate, feeAmount };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to fetch trading fees from API for ${exchangeSlug}: ${err.message}`);

      // Fallback 1: Try to get fees from exchange.markets (pre-loaded market data)
      try {
        if (exchange.markets && Object.keys(exchange.markets).length > 0) {
          // Get fee from any market as they're usually consistent across the exchange
          const firstMarket = Object.values(exchange.markets)[0];
          const feeRate = isMaker ? firstMarket.maker || 0.001 : firstMarket.taker || 0.001;
          const feeAmount = orderValue * feeRate;

          this.logger.debug(`Using market fees for ${exchangeSlug}: ${feeRate} (${isMaker ? 'maker' : 'taker'})`);
          return { feeRate, feeAmount };
        }
      } catch (marketError: unknown) {
        const err = toErrorInfo(marketError);
        this.logger.warn(`Failed to get fees from markets for ${exchangeSlug}: ${err.message}`);
      }

      // Fallback 2: Use exchange-specific default fees
      const defaultFees = this.getDefaultFees(exchangeSlug);
      const feeRate = isMaker ? defaultFees.maker : defaultFees.taker;
      const feeAmount = orderValue * feeRate;

      this.logger.debug(`Using default fees for ${exchangeSlug}: ${feeRate} (${isMaker ? 'maker' : 'taker'})`);
      return { feeRate, feeAmount };
    }
  }

  /**
   * Get default fees for exchanges when API is unavailable
   */
  private getDefaultFees(exchangeSlug: string): { maker: number; taker: number } {
    const defaultFees: Record<string, { maker: number; taker: number }> = {
      binanceus: { maker: 0.001, taker: 0.001 }, // 0.1%
      binance: { maker: 0.001, taker: 0.001 }, // 0.1%
      coinbase: { maker: 0.004, taker: 0.006 }, // 0.4%/0.6%
      coinbasepro: { maker: 0.004, taker: 0.006 }, // 0.4%/0.6%
      coinbaseexchange: { maker: 0.004, taker: 0.006 }, // 0.4%/0.6%
      kraken: { maker: 0.0016, taker: 0.0026 }, // 0.16%/0.26%
      kucoin: { maker: 0.001, taker: 0.001 }, // 0.1%
      okx: { maker: 0.0008, taker: 0.001 } // 0.08%/0.1%
    };

    return defaultFees[exchangeSlug] || { maker: 0.001, taker: 0.001 }; // Default 0.1%
  }

  /**
   * Calculate estimated slippage for market orders
   */
  private calculateSlippage(orderBook: ccxt.OrderBook, quantity: number, side: OrderSide): number {
    try {
      const orders = side === OrderSide.BUY ? orderBook.asks : orderBook.bids;
      if (!orders || orders.length === 0) return 0;

      let remainingQuantity = quantity;
      let totalCost = 0;

      // Calculate weighted average price by consuming order book
      for (const entry of orders) {
        if (remainingQuantity <= 0) break;

        const price = Number(entry[0] ?? 0);
        const availableQuantity = Number(entry[1] ?? 0);
        const quantityToTake = Math.min(remainingQuantity, availableQuantity);
        totalCost += quantityToTake * price;
        remainingQuantity -= quantityToTake;
      }

      if (quantity > 0) {
        const weightedAveragePrice = totalCost / quantity;
        const marketPrice = Number(orders[0][0] ?? 0); // Best bid/ask price
        if (marketPrice === 0) return 0;
        const slippage = Math.abs((weightedAveragePrice - marketPrice) / marketPrice) * 100;
        return Math.round(slippage * 100) / 100; // Round to 2 decimal places
      }

      return 0;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to calculate slippage: ${err.message}`);
      return 0;
    }
  }

  /**
   * Get supported order types for an exchange
   * Delegates to shared utility from api-interfaces
   */
  getSupportedOrderTypesForExchange(exchangeSlug: string): OrderType[] {
    return getSupportedOrderTypes(exchangeSlug);
  }

  /**
   * Check if an exchange supports a specific order type
   * Delegates to shared utility from api-interfaces
   */
  isOrderTypeSupportedByExchange(exchangeSlug: string, orderType: OrderType): boolean {
    return isOrderTypeSupported(exchangeSlug, orderType);
  }

  /**
   * Preview a manual order to calculate costs and validate
   * @param dto Order preview request data
   * @param user Authenticated user
   * @returns OrderPreviewDto with cost estimates and warnings
   */
  async previewManualOrder(dto: OrderPreviewRequestDto, user: User): Promise<OrderPreviewDto> {
    this.logger.log(`Previewing manual ${dto.side} ${dto.orderType} order for user: ${user.id}`);

    try {
      // Get exchange key and client
      const exchangeKey = await this.exchangeKeyService.findOne(dto.exchangeKeyId, user.id);
      if (!exchangeKey || !exchangeKey.exchange) {
        throw new NotFoundException('Exchange key not found');
      }

      const exchangeSlug = exchangeKey.exchange.slug;
      const exchange = await this.exchangeManager.getExchangeClient(exchangeSlug, user);
      await exchange.loadMarkets();

      // Validate order type is supported
      if (!this.isOrderTypeSupportedByExchange(exchangeSlug, dto.orderType)) {
        throw new BadRequestException(
          `Order type "${dto.orderType}" is not supported on ${exchangeKey.exchange.name}. ` +
            `Supported types: ${this.getSupportedOrderTypesForExchange(exchangeSlug).join(', ')}`
        );
      }

      // Get market data
      const ticker = await exchange.fetchTicker(dto.symbol);
      const marketPrice = ticker.last || ticker.close || 0;

      // Determine execution price based on order type
      let executionPrice = marketPrice;
      if (dto.orderType === OrderType.LIMIT && dto.price) {
        executionPrice = dto.price;
      } else if (dto.orderType === OrderType.STOP_LIMIT && dto.price) {
        executionPrice = dto.price;
      }

      // Calculate estimated cost
      const estimatedCost = dto.quantity * executionPrice;

      // Get trading fees with proper maker/taker determination
      const market = exchange.markets[dto.symbol];
      const isMaker = dto.orderType === OrderType.LIMIT;
      const feeRate = isMaker ? market?.maker || 0.001 : market?.taker || 0.001;
      const estimatedFee = estimatedCost * feeRate;
      const totalRequired = dto.side === OrderSide.BUY ? estimatedCost + estimatedFee : estimatedCost;

      // Get user balance
      const balances = await exchange.fetchBalance();
      const [baseCurrency, quoteCurrency] = dto.symbol.split('/');
      const balanceCurrency = dto.side === OrderSide.BUY ? quoteCurrency : baseCurrency;
      const availableBalance = balances[balanceCurrency]?.free || 0;

      // Check sufficient balance
      const hasSufficientBalance =
        dto.side === OrderSide.BUY ? availableBalance >= totalRequired : availableBalance >= dto.quantity;

      // Generate warnings
      const warnings: string[] = [];

      // Price deviation warning
      if (dto.price && marketPrice > 0) {
        const deviation = Math.abs((dto.price - marketPrice) / marketPrice) * 100;
        if (deviation > 5) {
          const direction = dto.price > marketPrice ? 'above' : 'below';
          warnings.push(`Price is ${deviation.toFixed(2)}% ${direction} current market price`);
        }
      }

      // Insufficient balance warning
      if (!hasSufficientBalance) {
        const required = dto.side === OrderSide.BUY ? totalRequired : dto.quantity;
        warnings.push(
          `Insufficient ${balanceCurrency} balance. Available: ${availableBalance.toFixed(8)}, Required: ${required.toFixed(8)}`
        );
      }

      // Calculate slippage for market orders
      let estimatedSlippage: number | undefined;
      if (dto.orderType === OrderType.MARKET) {
        try {
          const orderBook = await exchange.fetchOrderBook(dto.symbol, 20);
          estimatedSlippage = this.calculateSlippage(orderBook, dto.quantity, dto.side);
          if (estimatedSlippage > 1) {
            warnings.push(`High estimated slippage: ${estimatedSlippage.toFixed(2)}%`);
          }
        } catch (error: unknown) {
          const err = toErrorInfo(error);
          this.logger.warn(`Failed to calculate slippage: ${err.message}`);
        }
      }

      // Get supported order types for this exchange
      const supportedOrderTypes = this.getSupportedOrderTypesForExchange(exchangeSlug);

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
        totalRequired,
        marketPrice,
        availableBalance,
        balanceCurrency,
        hasSufficientBalance,
        estimatedSlippage,
        warnings,
        exchange: exchangeKey.exchange.name,
        supportedOrderTypes
      };

      return preview;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Manual order preview failed: ${err.message}`, err.stack);
      throw new BadRequestException(`Failed to preview order: ${err.message}`);
    }
  }

  /**
   * Validate manual order parameters and requirements
   * @param dto Order placement data
   * @param user Authenticated user
   * @param exchange CCXT exchange instance
   * @param exchangeSlug Exchange slug for order type validation
   * @throws BadRequestException for validation failures
   */
  private async validateManualOrder(
    dto: PlaceManualOrderDto,
    _user: User,
    exchange: ccxt.Exchange,
    exchangeSlug: string
  ): Promise<void> {
    // Validate order type is supported by this exchange
    if (!this.isOrderTypeSupportedByExchange(exchangeSlug, dto.orderType)) {
      const supportedTypes = this.getSupportedOrderTypesForExchange(exchangeSlug);
      throw new BadRequestException(
        `Order type "${dto.orderType}" is not supported on this exchange. Supported types: ${supportedTypes.join(', ')}`
      );
    }

    // Validate trading pair exists on exchange
    if (!exchange.markets || !exchange.markets[dto.symbol]) {
      throw new BadRequestException(`Trading pair ${dto.symbol} is not available on this exchange`);
    }

    const market = exchange.markets[dto.symbol];

    // Validate order size limits
    if (market.limits?.amount) {
      if (market.limits.amount.min && dto.quantity < market.limits.amount.min) {
        throw new BadRequestException(
          `Order quantity ${dto.quantity} is below minimum ${market.limits.amount.min} for ${dto.symbol}`
        );
      }
      if (market.limits.amount.max && dto.quantity > market.limits.amount.max) {
        throw new BadRequestException(
          `Order quantity ${dto.quantity} exceeds maximum ${market.limits.amount.max} for ${dto.symbol}`
        );
      }
    }

    // Validate price for limit orders
    if ((dto.orderType === OrderType.LIMIT || dto.orderType === OrderType.STOP_LIMIT) && !dto.price) {
      throw new BadRequestException(`Price is required for ${dto.orderType} orders`);
    }

    // Validate stop price for stop orders
    if ((dto.orderType === OrderType.STOP_LOSS || dto.orderType === OrderType.STOP_LIMIT) && !dto.stopPrice) {
      throw new BadRequestException(`Stop price is required for ${dto.orderType} orders`);
    }

    // Validate trailing stop parameters
    if (dto.orderType === OrderType.TRAILING_STOP) {
      const support = getExchangeOrderTypeSupport(exchangeSlug);
      if (!support.hasTrailingStopSupport) {
        throw new BadRequestException(`Trailing stop orders are not supported on this exchange`);
      }
      if (!dto.trailingAmount) {
        throw new BadRequestException('Trailing amount is required for trailing stop orders');
      }
      if (!dto.trailingType) {
        throw new BadRequestException('Trailing type is required for trailing stop orders');
      }
    }

    // Validate OCO parameters
    if (dto.orderType === OrderType.OCO) {
      const support = getExchangeOrderTypeSupport(exchangeSlug);
      if (!support.hasOcoSupport) {
        throw new BadRequestException(`OCO orders are not supported on this exchange`);
      }
      if (!dto.takeProfitPrice) {
        throw new BadRequestException('Take profit price is required for OCO orders');
      }
      if (!dto.stopLossPrice) {
        throw new BadRequestException('Stop loss price is required for OCO orders');
      }
    }

    // Check user balance (including fees for buy orders)
    const balances = await exchange.fetchBalance();
    const [baseCurrency, quoteCurrency] = dto.symbol.split('/');

    if (dto.side === OrderSide.BUY) {
      const availableQuote = balances[quoteCurrency]?.free || 0;
      const ticker = await exchange.fetchTicker(dto.symbol);
      const price = dto.price || ticker.last || ticker.close || 0;
      const cost = dto.quantity * price;

      // Use proper fee determination (taker for market, maker for limit)
      const isMaker = dto.orderType === OrderType.LIMIT;
      const feeRate = isMaker ? market?.maker || 0.001 : market?.taker || 0.001;
      const totalRequired = cost * (1 + feeRate);

      if (availableQuote < totalRequired) {
        throw new BadRequestException(
          `Insufficient ${quoteCurrency} balance. Available: ${availableQuote.toFixed(8)}, Required: ${totalRequired.toFixed(8)} (including ${(feeRate * 100).toFixed(2)}% fee)`
        );
      }
    } else {
      const availableBase = balances[baseCurrency]?.free || 0;
      if (availableBase < dto.quantity) {
        throw new BadRequestException(
          `Insufficient ${baseCurrency} balance. Available: ${availableBase.toFixed(8)}, Required: ${dto.quantity.toFixed(8)}`
        );
      }
    }
  }

  /**
   * Place a manual order on the exchange with transaction safety
   * @param dto Order placement data
   * @param user Authenticated user
   * @returns Created order entity
   */
  async placeManualOrder(dto: PlaceManualOrderDto, user: User): Promise<Order> {
    this.logger.log(`Placing manual ${dto.side} ${dto.orderType} order for user: ${user.id}`);

    // Get exchange key and client first (outside transaction)
    const exchangeKey = await this.exchangeKeyService.findOne(dto.exchangeKeyId, user.id);
    if (!exchangeKey || !exchangeKey.exchange) {
      throw new NotFoundException('Exchange key not found');
    }

    const exchangeSlug = exchangeKey.exchange.slug;
    const exchange = await this.exchangeManager.getExchangeClient(exchangeSlug, user);
    await exchange.loadMarkets();

    // Validate order before starting transaction
    await this.validateManualOrder(dto, user, exchange, exchangeSlug);

    // Handle OCO orders separately (they need special transaction handling)
    if (dto.orderType === OrderType.OCO) {
      return await this.createOcoOrderWithTransaction(dto, user, exchange, exchangeKey);
    }

    // Start database transaction for order creation
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let ccxtOrder: ccxt.Order | null = null;

    try {
      // Map order type to CCXT params
      const ccxtOrderType = this.mapOrderTypeToCcxt(dto.orderType);
      const params: CcxtOrderParams = {};

      // Add order-type-specific parameters
      if (dto.stopPrice) {
        params.stopPrice = dto.stopPrice;
      }
      if (dto.trailingAmount && dto.trailingType) {
        params.trailingDelta = dto.trailingType === TrailingType.PERCENTAGE ? dto.trailingAmount : dto.trailingAmount;
      }
      if (dto.timeInForce) {
        params.timeInForce = dto.timeInForce;
      }

      // Create order on exchange
      ccxtOrder = await exchange.createOrder(
        dto.symbol,
        ccxtOrderType,
        dto.side.toLowerCase(),
        dto.quantity,
        dto.price,
        params
      );

      // Parse symbol to get base and quote - batch fetch in single query
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

      // Create order entity
      const order = queryRunner.manager.create(Order, {
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
        status: this.mapExchangeStatusToOrderStatus(ccxtOrder.status || 'open'),
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
        baseCoin: baseCoin || undefined,
        quoteCoin: quoteCoin || undefined,
        exchange: exchangeKey.exchange,
        trades: ccxtOrder.trades,
        info: ccxtOrder.info
      });

      const savedOrder = await queryRunner.manager.save(order);

      // Commit transaction
      await queryRunner.commitTransaction();

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
      // Rollback transaction
      await queryRunner.rollbackTransaction();

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
      throw new BadRequestException(`Failed to place order: ${err.message}`);
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Create OCO (One-Cancels-Other) order pair with transaction safety
   * @param dto Order placement data
   * @param user Authenticated user
   * @param exchange CCXT exchange instance
   * @param exchangeKey Exchange key entity
   * @returns Created take-profit order (linked to stop-loss)
   */
  private async createOcoOrderWithTransaction(
    dto: PlaceManualOrderDto,
    user: User,
    exchange: ccxt.Exchange,
    exchangeKey: ExchangeKey
  ): Promise<Order> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let takeProfitExchangeOrder: ccxt.Order | null = null;
    let stopLossExchangeOrder: ccxt.Order | null = null;

    try {
      // Create take-profit order on exchange
      takeProfitExchangeOrder = await exchange.createOrder(
        dto.symbol,
        'limit',
        dto.side.toLowerCase(),
        dto.quantity,
        dto.takeProfitPrice
      );

      // Create stop-loss order on exchange
      try {
        stopLossExchangeOrder = await exchange.createOrder(
          dto.symbol,
          'stop_loss',
          dto.side.toLowerCase(),
          dto.quantity,
          undefined,
          { stopPrice: dto.stopLossPrice }
        );
      } catch (stopLossError: unknown) {
        const err = toErrorInfo(stopLossError);
        // If stop-loss fails, cancel the take-profit order
        this.logger.warn(`Stop-loss order failed, canceling take-profit order: ${err.message}`);
        try {
          await exchange.cancelOrder(takeProfitExchangeOrder.id, dto.symbol);
        } catch (cancelError: unknown) {
          const cancelErr = toErrorInfo(cancelError);
          this.logger.error(`Failed to cancel take-profit order after stop-loss failure: ${cancelErr.message}`);
        }
        throw stopLossError;
      }

      // Save both orders to database - batch fetch coins in single query
      const [baseSymbol, quoteSymbol] = dto.symbol.split('/');
      let baseCoin: Coin | null = null;
      let quoteCoin: Coin | null = null;

      try {
        const coins = await this.coinService.getMultipleCoinsBySymbol([baseSymbol, quoteSymbol]);
        baseCoin = coins.find((c) => c.symbol.toLowerCase() === baseSymbol.toLowerCase()) || null;
        quoteCoin = coins.find((c) => c.symbol.toLowerCase() === quoteSymbol.toLowerCase()) || null;
      } catch {
        this.logger.warn('Could not find coins for OCO order');
      }

      // Create take-profit order entity
      const tpOrder = queryRunner.manager.create(Order, {
        orderId: takeProfitExchangeOrder.id?.toString() || '',
        clientOrderId: takeProfitExchangeOrder.clientOrderId || takeProfitExchangeOrder.id?.toString() || '',
        symbol: dto.symbol,
        side: dto.side,
        type: OrderType.TAKE_PROFIT,
        quantity: dto.quantity,
        price: dto.takeProfitPrice || 0,
        executedQuantity: 0,
        status: OrderStatus.NEW,
        transactTime: new Date(),
        isManual: true,
        exchangeKeyId: dto.exchangeKeyId,
        takeProfitPrice: dto.takeProfitPrice,
        user,
        baseCoin: baseCoin || undefined,
        quoteCoin: quoteCoin || undefined,
        exchange: exchangeKey.exchange,
        info: takeProfitExchangeOrder.info
      });

      const savedTpOrder = await queryRunner.manager.save(tpOrder);

      // Create stop-loss order entity linked to take-profit
      const slOrder = queryRunner.manager.create(Order, {
        orderId: stopLossExchangeOrder.id?.toString() || '',
        clientOrderId: stopLossExchangeOrder.clientOrderId || stopLossExchangeOrder.id?.toString() || '',
        symbol: dto.symbol,
        side: dto.side,
        type: OrderType.STOP_LOSS,
        quantity: dto.quantity,
        price: 0,
        executedQuantity: 0,
        status: OrderStatus.NEW,
        transactTime: new Date(),
        isManual: true,
        exchangeKeyId: dto.exchangeKeyId,
        stopPrice: dto.stopLossPrice,
        stopLossPrice: dto.stopLossPrice,
        ocoLinkedOrderId: savedTpOrder.id,
        user,
        baseCoin: baseCoin || undefined,
        quoteCoin: quoteCoin || undefined,
        exchange: exchangeKey.exchange,
        info: stopLossExchangeOrder.info
      });

      const savedSlOrder = await queryRunner.manager.save(slOrder);

      // Update take-profit order with link to stop-loss
      savedTpOrder.ocoLinkedOrderId = savedSlOrder.id;
      await queryRunner.manager.save(savedTpOrder);

      // Commit transaction
      await queryRunner.commitTransaction();

      this.logger.log(`OCO order pair created: TP=${savedTpOrder.id}, SL=${savedSlOrder.id}`);
      return savedTpOrder;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      // Rollback transaction
      await queryRunner.rollbackTransaction();

      // Log orphaned exchange orders for manual reconciliation
      if (takeProfitExchangeOrder || stopLossExchangeOrder) {
        this.logger.error(
          `CRITICAL: OCO orders may exist on exchange but failed to save to database. ` +
            `TP Order ID: ${takeProfitExchangeOrder?.id || 'N/A'}, SL Order ID: ${stopLossExchangeOrder?.id || 'N/A'}. ` +
            `Manual reconciliation required.`,
          err.stack
        );
      }

      this.logger.error(`OCO order creation failed: ${err.message}`, err.stack);
      throw new BadRequestException(`Failed to create OCO order: ${err.message}`);
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Cancel an open order
   * @param orderId Order ID to cancel
   * @param user Authenticated user
   * @returns Updated order entity
   */
  async cancelManualOrder(orderId: string, user: User): Promise<Order> {
    this.logger.log(`Canceling order ${orderId} for user: ${user.id}`);

    try {
      // Fetch order with ownership check
      const order = await this.orderRepository.findOne({
        where: { id: orderId, user: { id: user.id } },
        relations: ['exchange', 'user']
      });

      if (!order) {
        throw new NotFoundException(`Order with ID ${orderId} not found`);
      }

      // Validate order can be canceled
      if (order.status === OrderStatus.FILLED) {
        throw new BadRequestException('Cannot cancel order with status "filled"');
      }

      if (order.status === OrderStatus.CANCELED) {
        throw new BadRequestException('Order is already canceled');
      }

      if (order.status === OrderStatus.REJECTED || order.status === OrderStatus.EXPIRED) {
        throw new BadRequestException(`Cannot cancel order with status "${order.status}"`);
      }

      // Get exchange client
      if (!order.exchangeKeyId) {
        throw new BadRequestException('Order does not have an associated exchange key');
      }

      const exchangeKey = await this.exchangeKeyService.findOne(order.exchangeKeyId, user.id);
      if (!exchangeKey || !exchangeKey.exchange) {
        throw new NotFoundException('Exchange key not found');
      }

      const exchange = await this.exchangeManager.getExchangeClient(exchangeKey.exchange.slug, user);

      // Cancel order on exchange
      try {
        await exchange.cancelOrder(order.orderId, order.symbol);
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        // Check if order was already filled on exchange
        if (err.message?.includes('filled') || err.message?.includes('closed')) {
          throw new BadRequestException('Order was filled before cancellation');
        }
        throw new BadRequestException(`Exchange cancellation failed: ${err.message}`);
      }

      // Update order status
      order.status = OrderStatus.CANCELED;
      order.updatedAt = new Date();
      const savedOrder = await this.orderRepository.save(order);

      // If OCO order, also cancel linked order
      if (order.ocoLinkedOrderId) {
        try {
          await this.cancelManualOrder(order.ocoLinkedOrderId, user);
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

  /**
   * Map our OrderType enum to CCXT order type strings
   * @param orderType Our internal order type
   * @returns CCXT-compatible order type string
   */
  private mapOrderTypeToCcxt(orderType: OrderType): string {
    const typeMap: Record<OrderType, string> = {
      [OrderType.MARKET]: 'market',
      [OrderType.LIMIT]: 'limit',
      [OrderType.STOP_LOSS]: 'stop_loss',
      [OrderType.STOP_LIMIT]: 'stop_limit',
      [OrderType.TRAILING_STOP]: 'trailing_stop_market',
      [OrderType.TAKE_PROFIT]: 'take_profit',
      [OrderType.OCO]: 'limit' // OCO is handled separately
    };

    return typeMap[orderType] || 'market';
  }

  /**
   * T019: Get user holdings for a specific coin
   * Calculates total holdings, average buy price, and profit/loss
   * @param user User requesting holdings
   * @param coin Coin to get holdings for
   * @returns UserHoldingsDto with holdings breakdown
   */
  async getHoldingsByCoin(user: User, coin: Coin): Promise<UserHoldingsDto> {
    // Query all filled orders for this user and coin
    const orders = await this.orderRepository.find({
      where: {
        user: { id: user.id },
        baseCoin: { id: coin.id },
        status: OrderStatus.FILLED
      },
      relations: ['exchange', 'baseCoin'],
      order: { transactTime: 'ASC' }
    });

    // If no orders, return zero holdings
    if (orders.length === 0) {
      return {
        coinSymbol: coin.symbol,
        totalAmount: 0,
        averageBuyPrice: 0,
        currentValue: 0,
        profitLoss: 0,
        profitLossPercent: 0,
        exchanges: []
      };
    }

    // Calculate total holdings and weighted average buy price
    let totalBought = 0;
    let totalSold = 0;
    let totalCostBasis = 0; // Total USD spent on buys

    const exchangeHoldings = new Map<string, { exchangeName: string; amount: number; lastSynced: Date }>();

    for (const order of orders) {
      const amount = order.executedQuantity || 0;
      const exchangeId = order.exchange?.id || 'unknown';
      const exchangeName = order.exchange?.name || 'Unknown';

      if (order.side === OrderSide.BUY) {
        totalBought += amount;
        totalCostBasis += order.cost || amount * (order.price || 0);

        // Update exchange holdings
        const existing = exchangeHoldings.get(exchangeId) || {
          exchangeName,
          amount: 0,
          lastSynced: order.transactTime
        };
        existing.amount += amount;
        existing.lastSynced = order.transactTime;
        exchangeHoldings.set(exchangeId, existing);
      } else if (order.side === OrderSide.SELL) {
        totalSold += amount;

        // Update exchange holdings
        const existing = exchangeHoldings.get(exchangeId);
        if (existing) {
          existing.amount -= amount;
          existing.lastSynced = order.transactTime;
        }
      }
    }

    const totalAmount = totalBought - totalSold;
    const averageBuyPrice = totalBought > 0 ? totalCostBasis / totalBought : 0;
    const currentPrice = coin.currentPrice || 0;
    const currentValue = totalAmount * currentPrice;
    const invested = totalAmount * averageBuyPrice;
    const profitLoss = currentValue - invested;
    const profitLossPercent = invested > 0 ? (profitLoss / invested) * 100 : 0;

    // Filter out exchanges with zero or negative holdings
    const exchangesList = Array.from(exchangeHoldings.values()).filter((h) => h.amount > 0);

    return {
      coinSymbol: coin.symbol,
      totalAmount,
      averageBuyPrice,
      currentValue,
      profitLoss,
      profitLossPercent,
      exchanges: exchangesList
    };
  }

  /**
   * Place an algorithmic order for robo-advisor system.
   * Sets isAlgorithmicTrade flag and strategyConfigId for tracking.
   */
  async placeAlgorithmicOrder(
    userId: string,
    strategyConfigId: string,
    signal: { action: 'buy' | 'sell'; symbol: string; quantity: number; price: number },
    exchangeKeyId: string
  ): Promise<Order> {
    this.logger.log(
      `Placing algorithmic ${signal.action} order for user ${userId}, strategy ${strategyConfigId}, symbol ${signal.symbol}`
    );

    try {
      const user = { id: userId } as User;
      const exchangeKey = await this.exchangeKeyService.findOne(exchangeKeyId, userId);
      if (!exchangeKey || !exchangeKey.exchange) {
        throw new NotFoundException('Exchange key not found');
      }

      const exchange = await this.exchangeManager.getExchangeClient(exchangeKey.exchange.slug, user);
      await exchange.loadMarkets();

      const ccxtOrder = await exchange.createOrder(
        signal.symbol,
        'market',
        signal.action,
        signal.quantity,
        signal.price
      );

      const [baseSymbol, quoteSymbol] = signal.symbol.split('/');
      let baseCoin = null;
      let quoteCoin = null;

      try {
        baseCoin = await this.coinService.getCoinBySymbol(baseSymbol, [], false);
        quoteCoin = await this.coinService.getCoinBySymbol(quoteSymbol, [], false);
      } catch {
        this.logger.warn(`Coins not found for ${signal.symbol}`);
      }

      const order = this.orderRepository.create({
        orderId: ccxtOrder.id?.toString() || '',
        clientOrderId: ccxtOrder.clientOrderId || ccxtOrder.id?.toString() || '',
        symbol: signal.symbol,
        side: signal.action === 'buy' ? OrderSide.BUY : OrderSide.SELL,
        type: OrderType.MARKET,
        quantity: signal.quantity,
        price: ccxtOrder.price || signal.price || 0,
        executedQuantity: ccxtOrder.filled || 0,
        cost: ccxtOrder.cost || 0,
        fee: ccxtOrder.fee?.cost || 0,
        feeCurrency: ccxtOrder.fee?.currency,
        status: this.mapExchangeStatusToOrderStatus(ccxtOrder.status || 'open'),
        transactTime: new Date(ccxtOrder.timestamp || Date.now()),
        isManual: false,
        isAlgorithmicTrade: true,
        strategyConfigId,
        exchangeKeyId,
        user,
        baseCoin: baseCoin || undefined,
        quoteCoin: quoteCoin || undefined,
        exchange: exchangeKey.exchange,
        trades: ccxtOrder.trades,
        info: ccxtOrder.info
      });

      const savedOrder = await this.orderRepository.save(order);
      this.logger.log(`Algorithmic order created: ${savedOrder.id}`);
      return savedOrder;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Algorithmic order failed: ${err.message}`, err.stack);
      throw new BadRequestException(`Failed to place algorithmic order: ${err.message}`);
    }
  }
}
