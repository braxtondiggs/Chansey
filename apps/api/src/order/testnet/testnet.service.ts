import { Injectable } from '@nestjs/common';
import { OrderSide_LT } from 'binance-api-node';

import { TickerService } from '../../exchange/ticker/ticker.service';
import User from '../../users/users.entity';
import UsersService from '../../users/users.service';
import { OrderDto } from '../dto/order.dto';
import { OrderType } from '../order.entity';
import { OrderService } from '../order.service';

@Injectable()
export class TestnetService {
  constructor(
    private readonly order: OrderService,
    private readonly ticker: TickerService,
    private readonly user: UsersService
  ) {}

  async createOrder(side: OrderSide_LT, order: OrderDto) {
    // await this.ticker.getTickerByCoin(order.symbol, 'USDT', 'binance');
    //const { symbol, quantity } = await this.order.isExchangeValid(order, OrderType.MARKET);
    //console.log({ symbol, quantity });
  }

  private async validateOrder(side: OrderSide_LT, order: OrderDto, user: User) {
    const binance = this.user.getBinance(user);
    return await binance.orderTest({
      symbol: order.symbol,
      side,
      quantity: order.quantity,
      type: OrderType.MARKET as any
    });
  }
}
