import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { FindManyOptions, In, Repository } from 'typeorm';

import { Order, OrderSide, OrderStatus, OrderType } from './order.entity';
import { OrderValidationService } from './services/order-validation.service';
import { mapExchangeStatusToOrderStatus } from './utils/order-status-mapper.util';

import { CoinService } from '../coin/coin.service';
import { InvalidSymbolException } from '../common/exceptions/order';
import { ExchangeKeyService } from '../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { mapCcxtError } from '../shared/ccxt-error-mapper.util';
import { toErrorInfo } from '../shared/error.util';
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
    private readonly exchangeManager: ExchangeManagerService,
    private readonly exchangeKeyService: ExchangeKeyService,
    private readonly coinService: CoinService,
    private readonly orderValidationService: OrderValidationService
  ) {}

  /**
   * Get orders for a user with optional filtering
   */
  async getOrders(user: User, filters: OrderFilters = {}): Promise<Order[]> {
    const queryOptions: FindManyOptions<Order> = {
      where: { user: { id: user.id } },
      relations: ['baseCoin', 'quoteCoin', 'exchange', 'algorithmActivation'],
      order: { createdAt: 'DESC' }
    };

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

    const user = { id: userId } as User;
    const exchangeKey = await this.exchangeKeyService.findOne(exchangeKeyId, userId);
    if (!exchangeKey || !exchangeKey.exchange) {
      throw new NotFoundException('Exchange key not found');
    }

    try {
      const exchange = await this.exchangeManager.getExchangeClient(exchangeKey.exchange.slug, user);
      await exchange.loadMarkets();

      const market = exchange.markets[signal.symbol];
      if (!market) {
        throw new InvalidSymbolException(signal.symbol, exchangeKey.exchange.name);
      }
      this.orderValidationService.validateAlgorithmicOrderSize(signal.quantity, signal.price, market);

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
        status: mapExchangeStatusToOrderStatus(ccxtOrder.status || 'open'),
        transactTime: new Date(ccxtOrder.timestamp || Date.now()),
        isManual: false,
        isAlgorithmicTrade: true,
        strategyConfigId,
        exchangeKeyId,
        user,
        baseCoin: baseCoin && !CoinService.isVirtualCoin(baseCoin) ? baseCoin : undefined,
        quoteCoin: quoteCoin && !CoinService.isVirtualCoin(quoteCoin) ? quoteCoin : undefined,
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
      throw mapCcxtError(error, exchangeKey.exchange.name);
    }
  }
}
