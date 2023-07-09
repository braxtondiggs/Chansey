import { Injectable } from '@nestjs/common';
import { OrderSide_LT, OrderType } from 'binance-api-node';

import { OrderDto } from './dto/order.dto';
import User from '../users/users.entity';
import UsersService from '../users/users.service';

@Injectable()
export class OrderService {
  constructor(private readonly user: UsersService) {}

  async createTestOrder(side: OrderSide_LT, order: OrderDto, user: User) {
    const binance = this.user.getBinance(user);
    return await binance.orderTest({
      symbol: order.symbol,
      side,
      quantity: order.quantity,
      type: 'MARKET' as OrderType.MARKET
    });
  }

  async createOrder(side: OrderSide_LT, order: OrderDto, user: User) {
    const binance = this.user.getBinance(user);
    return await binance.order({
      symbol: order.symbol,
      side,
      quantity: order.quantity,
      type: 'MARKET' as OrderType.MARKET
    });
  }

  async getOrders(user: User) {
    const binance = this.user.getBinance(user);
    return await binance.allOrders({ symbol: 'BTCUSD' });
  }

  async getOrder(user: User, orderId: number) {
    const binance = this.user.getBinance(user);
    return await binance.getOrder({ symbol: 'BTCUSD', orderId });
  }

  async getOpenOrders(user: User) {
    const binance = this.user.getBinance(user);
    return await binance.openOrders({ symbol: 'BTCUSD' });
  }
}
