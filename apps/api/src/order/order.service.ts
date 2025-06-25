import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository, FindManyOptions } from 'typeorm';

import { OrderDto } from './dto/order.dto';
import { Order, OrderSide, OrderStatus, OrderType } from './order.entity';
import { OrderCalculationService } from './services/order-calculation.service';
import { OrderValidationService } from './services/order-validation.service';

import { CoinService } from '../coin/coin.service';
import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { User } from '../users/users.entity';

export interface OrderFilters {
  status?: OrderStatus;
  side?: OrderSide;
  limit?: number;
}

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    @InjectRepository(Order) private readonly orderRepository: Repository<Order>,
    private readonly exchangeManager: ExchangeManagerService,
    private readonly coinService: CoinService,
    private readonly orderValidationService: OrderValidationService,
    private readonly orderCalculationService: OrderCalculationService
  ) {}

  /**
   * Create a new order (buy or sell)
   */
  async createOrder(orderDto: OrderDto, user: User): Promise<Order> {
    this.logger.log(`Creating ${orderDto.side} order for user: ${user.id}`);

    try {
      // 1. Validate and get coins
      const { baseCoin, quoteCoin } = await this.validateAndGetCoins(orderDto);

      // 2. Get exchange client
      const exchange = await this.exchangeManager.getExchangeClient('binance_us', user);

      // 3. Build trading symbol
      const symbol = `${baseCoin.symbol}/${quoteCoin.symbol}`;

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
   * Get orders for a user with optional filtering
   */
  async getOrders(user: User, filters: OrderFilters = {}): Promise<Order[]> {
    const queryOptions: FindManyOptions<Order> = {
      where: { user: { id: user.id } },
      relations: ['baseCoin', 'quoteCoin', 'exchange'],
      order: { createdAt: 'DESC' }
    };

    // Apply filters
    if (filters.status) {
      queryOptions.where = { ...queryOptions.where, status: filters.status };
    }
    if (filters.side) {
      queryOptions.where = { ...queryOptions.where, side: filters.side };
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
    const baseCoin = await this.coinService.getCoinById(orderDto.coinId);
    if (!baseCoin) {
      throw new BadRequestException(`Invalid coin ID: ${orderDto.coinId}`);
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
  private async executeOrderOnExchange(exchange: any, symbol: string, orderDto: OrderDto) {
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
}
