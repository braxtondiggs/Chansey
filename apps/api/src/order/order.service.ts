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
import { ExchangeKeyService } from '../exchange/exchange-key/exchange-key.service';
import { User } from '../users/users.entity';
import { UsersService } from '../users/users.service';
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

// Define type for CCXT order objects
// We're using ccxt.Order instead of a custom interface

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
    private readonly tickerPairs: TickerPairService,
    private readonly exchangeKeyService: ExchangeKeyService,
    private readonly usersService: UsersService
  ) {}

  async createBuyOrder(order: OrderDto, user: User) {
    this.logger.debug(`Creating buy order for user: ${user.id}, coinId: ${order.coinId}`);

    const coin = await this.coin.getCoinById(order.coinId); // TODO: Get price using price service
    // const price = await this.binance.getPriceBySymbol(`${coin.symbol.toUpperCase()}/USDT`, user);

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
    const symbol = `${coin.symbol.toUpperCase()}/USDT`;

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
          logo: order.coin.image || '' // Map image to logo for frontend compatibility
        },
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
      }));
    } catch (error) {
      this.logger.error(`Failed to fetch orders: ${error.message}`, error.stack);
      return []; // Return empty array instead of throwing to avoid breaking the frontend
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
      this.logger.error(`Failed to fetch order ${orderId}`, error);
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
          logo: order.coin.image || '' // Map image to logo for frontend compatibility
        },
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
      }));
    } catch (error) {
      this.logger.error(`Failed to fetch open orders: ${error.message}`, error.stack);
      return []; // Return empty array instead of throwing to avoid breaking the frontend
    }
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
      const binance = await this.binance.getBinanceClient(user);

      // CCXT uses different method names for order creation
      const action = await binance.createOrder(
        symbol, // symbol
        'market', // type (lowercase in CCXT)
        side.toLowerCase(), // side (lowercase in CCXT)
        parseFloat(quantity), // amount
        undefined // price (not needed for market orders)
      );

      await this.order.insert({
        clientOrderId: action.clientOrderId || action.id,
        coin,
        executedQuantity: action.filled || parseFloat(quantity),
        orderId: action.id.toString(),
        price: action.price || (action.trades && action.trades.length > 0 ? action.trades[0].price : 0),
        quantity: Number(order.quantity),
        side: side as OrderSide,
        status: this.mapCcxtStatusToOrderStatus(action.status),
        // stopPrice: order.stopPrice ? parseFloat(order.stopPrice) : null,
        symbol: symbol,
        transactTime: action.timestamp ? action.timestamp.toString() : Date.now().toString(),
        type: OrderType.MARKET,
        user
      });
      return action;
    } catch (error) {
      this.logger.error(`Failed to create order: ${error.message}`);
      throw new BadRequestException(`Order creation failed: ${error.message}`);
    }
  }

  // Helper method to map CCXT order statuses to our OrderStatus enum
  private mapCcxtStatusToOrderStatus(ccxtStatus: string): OrderStatus {
    const statusMap: Record<string, OrderStatus> = {
      open: OrderStatus.NEW,
      closed: OrderStatus.FILLED,
      canceled: OrderStatus.CANCELED,
      expired: OrderStatus.EXPIRED,
      rejected: OrderStatus.REJECTED
    };

    return statusMap[ccxtStatus] || OrderStatus.NEW;
  }

  private async getExchangeInfo(symbol: string, user?: User) {
    const binance = await this.binance.getBinanceClient(user);
    // CCXT uses fetchMarkets instead of exchangeInfo
    const markets = await binance.fetchMarkets();

    // Find the specific market that matches our symbol
    const market = markets.find((m) => m.id === symbol);
    if (!market) {
      throw new BadRequestException(`Symbol ${symbol} not found`);
    }

    // Transform to match original binance-api-node structure
    return {
      symbols: [this.transformMarketToSymbolInfo(market)]
    };
  }

  private transformMarketToSymbolInfo(market: ccxt.Market) {
    // Transform CCXT market info into format similar to Binance API
    return {
      symbol: market.id,
      status: market.active ? 'TRADING' : 'BREAK',
      permissions: market.active ? ['SPOT'] : [],
      quotePrecision: market.precision.price,
      filters: [
        {
          filterType: 'PRICE_FILTER',
          minPrice: market.limits.price?.min?.toString() || '0',
          maxPrice: market.limits.price?.max?.toString() || '1000000',
          tickSize: market.precision.price?.toString() || '0.00000001'
        },
        {
          filterType: 'LOT_SIZE',
          minQty: market.limits.amount?.min?.toString() || '0.00000100',
          maxQty: market.limits.amount?.max?.toString() || '9000000',
          stepSize: market.precision.amount?.toString() || '0.00000001'
        },
        {
          filterType: 'MIN_NOTIONAL',
          minNotional: market.limits.cost?.min?.toString() || '10'
        }
      ]
    };
  }

  private getSymbolFilters(
    filters: { filterType: string; [key: string]: string | number | boolean }[]
  ): SymbolValidationFilters {
    const priceFilterObj = filters.find((f) => f.filterType === 'PRICE_FILTER') as {
      filterType: string;
      [key: string]: string | number | boolean;
    };
    const lotSizeFilterObj = filters.find((f) => f.filterType === 'LOT_SIZE') as {
      filterType: string;
      [key: string]: string | number | boolean;
    };
    const minNotionalFilterObj = filters.find((f) => f.filterType === 'MIN_NOTIONAL') as {
      filterType: string;
      [key: string]: string | number | boolean;
    };

    // Create properly typed filter objects
    const priceFilter: SymbolPriceFilter = {
      filterType: 'PRICE_FILTER',
      minPrice: priceFilterObj?.minPrice?.toString() || '0',
      maxPrice: priceFilterObj?.maxPrice?.toString() || '1000000',
      tickSize: priceFilterObj?.tickSize?.toString() || '0.00000001'
    };

    const lotSizeFilter: SymbolLotSizeFilter = {
      filterType: 'LOT_SIZE',
      minQty: lotSizeFilterObj?.minQty?.toString() || '0.00000100',
      maxQty: lotSizeFilterObj?.maxQty?.toString() || '9000000',
      stepSize: lotSizeFilterObj?.stepSize?.toString() || '0.00000001'
    };

    const minNotionalFilter: SymbolMinNotionalFilter = {
      filterType: 'MIN_NOTIONAL',
      minNotional: minNotionalFilterObj?.minNotional?.toString() || '10'
    };

    return {
      priceFilter,
      lotSizeFilter,
      minNotionalFilter
    };
  }

  private validateSymbolStatus(symbol: { status: string; permissions?: string[] }): void {
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

        const minNotional = parseFloat(filters.minNotionalFilter.minNotional);
        const notionalValue = quantity * price;
        if (notionalValue < minNotional) {
          throw new BadRequestException(`Order value ${notionalValue} is below minimum allowed ${minNotional}`);
        }
      }

      // Use number for precision to avoid 'any' type issues
      const quotePrecision =
        typeof symbolInfo.quotePrecision === 'number'
          ? symbolInfo.quotePrecision
          : parseInt(symbolInfo.quotePrecision as unknown as string, 10);

      order.quantity = this.validateAndAdjustQuantity(quantity, filters, quotePrecision);
      return order;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Exchange validation failed: ${error.message}`);
    }
  }

  /**
   * Synchronizes orders from exchange for a specific user
   * @param user The user to sync orders for
   * @returns The number of new orders synced
   */
  async syncOrdersForUser(user: User): Promise<number> {
    try {
      this.logger.log(`Syncing orders for user: ${user.id}`);

      // Get exchange keys for the user
      const exchangeKeys = await this.exchangeKeyService.hasSupportedExchangeKeys(user.id);
      if (!exchangeKeys || exchangeKeys.length === 0) {
        this.logger.debug(`No active exchange keys found for user: ${user.id}`);
        return 0;
      }

      let totalNewOrders = 0;

      // For Binance exchange
      try {
        const binanceClient = await this.binance.getBinanceClient(user);
        if (!binanceClient) {
          this.logger.debug(`No valid Binance client for user: ${user.id}`);
          return 0;
        }

        // Get the most recent order from DB for this user
        const mostRecentOrder = await this.order.findOne({
          where: { user: { id: user.id } },
          order: { transactTime: 'DESC' }
        });

        // Use the exchange API to fetch historical orders
        const newOrders = await this.fetchHistoricalOrders(binanceClient, user, mostRecentOrder?.transactTime);

        if (newOrders.length > 0) {
          totalNewOrders += await this.saveExchangeOrders(newOrders, user);
          this.logger.log(`Synced ${newOrders.length} orders for user: ${user.id}`);
        }
      } catch (error) {
        this.logger.error(`Error syncing Binance orders for user ${user.id}: ${error.message}`, error.stack);
      }

      return totalNewOrders;
    } catch (error) {
      this.logger.error(`Failed to sync orders for user ${user.id}: ${error.message}`, error.stack);
      return 0;
    }
  }

  /**
   * Synchronize orders for all users with active exchange keys
   * @returns The number of orders synced
   */
  async syncOrdersForAllUsers(): Promise<number> {
    try {
      // This requires the Users service - add it to the constructor if not already injected
      const users = await this.usersService.getUsersWithActiveExchangeKeys();
      let totalSynced = 0;

      for (const user of users) {
        try {
          const syncCount = await this.syncOrdersForUser(user);
          totalSynced += syncCount;
        } catch (error) {
          this.logger.error(`Failed to sync orders for user ${user.id}: ${error.message}`, error.stack);
          // Continue with next user even if one fails
        }
      }

      return totalSynced;
    } catch (error) {
      this.logger.error(`Failed to sync orders for all users: ${error.message}`, error.stack);
      return 0;
    }
  }

  /**
   * Fetch recent orders from exchange
   * @param client CCXT exchange client
   * @returns Array of recent orders
   */
  private async getRecentExchangeOrders(client: ccxt.Exchange): Promise<ccxt.Order[]> {
    try {
      // Fetch the recent orders (past day)
      const since = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago

      // Get all market symbols since Binance US requires a symbol parameter
      const markets = await client.loadMarkets();
      let allOrders: ccxt.Order[] = [];

      // Try to fetch orders for each symbol
      for (const symbol of Object.keys(markets)) {
        try {
          const symbolOrders = await client.fetchOrders(symbol, since);
          allOrders = [...allOrders, ...symbolOrders];
        } catch (innerError: unknown) {
          // Skip symbols that fail and continue
          if (innerError instanceof Error) {
            this.logger.debug(`Failed to fetch orders for ${symbol}: ${innerError.message}`);
          } else {
            this.logger.debug(`Failed to fetch orders for ${symbol}: Unknown error`);
          }
        }
      }

      return allOrders;
    } catch (error: unknown) {
      if (error instanceof Error) {
        this.logger.error(`Failed to fetch recent orders: ${error.message}`, error.stack);
      } else {
        this.logger.error(`Failed to fetch recent orders: Unknown error`);
      }
      return [];
    }
  }

  /**
   * Fetch historical orders from the exchange
   * @param client CCXT exchange client
   * @param user The user to fetch orders for
   * @param lastSyncTime The timestamp of the most recent order in DB
   * @returns Array of new orders from exchange
   */
  private async fetchHistoricalOrders(client: ccxt.Exchange, user: User, lastSyncTime?: Date): Promise<ccxt.Order[]> {
    try {
      // If we have a last sync time, use it as the starting point
      const since = lastSyncTime ? new Date(lastSyncTime).getTime() : undefined;

      // Get all market symbols
      const markets = await client.loadMarkets();
      let allOrders: ccxt.Order[] = [];

      // Directly use per-symbol approach since Binance US requires a symbol parameter
      this.logger.debug('Fetching orders per symbol');

      // Fetch orders for each symbol
      for (const symbol of Object.keys(markets)) {
        try {
          const symbolOrders = await client.fetchOrders(symbol, since);
          allOrders = [...allOrders, ...symbolOrders];
        } catch (innerError: unknown) {
          // Skip symbols that fail and continue
          if (innerError instanceof Error) {
            this.logger.debug(`Failed to fetch orders for ${symbol}: ${innerError.message}`);
          } else {
            this.logger.debug(`Failed to fetch orders for ${symbol}: Unknown error`);
          }
        }
      }

      // Remove duplicates based on order ID
      const uniqueOrders: ccxt.Order[] = [];
      const seenOrderIds = new Set<string | number>();

      for (const order of allOrders) {
        if (!seenOrderIds.has(order.id)) {
          seenOrderIds.add(order.id);
          uniqueOrders.push(order);
        }
      }

      return uniqueOrders;
    } catch (error: unknown) {
      if (error instanceof Error) {
        this.logger.error(`Failed to fetch historical orders: ${error.message}`, error.stack);
      } else {
        this.logger.error(`Failed to fetch historical orders: Unknown error`);
      }
      return [];
    }
  }

  /**
   * Save exchange orders to the database
   * @param exchangeOrders Array of orders from exchange
   * @param user The user who owns the orders
   * @returns Number of new orders saved
   */
  private async saveExchangeOrders(exchangeOrders: ccxt.Order[], user: User): Promise<number> {
    try {
      let savedCount = 0;

      for (const exchangeOrder of exchangeOrders) {
        try {
          // Skip orders we already have
          const existingOrder = await this.order.findOne({
            where: {
              orderId: exchangeOrder.id.toString(),
              user: { id: user.id }
            }
          });

          if (existingOrder) {
            // Update the status if it has changed
            if (existingOrder.status !== this.mapCcxtStatusToOrderStatus(exchangeOrder.status)) {
              await this.order.update(existingOrder.id, {
                status: this.mapCcxtStatusToOrderStatus(exchangeOrder.status),
                executedQuantity: exchangeOrder.filled || exchangeOrder.amount || 0
              });
            }
            continue;
          }

          // Get the coin for this order
          const coinSymbol = this.extractBaseCoinSymbol(exchangeOrder.symbol);
          const coin = await this.coin.getCoinBySymbol(coinSymbol);

          if (!coin) {
            this.logger.debug(`Could not find coin for symbol ${coinSymbol}, skipping order ${exchangeOrder.id}`);
            continue;
          }

          // Create new order
          const newOrder = this.order.create({
            clientOrderId: exchangeOrder.clientOrderId || exchangeOrder.id,
            coin,
            executedQuantity: exchangeOrder.filled || 0,
            orderId: exchangeOrder.id.toString(),
            price:
              exchangeOrder.price ||
              (exchangeOrder.trades && exchangeOrder.trades.length > 0 ? exchangeOrder.trades[0].price : 0),
            quantity: exchangeOrder.amount,
            side: exchangeOrder.side === 'buy' ? OrderSide.BUY : OrderSide.SELL,
            status: this.mapCcxtStatusToOrderStatus(exchangeOrder.status),
            symbol: exchangeOrder.symbol,
            transactTime: new Date(exchangeOrder.timestamp),
            type: this.mapCcxtOrderTypeToOrderType(exchangeOrder.type),
            user
          });

          await this.order.save(newOrder);
          savedCount++;
        } catch (error) {
          this.logger.error(`Failed to save order ${exchangeOrder.id}: ${error.message}`, error.stack);
          // Continue with next order
        }
      }

      return savedCount;
    } catch (error) {
      this.logger.error(`Failed to save exchange orders: ${error.message}`, error.stack);
      return 0;
    }
  }

  /**
   * Extract the base coin symbol from a CCXT market symbol
   * @param marketSymbol Market symbol (e.g., "BTC/USDT")
   * @returns Base coin symbol (e.g., "BTC")
   */
  private extractBaseCoinSymbol(marketSymbol: string): string {
    try {
      // CCXT typically uses format like "BTC/USDT"
      if (marketSymbol.includes('/')) {
        return marketSymbol.split('/')[0];
      }

      // Some exchanges use format like "BTCUSDT"
      const match = marketSymbol.match(/^([A-Z0-9]{3,})([A-Z0-9]{3,})$/);
      if (match) {
        return match[1];
      }

      return marketSymbol;
    } catch (error) {
      this.logger.error(`Failed to extract base coin symbol from ${marketSymbol}: ${error.message}`);
      return marketSymbol;
    }
  }

  /**
   * Map CCXT order type to our OrderType enum
   * @param ccxtType CCXT order type
   * @returns OrderType enum value
   */
  private mapCcxtOrderTypeToOrderType(ccxtType: string): OrderType {
    const typeMap: Record<string, OrderType> = {
      limit: OrderType.LIMIT,
      market: OrderType.MARKET,
      stop: OrderType.STOP,
      stop_loss: OrderType.STOP,
      stop_loss_limit: OrderType.STOP_LOSS_LIMIT,
      take_profit: OrderType.TAKE_PROFIT_LIMIT,
      take_profit_limit: OrderType.TAKE_PROFIT_LIMIT
    };

    return typeMap[ccxtType?.toLowerCase()] || OrderType.MARKET;
  }

  /**
   * Remove stale orders that are no longer needed
   * @returns Number of orders removed
   */
  async cleanupStaleOrders(): Promise<number> {
    try {
      // Define criteria for stale orders (e.g., canceled orders older than 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const result = await this.order.delete({
        status: OrderStatus.CANCELED,
        updatedAt: thirtyDaysAgo
      });

      return result.affected || 0;
    } catch (error) {
      this.logger.error(`Failed to clean up stale orders: ${error.message}`, error.stack);
      return 0;
    }
  }

  /**
   * Get synchronization status for a user
   * @param user User to check sync status for
   * @returns Sync status information
   */
  async getSyncStatus(user: User) {
    try {
      // Get total orders in the database for this user
      const totalOrders = await this.order.count({
        where: { user: { id: user.id } }
      });

      // Get count of orders by status
      const ordersByStatus = await this.order
        .createQueryBuilder('order')
        .select('order.status', 'status')
        .addSelect('COUNT(order.id)', 'count')
        .where('order.user = :userId', { userId: user.id })
        .groupBy('order.status')
        .getRawMany();

      // Get latest sync time by looking at the most recent order
      const latestOrder = await this.order.findOne({
        where: { user: { id: user.id } },
        order: { transactTime: 'DESC' }
      });

      // Check if user has active exchange keys
      const hasActiveKeys = await this.exchangeKeyService.hasSupportedExchangeKeys(user.id);

      return {
        totalOrders,
        ordersByStatus: ordersByStatus.reduce((acc, curr) => {
          acc[curr.status] = parseInt(curr.count);
          return acc;
        }, {}),
        lastSyncTime: latestOrder?.updatedAt || null,
        hasActiveExchangeKeys: hasActiveKeys.length > 0
      };
    } catch (error) {
      this.logger.error(`Failed to get sync status for user ${user.id}: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to get sync status: ${error.message}`);
    }
  }
}
