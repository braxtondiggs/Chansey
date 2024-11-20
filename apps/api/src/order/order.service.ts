import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OrderSide_LT, SymbolLotSizeFilter, SymbolMinNotionalFilter, SymbolPriceFilter } from 'binance-api-node';
import { Repository } from 'typeorm';

import { Coin } from './../coin/coin.entity';
import { OrderDto } from './dto/order.dto';
import { Order, OrderSide, OrderStatus, OrderType } from './order.entity';
import { CoinService } from '../coin/coin.service';
import { TickerPairService } from '../coin/ticker-pairs/ticker-pairs.service';
import { BinanceService } from '../exchange/binance/binance.service';
import { User } from '../users/users.entity';
import { TestnetDto } from './testnet/dto/testnet.dto';
import { NotFoundCustomException } from '../utils/filters/not-found.exception';

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
    private readonly binance: BinanceService,
    private readonly coin: CoinService,
    private readonly tickerPairs: TickerPairService
  ) {}

  async createBuyOrder(order: OrderDto, user: User) {
    this.logger.debug(`Creating buy order for user: ${user.id}, coinId: ${order.coinId}`);

    const coin = await this.coin.getCoinById(order.coinId); // TODO: Get price using price service
    // const price = await this.binance.getPriceBySymbol(`${coin.symbol.toUpperCase()}USDT`, user);

    if (!coin) throw new BadRequestException('Invalid coin ID');

    const suggestedCoins = await this.coin.getCoinsByRiskLevel(user);
    const balance = await this.binance.getBalance(user);
    const freeBalance = balance.find((b) => b.asset === 'USD');
    const MIN_QUANTITY = 0.00001;
    let remainingQuantity = Number(parseFloat(order.quantity).toFixed(8));
    const orders = [];

    // !NOTE: USD is not trading for some reason -  Getting market closed
    /* try {
      if (freeBalance && parseFloat(freeBalance.free) > 0) {
        const usdSymbol = `${coin.symbol.toUpperCase()}USD`;
        const usdQuantity = Math.min(price, parseFloat(freeBalance.free)).toString();
        console.log(usdQuantity);

        const orderResponse = await this.createOrder(usdSymbol, usdQuantity, order, coin, user);
        console.log('orderResponse', orderResponse);
        orders.push(orderResponse);
        remainingQuantity -= parseFloat(orderResponse.executedQty);
      }
    } catch (error) {
      this.logger.debug(`USD order validation failed: ${error.message}`);
    }*/

    // If there's still remaining quantity to purchase, continue with other pairs
    if (remainingQuantity > MIN_QUANTITY) {
      const sortedBalance = balance.sort((a, b) => {
        if (a.asset === 'USD' || a.asset === 'USDT') return -1;
        if (b.asset === 'USD' || b.asset === 'USDT') return 1;
        const coinIndexA = suggestedCoins.findIndex((c) => c.symbol.toUpperCase() === a.asset);
        const coinIndexB = suggestedCoins.findIndex((c) => c.symbol.toUpperCase() === b.asset);
        return coinIndexA - coinIndexB;
      });

      const tickerPairPromise = sortedBalance
        .filter((b) => b.asset !== 'USD' && b.asset.toUpperCase() !== coin.symbol)
        .map((b) => this.tickerPairs.getTickerPairBySymbol(coin.symbol, b.asset));
      const pairs = await Promise.all(tickerPairPromise);
      const validPairs = pairs.filter((p) => p !== null);

      if (validPairs.length === 0 && parseFloat(freeBalance.free) <= 0) {
        throw new BadRequestException('No valid trading pairs found');
      }

      for (const balance of sortedBalance) {
        if (remainingQuantity < MIN_QUANTITY) break;

        const pair = validPairs.find((p) => p.quoteAsset.symbol.toUpperCase() === balance.asset);
        if (!pair) continue;

        const symbol = pair.symbol;
        const availableBalance = Number(parseFloat(balance.free).toFixed(8));
        if (availableBalance < MIN_QUANTITY) continue;

        const orderQuantity = Number(Math.min(remainingQuantity, availableBalance).toFixed(8));

        try {
          const validatedOrder = await this.isExchangeValid(
            { ...order, quantity: orderQuantity.toString() },
            OrderType.MARKET,
            symbol,
            user
          );

          // Get the actual quantity after step size adjustment
          const actualQuantity = parseFloat(validatedOrder.quantity);
          if (actualQuantity < MIN_QUANTITY) {
            continue; // Skip if adjusted quantity is too small
          }

          const orderResponse = await this.createOrder(
            symbol,
            validatedOrder.quantity.toString(),
            OrderSide.BUY,
            order,
            coin,
            user
          );
          orders.push(orderResponse);
          remainingQuantity = Number((remainingQuantity - actualQuantity).toFixed(8));
        } catch (error) {
          if (error instanceof BadRequestException) {
            this.logger.debug(`Skipping order due to validation: ${error.message}`);
            continue;
          }
          this.logger.debug(`Order creation failed: ${error.message}`);
          throw error;
        }
      }

      // Only throw if no orders were created and there's significant remaining quantity
      if (orders.length === 0 && remainingQuantity >= MIN_QUANTITY) {
        throw new BadRequestException(`Could not create any valid orders. Remaining: ${remainingQuantity}`);
      }

      // Ignore leftover quantity that cannot be purchased
      if (remainingQuantity < MIN_QUANTITY) {
        this.logger.debug(`Ignoring leftover quantity: ${remainingQuantity}`);
      }
    }

    return orders;
  }

  async createSellOrder(order: OrderDto, user: User) {
    this.logger.debug(`Creating sell order for user: ${user.id}, coinId: ${order.coinId}`);

    const coin = await this.coin.getCoinById(order.coinId);
    if (!coin) throw new BadRequestException('Invalid coin ID');

    const balance = await this.binance.getBalance(user);
    const coinBalance = balance.find((b) => b.asset === coin.symbol.toUpperCase());

    if (!coinBalance || Number(coinBalance.free) <= 0) {
      throw new BadRequestException(`Insufficient ${coin.symbol.toUpperCase()} balance`);
    }

    const MIN_QUANTITY = 0.00001;
    const remainingQuantity = Number(parseFloat(order.quantity).toFixed(8));
    const availableQuantity = Number(parseFloat(coinBalance.free).toFixed(8));

    if (remainingQuantity > availableQuantity) {
      throw new BadRequestException(
        `Insufficient balance. Available: ${availableQuantity}, Requested: ${remainingQuantity}`
      );
    }

    const orders = [];
    const symbol = `${coin.symbol.toUpperCase()}USDT`;

    try {
      const validatedOrder = await this.isExchangeValid(
        { ...order, quantity: remainingQuantity.toString() },
        OrderType.MARKET,
        symbol,
        user
      );

      const actualQuantity = parseFloat(validatedOrder.quantity);
      if (actualQuantity < MIN_QUANTITY) {
        throw new BadRequestException(`Quantity ${actualQuantity} is below minimum allowed ${MIN_QUANTITY}`);
      }

      const orderResponse = await this.createOrder(
        symbol,
        validatedOrder.quantity.toString(),
        OrderSide.SELL,
        order,
        coin,
        user
      );

      orders.push(orderResponse);
    } catch (error) {
      this.logger.error(`Sell order failed: ${error.message}`);
      throw new BadRequestException(`Failed to create sell order: ${error.message}`);
    }

    return orders;
  }

  async getOrders(user: User) {
    const binance = this.binance.getBinanceClient(user);
    return await binance.allOrders({ symbol: 'BTCUSD' });
  }

  async getOrder(user: User, orderId: number) {
    const binance = this.binance.getBinanceClient(user);
    const order = await binance.getOrder({ symbol: 'BTCUSD', orderId });
    if (!order) throw new NotFoundCustomException('Order', { id: orderId.toString() });
    return order;
  }

  async getOpenOrders(user: User) {
    const binance = this.binance.getBinanceClient(user);
    return await binance.openOrders({ symbol: 'BTCUSD' });
  }

  private async createOrder(
    symbol: string,
    quantity: string,
    side: OrderSide_LT,
    order: OrderDto,
    coin: Coin,
    user: User
  ) {
    try {
      const binance = this.binance.getBinanceClient(user);
      const action = await binance.order({
        symbol,
        side,
        quantity,
        type: OrderType.MARKET as any
      });

      await this.order.insert({
        clientOrderId: action.clientOrderId,
        coin,
        executedQuantity: parseFloat(action.executedQty),
        orderId: action.orderId.toString(),
        price: parseFloat(action.fills[0].price),
        quantity: Number(order.quantity),
        side: side as OrderSide,
        status: action.status as OrderStatus,
        // stopPrice: order.stopPrice ? parseFloat(order.stopPrice) : null,
        symbol: symbol,
        transactTime: action.transactTime.toString(),
        type: OrderType.MARKET,
        user
      });
      return action;
    } catch (error) {
      this.logger.error(`Failed to create order: ${error.message}`);
      throw new BadRequestException(`Order creation failed: ${error.message}`);
    }
  }

  private async getExchangeInfo(symbol: string, user?: User) {
    const binance = this.binance.getBinanceClient(user);
    return await binance.exchangeInfo({ symbol });
  }

  private getSymbolFilters(filters: any[]): SymbolValidationFilters {
    return {
      priceFilter: filters.find((f) => f.filterType === 'PRICE_FILTER') as SymbolPriceFilter,
      lotSizeFilter: filters.find((f) => f.filterType === 'LOT_SIZE') as SymbolLotSizeFilter,
      minNotionalFilter: filters.find((f) => f.filterType === 'MIN_NOTIONAL') as SymbolMinNotionalFilter
    };
  }

  private validateSymbolStatus(symbol: any): void {
    if (symbol.status !== 'TRADING') {
      throw new BadRequestException('Trading is currently suspended for this symbol');
    }
    if (!symbol.permissions?.includes('SPOT')) {
      throw new BadRequestException('Spot trading is not available for this symbol');
    }
  }

  private roundToStepSize(quantity: number, stepSize: string): number {
    const precision = this.getPrecisionFromStepSize(stepSize);
    const step = parseFloat(stepSize);
    return Number((Math.floor(quantity / step) * step).toFixed(precision));
  }

  private getPrecisionFromStepSize(stepSize: string): number {
    return stepSize.split('.')[1].length;
  }

  private isValidTickSize(price: number, tickSize: string): boolean {
    const precision = this.getPrecisionFromStepSize(tickSize);
    const multiplier = Math.pow(10, precision);
    const tickSizeFloat = parseFloat(tickSize);
    return Math.abs((price * multiplier) % (tickSizeFloat * multiplier)) < Number.EPSILON;
  }

  private validatePrice(price: number, filters: SymbolValidationFilters): void {
    const { minPrice, maxPrice, tickSize } = filters.priceFilter;
    const minPriceFloat = parseFloat(minPrice);
    const maxPriceFloat = parseFloat(maxPrice);

    if (price < minPriceFloat || Math.abs(price - minPriceFloat) < Number.EPSILON) {
      throw new BadRequestException(`Price ${price} is below minimum allowed ${minPrice}`);
    }
    if (price > maxPriceFloat || Math.abs(price - maxPriceFloat) < Number.EPSILON) {
      throw new BadRequestException(`Price ${price} exceeds maximum allowed ${maxPrice}`);
    }
    if (!this.isValidTickSize(price, tickSize)) {
      throw new BadRequestException(`Price ${price} does not match tick size ${tickSize}`);
    }
  }

  private calculateMaxQuantity(quantity: number, stepSize: string): number {
    const precision = this.getPrecisionFromStepSize(stepSize);
    const step = parseFloat(stepSize);
    const maxSteps = Math.floor(quantity / step);
    return Number((maxSteps * step).toFixed(precision));
  }

  private validateAndAdjustQuantity(quantity: number, filters: SymbolValidationFilters, precision: number): string {
    const { minQty, maxQty, stepSize } = filters.lotSizeFilter;
    const minQtyFloat = parseFloat(minQty);
    const maxQtyFloat = parseFloat(maxQty);

    // Calculate the maximum valid quantity based on step size
    const maxValidQuantity = this.calculateMaxQuantity(quantity, stepSize);

    if (maxValidQuantity < minQtyFloat || Math.abs(maxValidQuantity - minQtyFloat) < Number.EPSILON) {
      throw new BadRequestException(`Adjusted quantity ${maxValidQuantity} is below minimum allowed ${minQty}`);
    }
    if (maxValidQuantity > maxQtyFloat) {
      throw new BadRequestException(`Quantity ${maxValidQuantity} exceeds maximum allowed ${maxQty}`);
    }

    return maxValidQuantity.toFixed(precision);
  }

  async isExchangeValid(
    order: OrderDto | TestnetDto,
    orderType: OrderType,
    symbol: string,
    user?: User
  ): Promise<OrderDto | TestnetDto> {
    try {
      const { symbols } = await this.getExchangeInfo(symbol, user);
      const symbolInfo = symbols[0];
      this.validateSymbolStatus(symbolInfo);

      const filters = this.getSymbolFilters(symbolInfo.filters);
      const quantity = parseFloat(order.quantity);

      // Validate minimum notional value if applicable
      if (orderType === OrderType.LIMIT && order.price) {
        const price = parseFloat(order.price);
        this.validatePrice(price, filters);

        const minNotional = parseFloat((filters.minNotionalFilter as any).minNotional);
        const notionalValue = quantity * price;
        if (notionalValue < minNotional) {
          throw new BadRequestException(`Order value ${notionalValue} is below minimum allowed ${minNotional}`);
        }
      }

      order.quantity = this.validateAndAdjustQuantity(quantity, filters, symbolInfo.quotePrecision);
      return order;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Exchange validation failed: ${error.message}`);
    }
  }
}
