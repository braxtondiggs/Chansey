import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import * as ccxt from 'ccxt';
import { FindManyOptions, In, Repository } from 'typeorm';

import { ExchangeService } from '@chansey-api/exchange/exchange.service';

import { OrderPreviewRequestDto } from './dto/order-preview-request.dto';
import { OrderPreviewDto } from './dto/order-preview.dto';
import { OrderDto } from './dto/order.dto';
import { PlaceManualOrderDto } from './dto/place-manual-order.dto';
import { Order, OrderSide, OrderStatus, OrderType, TrailingType } from './order.entity';
import { OrderCalculationService } from './services/order-calculation.service';
import { OrderValidationService } from './services/order-validation.service';

import { CoinService } from '../coin/coin.service';
import { ExchangeKeyService } from '../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { User } from '../users/users.entity';

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
    private readonly exchangeService: ExchangeService,
    private readonly exchangeManager: ExchangeManagerService,
    private readonly exchangeKeyService: ExchangeKeyService,
    private readonly coinService: CoinService,
    private readonly orderValidationService: OrderValidationService,
    private readonly orderCalculationService: OrderCalculationService
  ) {}

  /**
   * Create a new order (buy or sell)
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

      // 6. Save order to database
      const savedOrder = await this.saveOrderToDatabase(exchangeOrder, orderDto, baseCoin, quoteCoin, user);

      this.logger.log(`Order created successfully: ${savedOrder.id}`);
      return savedOrder;
    } catch (error) {
      this.logger.error(`Order creation failed: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to create order: ${error.message}`);
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

      // 5. Get current market data
      const ticker = await exchange.fetchTicker(symbol);
      const marketPrice = ticker.last || ticker.close || 0;

      // 5. Calculate order details
      const quantity = parseFloat(orderDto.quantity);
      let price = marketPrice;

      if (orderDto.type === OrderType.LIMIT && orderDto.price) {
        price = parseFloat(orderDto.price);
      }

      const orderValue = quantity * price;

      // 6. Get trading fees from exchange with fallback
      const { feeRate, feeAmount, feePercentage } = await this.getTradingFees(
        exchange,
        exchangeSlug,
        orderDto.side,
        orderValue
      );

      // 7. Get user balance
      const balances = await exchange.fetchBalance();
      const balanceCurrency = orderDto.side === OrderSide.BUY ? quoteCoin.symbol : baseCoin.symbol;
      const availableBalance = balances[balanceCurrency]?.free || 0;

      // 8. Calculate total cost or net amount
      let totalCost: number | undefined;
      let netAmount: number | undefined;
      let hasSufficientBalance = false;

      if (orderDto.side === OrderSide.BUY) {
        totalCost = orderValue + feeAmount;
        hasSufficientBalance = availableBalance >= totalCost;
      } else {
        netAmount = orderValue - feeAmount;
        hasSufficientBalance = availableBalance >= quantity;
      }

      // 9. Estimate slippage for market orders
      let estimatedSlippage: number | undefined;
      if (orderDto.type === OrderType.MARKET) {
        const orderBook = await exchange.fetchOrderBook(symbol, 20);
        estimatedSlippage = this.calculateSlippage(orderBook, quantity, orderDto.side);
      }

      const preview: OrderPreviewDto = {
        symbol,
        side: orderDto.side,
        orderType: orderDto.type,
        quantity,
        price,
        estimatedCost: orderValue,
        estimatedFee: feeAmount,
        feeCurrency: balanceCurrency,
        totalRequired: totalCost || orderValue,
        marketPrice,
        availableBalance,
        balanceCurrency,
        hasSufficientBalance,
        exchange: 'binance_us'
      };

      this.logger.log(`Order preview calculated for user: ${user.id}`);
      return preview;
    } catch (error) {
      this.logger.error(`Order preview failed: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to preview order: ${error.message}`);
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
    } catch (error) {
      this.logger.error(`Exchange order failed: ${error.message}`);
      throw new BadRequestException(`Exchange error: ${error.message}`);
    }
  }

  /**
   * Save order to database
   */
  private async saveOrderToDatabase(
    exchangeOrder: any,
    orderDto: OrderDto,
    baseCoin: any,
    quoteCoin: any,
    user: User
  ): Promise<Order> {
    const order = this.orderRepository.create({
      orderId: exchangeOrder.id?.toString(),
      clientOrderId: exchangeOrder.clientOrderId || exchangeOrder.id?.toString(),
      symbol: exchangeOrder.symbol,
      side: orderDto.side,
      type: orderDto.type,
      quantity: parseFloat(orderDto.quantity),
      price: exchangeOrder.price || (orderDto.price ? parseFloat(orderDto.price) : 0),
      executedQuantity: exchangeOrder.filled || 0,
      cost: exchangeOrder.cost || 0,
      fee: exchangeOrder.fee?.cost || 0,
      feeCurrency: exchangeOrder.fee?.currency,
      status: this.mapExchangeStatusToOrderStatus(exchangeOrder.status),
      transactTime: new Date(exchangeOrder.timestamp || Date.now()),
      baseCoin,
      quoteCoin,
      user,
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
   * Get trading fees with fallback mechanisms
   */
  private async getTradingFees(
    exchange: ccxt.Exchange,
    exchangeSlug: string,
    side: OrderSide,
    orderValue: number
  ): Promise<{ feeRate: number; feeAmount: number; feePercentage: number }> {
    try {
      // Try to get trading fees from exchange API
      const tradingFees = await exchange.fetchTradingFees();
      this.logger.debug(`Trading fees from API for ${exchangeSlug}:`, tradingFees);

      const feeRate = side === OrderSide.BUY ? tradingFees.taker || 0.001 : tradingFees.maker || 0.001;
      const feeAmount = orderValue * (feeRate as number);
      const feePercentage = (feeRate as number) * 100;

      return { feeRate: feeRate as number, feeAmount, feePercentage };
    } catch (error) {
      this.logger.warn(`Failed to fetch trading fees from API for ${exchangeSlug}: ${error.message}`);

      // Fallback 1: Try to get fees from exchange.markets (pre-loaded market data)
      try {
        if (exchange.markets && Object.keys(exchange.markets).length > 0) {
          // Get fee from any market as they're usually consistent across the exchange
          const firstMarket = Object.values(exchange.markets)[0];
          const feeRate = side === OrderSide.BUY ? firstMarket.taker || 0.001 : firstMarket.maker || 0.001;
          const feeAmount = orderValue * feeRate;
          const feePercentage = feeRate * 100;

          this.logger.debug(`Using market fees for ${exchangeSlug}: ${feeRate}`);
          return { feeRate, feeAmount, feePercentage };
        }
      } catch (marketError) {
        this.logger.warn(`Failed to get fees from markets for ${exchangeSlug}: ${marketError.message}`);
      }

      // Fallback 2: Use exchange-specific default fees
      const defaultFees = this.getDefaultFees(exchangeSlug);
      const feeRate = side === OrderSide.BUY ? defaultFees.taker : defaultFees.maker;
      const feeAmount = orderValue * feeRate;
      const feePercentage = feeRate * 100;

      this.logger.debug(`Using default fees for ${exchangeSlug}: ${feeRate}`);
      return { feeRate, feeAmount, feePercentage };
    }
  }

  /**
   * Get default fees for exchanges when API is unavailable
   */
  private getDefaultFees(exchangeSlug: string): { maker: number; taker: number } {
    const defaultFees: Record<string, { maker: number; taker: number }> = {
      binanceus: { maker: 0.001, taker: 0.001 }, // 0.1%
      binance: { maker: 0.001, taker: 0.001 }, // 0.1%
      coinbase: { maker: 0.005, taker: 0.005 }, // 0.5%
      coinbasepro: { maker: 0.005, taker: 0.005 }, // 0.5%
      coinbaseexchange: { maker: 0.005, taker: 0.005 }, // 0.5%
      kraken: { maker: 0.0016, taker: 0.0026 }, // 0.16%/0.26%
      kucoin: { maker: 0.001, taker: 0.001 }, // 0.1%
      okx: { maker: 0.0008, taker: 0.001 } // 0.08%/0.1%
    };

    return defaultFees[exchangeSlug] || { maker: 0.001, taker: 0.001 }; // Default 0.1%
  }

  /**
   * Calculate estimated slippage for market orders
   */
  private calculateSlippage(orderBook: any, quantity: number, side: OrderSide): number {
    try {
      const orders = side === OrderSide.BUY ? orderBook.asks : orderBook.bids;
      if (!orders || orders.length === 0) return 0;

      let remainingQuantity = quantity;
      let totalCost = 0;
      let weightedAveragePrice = 0;

      // Calculate weighted average price by consuming order book
      for (const [price, availableQuantity] of orders) {
        if (remainingQuantity <= 0) break;

        const quantityToTake = Math.min(remainingQuantity, availableQuantity);
        totalCost += quantityToTake * price;
        remainingQuantity -= quantityToTake;
      }

      if (quantity > 0) {
        weightedAveragePrice = totalCost / quantity;
        const marketPrice = orders[0][0]; // Best bid/ask price
        const slippage = Math.abs((weightedAveragePrice - marketPrice) / marketPrice) * 100;
        return Math.round(slippage * 100) / 100; // Round to 2 decimal places
      }

      return 0;
    } catch (error) {
      this.logger.warn(`Failed to calculate slippage: ${error.message}`);
      return 0;
    }
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

      const exchange = await this.exchangeManager.getExchangeClient(exchangeKey.exchange.slug, user);
      await exchange.loadMarkets();

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

      // Get trading fees
      const market = exchange.markets[dto.symbol];
      const feeRate = dto.side === OrderSide.BUY ? market?.taker || 0.001 : market?.maker || 0.001;
      const estimatedFee = estimatedCost * feeRate;
      const totalRequired = estimatedCost + estimatedFee;

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
        feeCurrency: quoteCurrency,
        totalRequired,
        marketPrice,
        availableBalance,
        balanceCurrency,
        hasSufficientBalance,
        warnings,
        exchange: exchange.name || 'Unknown'
      };

      return preview;
    } catch (error) {
      this.logger.error(`Manual order preview failed: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to preview order: ${error.message}`);
    }
  }

  /**
   * Validate manual order parameters and requirements
   * @param dto Order placement data
   * @param user Authenticated user
   * @param exchange CCXT exchange instance
   * @throws BadRequestException for validation failures
   */
  private async validateManualOrder(dto: PlaceManualOrderDto, user: User, exchange: ccxt.Exchange): Promise<void> {
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
      if (!dto.trailingAmount) {
        throw new BadRequestException('Trailing amount is required for trailing stop orders');
      }
      if (!dto.trailingType) {
        throw new BadRequestException('Trailing type is required for trailing stop orders');
      }
    }

    // Validate OCO parameters
    if (dto.orderType === OrderType.OCO) {
      if (!dto.takeProfitPrice) {
        throw new BadRequestException('Take profit price is required for OCO orders');
      }
      if (!dto.stopLossPrice) {
        throw new BadRequestException('Stop loss price is required for OCO orders');
      }
    }

    // Check user balance
    const balances = await exchange.fetchBalance();
    const [baseCurrency, quoteCurrency] = dto.symbol.split('/');

    if (dto.side === OrderSide.BUY) {
      const availableQuote = balances[quoteCurrency]?.free || 0;
      const ticker = await exchange.fetchTicker(dto.symbol);
      const price = dto.price || ticker.last || ticker.close || 0;
      const cost = dto.quantity * price;
      const feeRate = market?.taker || 0.001;
      const totalRequired = cost * (1 + feeRate);

      if (availableQuote < totalRequired) {
        throw new BadRequestException(
          `Insufficient ${quoteCurrency} balance. Available: ${availableQuote.toFixed(8)}, Required: ${totalRequired.toFixed(8)}`
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
   * Place a manual order on the exchange
   * @param dto Order placement data
   * @param user Authenticated user
   * @returns Created order entity
   */
  async placeManualOrder(dto: PlaceManualOrderDto, user: User): Promise<Order> {
    this.logger.log(`Placing manual ${dto.side} ${dto.orderType} order for user: ${user.id}`);

    try {
      // Get exchange key and client
      const exchangeKey = await this.exchangeKeyService.findOne(dto.exchangeKeyId, user.id);
      if (!exchangeKey || !exchangeKey.exchange) {
        throw new NotFoundException('Exchange key not found');
      }

      const exchange = await this.exchangeManager.getExchangeClient(exchangeKey.exchange.slug, user);
      await exchange.loadMarkets();

      // Validate order
      await this.validateManualOrder(dto, user, exchange);

      // Map order type to CCXT params
      const ccxtOrderType = this.mapOrderTypeToCcxt(dto.orderType);
      const params: any = {};

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

      // Handle OCO orders (create two linked orders)
      if (dto.orderType === OrderType.OCO) {
        return await this.createOcoOrder(dto, user, exchange, exchangeKey);
      }

      // Create order on exchange
      const ccxtOrder = await exchange.createOrder(
        dto.symbol,
        ccxtOrderType,
        dto.side.toLowerCase(),
        dto.quantity,
        dto.price,
        params
      );

      // Parse symbol to get base and quote
      const [baseSymbol, quoteSymbol] = dto.symbol.split('/');
      let baseCoin = null;
      let quoteCoin = null;

      try {
        baseCoin = await this.coinService.getCoinBySymbol(baseSymbol, [], false);
      } catch (error) {
        this.logger.warn(`Base coin ${baseSymbol} not found`);
      }

      try {
        quoteCoin = await this.coinService.getCoinBySymbol(quoteSymbol, [], false);
      } catch (error) {
        this.logger.warn(`Quote coin ${quoteSymbol} not found`);
      }

      // Create order entity
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

      const savedOrder = await this.orderRepository.save(order);
      this.logger.log(`Manual order created successfully: ${savedOrder.id}`);
      return savedOrder;
    } catch (error) {
      this.logger.error(`Manual order placement failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Create OCO (One-Cancels-Other) order pair
   * @param dto Order placement data
   * @param user Authenticated user
   * @param exchange CCXT exchange instance
   * @param exchangeKey Exchange key entity
   * @returns Created take-profit order (linked to stop-loss)
   */
  private async createOcoOrder(
    dto: PlaceManualOrderDto,
    user: User,
    exchange: ccxt.Exchange,
    exchangeKey: any
  ): Promise<Order> {
    // Create take-profit order
    const takeProfitOrder = await exchange.createOrder(
      dto.symbol,
      'limit',
      dto.side.toLowerCase(),
      dto.quantity,
      dto.takeProfitPrice
    );

    // Create stop-loss order
    const stopLossOrder = await exchange.createOrder(
      dto.symbol,
      'stop_loss',
      dto.side.toLowerCase(),
      dto.quantity,
      undefined,
      { stopPrice: dto.stopLossPrice }
    );

    // Save both orders to database
    const [baseSymbol, quoteSymbol] = dto.symbol.split('/');
    let baseCoin = null;
    let quoteCoin = null;

    try {
      baseCoin = await this.coinService.getCoinBySymbol(baseSymbol, [], false);
      quoteCoin = await this.coinService.getCoinBySymbol(quoteSymbol, [], false);
    } catch (error) {
      this.logger.warn('Could not find coins for OCO order');
    }

    // Create take-profit order entity
    const tpOrder = this.orderRepository.create({
      orderId: takeProfitOrder.id?.toString() || '',
      clientOrderId: takeProfitOrder.clientOrderId || takeProfitOrder.id?.toString() || '',
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
      info: takeProfitOrder.info
    });

    const savedTpOrder = await this.orderRepository.save(tpOrder);

    // Create stop-loss order entity linked to take-profit
    const slOrder = this.orderRepository.create({
      orderId: stopLossOrder.id?.toString() || '',
      clientOrderId: stopLossOrder.clientOrderId || stopLossOrder.id?.toString() || '',
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
      info: stopLossOrder.info
    });

    await this.orderRepository.save(slOrder);

    // Update take-profit order with link to stop-loss
    savedTpOrder.ocoLinkedOrderId = slOrder.id;
    await this.orderRepository.save(savedTpOrder);

    return savedTpOrder;
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
      } catch (error) {
        // Check if order was already filled on exchange
        if (error.message?.includes('filled') || error.message?.includes('closed')) {
          throw new BadRequestException('Order was filled before cancellation');
        }
        throw new BadRequestException(`Exchange cancellation failed: ${error.message}`);
      }

      // Update order status
      order.status = OrderStatus.CANCELED;
      order.updatedAt = new Date();
      const savedOrder = await this.orderRepository.save(order);

      // If OCO order, also cancel linked order
      if (order.ocoLinkedOrderId) {
        try {
          await this.cancelManualOrder(order.ocoLinkedOrderId, user);
        } catch (error) {
          this.logger.warn(`Failed to cancel linked OCO order: ${error.message}`);
        }
      }

      this.logger.log(`Order ${orderId} canceled successfully`);
      return savedOrder;
    } catch (error) {
      this.logger.error(`Order cancellation failed: ${error.message}`, error.stack);
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
}
