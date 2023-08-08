import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OrderSide_LT, SymbolLotSizeFilter, SymbolMinNotionalFilter, SymbolPriceFilter } from 'binance-api-node';
import { Repository } from 'typeorm';

import { OrderDto } from './dto/order.dto';
import { Order, OrderSide, OrderStatus, OrderType } from './order.entity';
import { TestnetDto } from './testnet/dto/testnet.dto';
import { User } from '../users/users.entity';
import UsersService from '../users/users.service';
import { NotFoundCustomException } from '../utils/filters/not-found.exception';

@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(Order) private readonly order: Repository<Order>,
    private readonly user: UsersService
  ) {}

  async createOrder(side: OrderSide_LT, order: OrderDto, user: User) {
    const { symbol, quantity } = await this.isExchangeValid(order, OrderType.MARKET, user);
    const binance = this.user.getBinance(user);
    const action = await binance.order({
      symbol,
      side,
      quantity,
      type: OrderType.MARKET as any
    });
    await this.order.insert({
      clientOrderId: action.clientOrderId,
      orderId: action.orderId.toString(),
      quantity: Number(order.quantity),
      side: side as OrderSide,
      status: action.status as OrderStatus,
      symbol: order.symbol,
      transactTime: action.transactTime.toString(),
      type: OrderType.MARKET,
      user
    });
    return action;
  }

  async getOrders(user: User) {
    const binance = this.user.getBinance(user);
    return await binance.allOrders({ symbol: 'BTCUSD' });
  }

  async getOrder(user: User, orderId: number) {
    const binance = this.user.getBinance(user);
    const order = await binance.getOrder({ symbol: 'BTCUSD', orderId });
    if (!order) throw new NotFoundCustomException('Order', { id: orderId.toString() });
    return order;
  }

  async getOpenOrders(user: User) {
    const binance = this.user.getBinance(user);
    return await binance.openOrders({ symbol: 'BTCUSD' });
  }

  private async getExchangeInfo(symbol: string, user?: User) {
    const binance = this.user.getBinance(user);
    return await binance.exchangeInfo({ symbol });
  }

  async isExchangeValid(order: OrderDto | TestnetDto, orderType: OrderType, user?: User) {
    try {
      const { symbols } = await this.getExchangeInfo(order.symbol, user);
      const filters = symbols[0].filters;
      const priceFilter = filters.find((filter) => filter.filterType === 'PRICE_FILTER') as SymbolPriceFilter;
      const lotSizeFilter = filters.find((filter) => filter.filterType === 'LOT_SIZE') as SymbolLotSizeFilter;
      const minNotional = filters.find((filter) => filter.filterType === 'MIN_NOTIONAL') as SymbolMinNotionalFilter;
      const minPrice = parseFloat(priceFilter.minPrice);
      const maxPrice = parseFloat(priceFilter.maxPrice);
      const tickSize = parseFloat(priceFilter.tickSize);
      const minQty = parseFloat(lotSizeFilter.minQty);
      const maxQty = parseFloat(lotSizeFilter.maxQty);
      const stepSize = parseFloat(lotSizeFilter.stepSize);
      const minNotionalValue = parseFloat(minNotional.minNotional);
      if (symbols[0].status !== 'TRADING') throw new BadRequestException('Symbol is not trading');
      if (!symbols[0].permissions.includes('SPOT')) throw new BadRequestException('Invalid trading permissions');
      if (orderType === OrderType.MARKET) {
        if (+order.quantity <= minQty) throw new BadRequestException(`Quantity is less than min quantity of ${minQty}`);
        if (+order.quantity >= maxQty) throw new BadRequestException(`Quantity is more than max quantity of ${maxQty}`);
      } else if (orderType === OrderType.LIMIT) {
        if (+order.price <= minPrice) throw new BadRequestException('Price is less than minimum price');
        if (+order.price >= maxPrice) throw new BadRequestException('Price is greater than maximum price');
        if (+order.price % tickSize !== 0) throw new BadRequestException('Price is not a valid tick size');
      }

      // if (+order.quantity * +order.price < minNotionalValue) throw new Error('Order is less than minimum notional value');
      if (+order.quantity % stepSize) {
        const precision = symbols[0].quotePrecision;
        order.quantity = parseFloat((+order.quantity - (+order.quantity % stepSize)).toFixed(precision)).toString();
      }
      return order;
    } catch (e) {
      throw new BadRequestException(e.message);
    }
  }
}
