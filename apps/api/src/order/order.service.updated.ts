import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import * as ccxt from 'ccxt';
import { Repository } from 'typeorm';

import { Coin } from './../coin/coin.entity';
import { OrderDto } from './dto/order.dto';
import { Order, OrderSide, OrderStatus, OrderType } from './order.entity';
import { TestnetDto } from './testnet/dto/testnet.dto';

import { CoinService } from '../coin/coin.service';
import { TickerPairService } from '../coin/ticker-pairs/ticker-pairs.service';
import { BinanceUSService } from '../exchange/binance/binance-us.service';
import { User } from '../users/users.entity';
import { NotFoundCustomException } from '../utils/filters/not-found.exception';

// Define our own types to replace the Binance-specific ones
interface SymbolPriceFilter {
  filterType: string;
  minPrice: string;
  maxPrice: string;
  tickSize: string;
}

interface SymbolLotSizeFilter {
  filterType: string;
  minQty: string;
  maxQty: string;
  stepSize: string;
}

interface SymbolMinNotionalFilter {
  filterType: string;
  minNotional: string;
}

// Replace OrderSide_LT with string type
type OrderSide_LT = 'BUY' | 'SELL';

interface SymbolValidationFilters {
  priceFilter: SymbolPriceFilter;
  lotSizeFilter: SymbolLotSizeFilter;
  minNotionalFilter: SymbolMinNotionalFilter;
}

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);
  constructor(
    @InjectRepository(Order)
    private readonly order: Repository<Order>,
    private readonly binance: BinanceUSService,
    private readonly coin: CoinService,
    private readonly tickerPairs: TickerPairService
  ) {}

  // [KEEP EXISTING createBuyOrder AND createSellOrder METHODS]

  async getOrders(user: User) {
    try {
      // Query database for orders with coin relationship loaded
      const orders = await this.order.find({
        where: { user: { id: user.id } },
        relations: ['coin'],
        order: { transactTime: 'DESC' }
      });

      // Transform to match frontend expectations
      return orders.map((order) => ({
        id: order.id,
        symbol: order.symbol,
        orderId: order.orderId,
        clientOrderId: order.clientOrderId,
        transactTime: order.transactTime,
        quantity: order.quantity,
        price: order.price,
        executedQuantity: order.executedQuantity,
        status: order.status,
        side: order.side,
        type: order.type,
        coin: {
          id: order.coin.id,
          name: order.coin.name,
          symbol: order.coin.symbol,
          slug: order.coin.slug || '',
          logo: order.coin.image || ''
        },
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
      }));
    } catch (error) {
      this.logger.error(`Failed to fetch orders: ${error.message}`);
      return [];
    }
  }

  async getOrder(user: User, orderId: string) {
    try {
      // Query order from database with coin relationship
      const order = await this.order.findOne({
        where: { id: orderId, user: { id: user.id } },
        relations: ['coin']
      });

      if (!order) throw new NotFoundCustomException('Order', { id: orderId });

      // Transform to match frontend expectations
      return {
        id: order.id,
        symbol: order.symbol,
        orderId: order.orderId,
        clientOrderId: order.clientOrderId,
        transactTime: order.transactTime,
        quantity: order.quantity,
        price: order.price,
        executedQuantity: order.executedQuantity,
        status: order.status,
        side: order.side,
        type: order.type,
        coin: {
          id: order.coin.id,
          name: order.coin.name,
          symbol: order.coin.symbol,
          slug: order.coin.slug || '',
          logo: order.coin.image || ''
        },
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
      };
    } catch (error) {
      this.logger.error(`Failed to fetch order ${orderId}: ${error.message}`);
      throw new NotFoundCustomException('Order', { id: orderId.toString() });
    }
  }

  async getOpenOrders(user: User) {
    try {
      // Query database for open orders with coin relationship
      const openOrders = await this.order.find({
        where: {
          user: { id: user.id },
          status: OrderStatus.NEW // Only fetch orders with "NEW" status
        },
        relations: ['coin'],
        order: { transactTime: 'DESC' }
      });

      // Transform to match frontend expectations
      return openOrders.map((order) => ({
        id: order.id,
        symbol: order.symbol,
        orderId: order.orderId,
        clientOrderId: order.clientOrderId,
        transactTime: order.transactTime,
        quantity: order.quantity,
        price: order.price,
        executedQuantity: order.executedQuantity,
        status: order.status,
        side: order.side,
        type: order.type,
        coin: {
          id: order.coin.id,
          name: order.coin.name,
          symbol: order.coin.symbol,
          slug: order.coin.slug || '',
          logo: order.coin.image || ''
        },
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
      }));
    } catch (error) {
      this.logger.error(`Failed to fetch open orders: ${error.message}`);
      return [];
    }
  }

  // [KEEP EXISTING PRIVATE METHODS]
}
