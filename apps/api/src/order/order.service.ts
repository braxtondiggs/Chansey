import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import * as ccxt from 'ccxt';
import { async } from 'rxjs';
import { Repository } from 'typeorm';

import { Coin } from './../coin/coin.entity';
import { OrderDto } from './dto/order.dto';
import { Order, OrderSide, OrderStatus, OrderType } from './order.entity';
import { OrderCalculationService } from './services/order-calculation.service';
import { OrderSyncService } from './services/order-sync.service';
import { OrderValidationService } from './services/order-validation.service';
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

// Define type for CCXT order objects
// We're using ccxt.Order instead of a custom interface

// Replace OrderSide_LT with string type
type OrderSide_LT = 'BUY' | 'SELL';

interface SymbolValidationFilters {
  priceFilter: SymbolPriceFilter;
  lotSizeFilter: SymbolLotSizeFilter;
  minNotionalFilter: SymbolMinNotionalFilter;
}

/**
 * Service for managing cryptocurrency orders
 * Handles buying, selling, and retrieving orders from exchanges and database
 */
@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);
  private readonly MIN_QUANTITY = 0.00001;

  constructor(
    @InjectRepository(Order) private readonly orderRepository: Repository<Order>,
    private readonly binanceService: BinanceUSService,
    private readonly coinService: CoinService,
    private readonly tickerPairService: TickerPairService,
    private readonly orderValidationService: OrderValidationService,
    private readonly orderCalculationService: OrderCalculationService,
    private readonly orderSyncService: OrderSyncService
  ) {}

  /**
   * Create a buy order for the specified coin
   * @param order The order details
   * @param user The user placing the order
   * @returns Array of created orders
   */
  async createBuyOrder(order: OrderDto, user: User) {
    this.logger.debug(`Creating buy order for user: ${user.id}, baseCoinId: ${order.baseCoinId}`);

    // Get the base coin from the order
    if (!order.baseCoinId) {
      throw new BadRequestException('Base coin ID is required for buy orders');
    }

    const baseCoin = await this.coinService.getCoinById(order.baseCoinId);
    if (!baseCoin) {
      throw new BadRequestException('Invalid base coin ID');
    }

    const suggestedCoins = await this.coinService.getCoinsByRiskLevel(user);
    const balance = await this.binanceService.getBalance(user);
    const freeBalance = balance.find((b) => b.asset === 'USD');
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
    if (remainingQuantity > this.MIN_QUANTITY) {
      const sortedBalance = balance.sort((a, b) => {
        if (a.asset === 'USD' || a.asset === 'USDT') return -1;
        if (b.asset === 'USD' || b.asset === 'USDT') return 1;
        const coinIndexA = suggestedCoins.findIndex((c) => c.symbol.toUpperCase() === a.asset);
        const coinIndexB = suggestedCoins.findIndex((c) => c.symbol.toUpperCase() === b.asset);
        return coinIndexA - coinIndexB;
      });

      const tickerPairPromise = sortedBalance
        .filter((b) => b.asset !== 'USD' && b.asset.toUpperCase() !== baseCoin.symbol.toUpperCase())
        .map((b) => this.tickerPairService.getTickerPairBySymbol(baseCoin.symbol, b.asset));
      const pairs = await Promise.all(tickerPairPromise);
      const validPairs = pairs.filter((p) => p !== null);

      if (validPairs.length === 0 && parseFloat(freeBalance.free) <= 0) {
        throw new BadRequestException('No valid trading pairs found');
      }

      for (const balance of sortedBalance) {
        if (remainingQuantity < this.MIN_QUANTITY) break;

        const pair = validPairs.find((p) => p.quoteAsset.symbol.toUpperCase() === balance.asset);
        if (!pair) continue;

        const symbol = pair.symbol;
        const availableBalance = Number(parseFloat(balance.free).toFixed(8));
        if (availableBalance < this.MIN_QUANTITY) continue;

        const orderQuantity = Number(Math.min(remainingQuantity, availableBalance).toFixed(8));

        try {
          const validatedOrder = await this.validateOrderForExchange(
            { ...order, quantity: orderQuantity.toString() },
            OrderType.MARKET,
            symbol,
            user
          );

          // Get the actual quantity after step size adjustment
          const actualQuantity = parseFloat(validatedOrder.quantity);
          if (actualQuantity < this.MIN_QUANTITY) {
            continue; // Skip if adjusted quantity is too small
          }

          // Get baseCoin and quoteCoin from the trading pair
          const tickerPair = await this.getTickerPairFromSymbol(symbol);
          const baseCoinFromPair = tickerPair?.baseCoin
            ? await this.coinService.getCoinById(tickerPair.baseCoin.id)
            : baseCoin;
          const quoteCoin = tickerPair?.quoteCoin ? await this.coinService.getCoinById(tickerPair.quoteCoin.id) : null;

          if (!quoteCoin) {
            this.logger.debug(`Could not determine quote coin for symbol ${symbol}, skipping`);
            continue;
          }

          const orderResponse = await this.createOrder(
            symbol,
            validatedOrder.quantity.toString(),
            OrderSide.BUY,
            order,
            baseCoinFromPair,
            quoteCoin,
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
      if (orders.length === 0 && remainingQuantity >= this.MIN_QUANTITY) {
        throw new BadRequestException(`Could not create any valid orders. Remaining: ${remainingQuantity}`);
      }

      // Ignore leftover quantity that cannot be purchased
      if (remainingQuantity < this.MIN_QUANTITY) {
        this.logger.debug(`Ignoring leftover quantity: ${remainingQuantity}`);
      }
    }

    return orders;
  }

  /**
   * Create a sell order for the specified coin
   * @param order The order details
   * @param user The user placing the order
   * @returns Array of created orders
   */
  async createSellOrder(order: OrderDto, user: User) {
    try {
      this.logger.debug(`Creating sell order for user: ${user.id}, baseCoinId: ${order.baseCoinId}`);

      if (!order.baseCoinId) {
        throw new BadRequestException('Base coin ID is required for sell orders');
      }

      const coin = await this.coinService.getCoinById(order.baseCoinId);
      if (!coin) throw new BadRequestException('Invalid base coin ID');

      const balance = await this.binanceService.getBalance(user);
      const coinBalance = balance.find((b) => b.asset === coin.symbol.toUpperCase());

      if (!coinBalance || Number(coinBalance.free) <= 0) {
        throw new BadRequestException(`Insufficient ${coin.symbol.toUpperCase()} balance`);
      }

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
        const validatedOrder = await this.validateOrderForExchange(
          { ...order, quantity: remainingQuantity.toString() },
          OrderType.MARKET,
          symbol,
          user
        );

        const actualQuantity = parseFloat(validatedOrder.quantity);
        if (actualQuantity < this.MIN_QUANTITY) {
          throw new BadRequestException(`Quantity ${actualQuantity} is below minimum allowed ${this.MIN_QUANTITY}`);
        }

        // Get baseCoin and quoteCoin from the trading pair
        const tickerPair = await this.getTickerPairFromSymbol(symbol);
        const baseCoin = tickerPair?.baseCoin ? await this.coinService.getCoinById(tickerPair.baseCoin.id) : coin;
        const quoteCoin = tickerPair?.quoteCoin
          ? await this.coinService.getCoinById(tickerPair.quoteCoin.id)
          : await this.coinService.getCoinBySymbol('USDT');

        if (!quoteCoin) {
          throw new BadRequestException(`Could not determine quote coin for symbol ${symbol}`);
        }

        const orderResponse = await this.createOrder(
          symbol,
          validatedOrder.quantity.toString(),
          OrderSide.SELL,
          order,
          baseCoin,
          quoteCoin,
          user
        );

        orders.push(orderResponse);
      } catch (error) {
        this.logger.error(`Sell order failed: ${error.message}`);
        throw new BadRequestException(`Failed to create sell order: ${error.message}`);
      }

      return orders;
    } catch (error) {
      this.logger.error(`Failed to create sell order: ${error.message}`);
      throw new BadRequestException(`Sell order failed: ${error.message}`);
    }
  }

  /**
   * Get all orders for a user with related entities
   * @param user The user whose orders to retrieve
   * @returns Array of orders with trading pairs
   */
  async getOrders(user: User) {
    try {
      // Query database for orders with baseCoin, quoteCoin and exchange relationships loaded
      const orders = await this.orderRepository.find({
        where: { user: { id: user.id } },
        relations: ['baseCoin', 'quoteCoin', 'exchange'],
        order: { transactTime: 'DESC' }
      });

      // Transform to match frontend expectations with trading pairs
      const ordersWithPairs = await Promise.all(
        orders.map(async (order) => {
          // Load missing coin information if needed
          const { baseCoin, quoteCoin } = await this.loadMissingCoinInfo(order);
          return this.transformOrderToResponse(order, baseCoin, quoteCoin);
        })
      );

      return ordersWithPairs;
    } catch (error) {
      this.logger.error(`Failed to fetch orders: ${error.message}`, error.stack);
      return []; // Return empty array instead of throwing to avoid breaking the frontend
    }
  }

  /**
   * Get a specific order by id for a user
   * @param user The user who owns the order
   * @param orderId The id of the order to retrieve
   * @returns The requested order with related entities
   * @throws NotFoundCustomException if order not found
   */
  async getOrder(user: User, orderId: string) {
    try {
      // Query order from database with baseCoin, quoteCoin and exchange relationships
      const order = await this.orderRepository.findOne({
        where: { id: orderId, user: { id: user.id } },
        relations: ['baseCoin', 'quoteCoin', 'exchange']
      });

      if (!order) throw new NotFoundCustomException('Order', { id: orderId });

      // Load missing coin information if needed
      const { baseCoin, quoteCoin } = await this.loadMissingCoinInfo(order);

      // Transform to match frontend expectations
      return this.transformOrderToResponse(order, baseCoin, quoteCoin);
    } catch (error) {
      this.logger.error(`Failed to fetch order ${orderId}`, error);
      throw new NotFoundCustomException('Order', { id: orderId.toString() });
    }
  }

  /**
   * Get all open orders for a user
   * @param user The user whose open orders to retrieve
   * @returns Array of open orders with related entities
   */
  async getOpenOrders(user: User) {
    try {
      // Query database for open orders with baseCoin, quoteCoin and exchange relationships
      const openOrders = await this.orderRepository.find({
        where: {
          user: { id: user.id },
          status: OrderStatus.NEW // Only fetch orders with "NEW" status
        },
        relations: ['baseCoin', 'quoteCoin', 'exchange'],
        order: { transactTime: 'DESC' }
      });

      // Transform to match frontend expectations with trading pairs
      const ordersWithPairs = openOrders.map((order) => this.transformOrderToResponse(order));

      return ordersWithPairs;
    } catch (error) {
      this.logger.error(`Failed to fetch open orders: ${error.message}`, error.stack);
      return []; // Return empty array instead of throwing to avoid breaking the frontend
    }
  }

  /**
   * Create an order on the exchange and store it in the database
   * @param symbol Trading pair symbol
   * @param quantity Amount to buy/sell
   * @param side Order side (BUY or SELL)
   * @param order Original order DTO
   * @param baseCoin Base coin entity
   * @param quoteCoin Quote coin entity
   * @param user User who is placing the order
   * @returns Response from the exchange API
   */
  private async createOrder(
    symbol: string,
    quantity: string,
    side: OrderSide_LT,
    order: OrderDto,
    baseCoin: Coin,
    quoteCoin: Coin,
    user: User
  ) {
    try {
      const binance = await this.binanceService.getBinanceClient(user);

      // CCXT uses different method names for order creation
      const action = await binance.createOrder(symbol, 'market', side.toLowerCase(), parseFloat(quantity), undefined);

      await this.orderRepository.insert({
        clientOrderId: action.clientOrderId || action.id,
        baseCoin,
        quoteCoin,
        executedQuantity: action.filled || parseFloat(quantity),
        orderId: action.id.toString(),
        price: action.price || (action.trades && action.trades.length > 0 ? action.trades[0].price : 0),
        quantity: Number(order.quantity),
        side: side as OrderSide,
        status: this.orderCalculationService.mapCcxtStatusToOrderStatus(action.status),
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

  /**
   * Get exchange information for a trading symbol
   * @param symbol Trading pair symbol
   * @param user Optional user context for client initialization
   * @returns Object containing symbol information in Binance-compatible format
   * @throws BadRequestException if symbol not found
   */
  private async getExchangeInfo(symbol: string, user?: User) {
    const binance = await this.binanceService.getBinanceClient(user);
    // CCXT uses fetchMarkets instead of exchangeInfo
    const markets = await binance.fetchMarkets();

    // Find the specific market that matches our symbol
    const market = markets.find((m) => m.id === symbol);
    if (!market) {
      throw new BadRequestException(`Symbol ${symbol} not found`);
    }

    // Transform to match original binance-api-node structure
    return {
      symbols: [this.orderValidationService.transformMarketToSymbolInfo(market)]
    };
  }

  /**
   * Delegate validation and adjustment of quantity to OrderValidationService
   * @param quantity The order quantity to validate
   * @param filters The symbol filters to apply
   * @param precision The decimal precision to use
   * @returns Validated and adjusted quantity as a string
   */
  private validateAndAdjustQuantity(quantity: number, filters: SymbolValidationFilters, precision: number): string {
    return this.orderValidationService.validateAndAdjustQuantity(quantity, filters, precision);
  }

  /**
   * Extract trading pair information from order symbol
   * @param symbol Trading pair symbol (e.g., "BTCUSDT", "BTC/USDT")
   * @returns Object with base and quote coin information or null if not found
   */
  private async getTickerPairFromSymbol(symbol: string): Promise<{
    baseCoin: Coin;
    quoteCoin: Coin;
  } | null> {
    try {
      // Normalize symbol - remove / if present and convert to uppercase
      const normalizedSymbol = symbol.replace('/', '').toUpperCase();

      // Try to find the ticker pair
      const tickerPair = await this.tickerPairService.getTickerPairs();
      const foundPair = tickerPair.find((pair) => pair.symbol === normalizedSymbol);

      if (foundPair) {
        return {
          baseCoin: foundPair.baseAsset,
          quoteCoin: foundPair.quoteAsset
        };
      }

      // If we can't find the exact symbol, try to extract base and quote manually
      const { base, quote } = this.orderCalculationService.extractCoinSymbol(symbol);
      if (base && quote) {
        try {
          const baseCoin = await this.coinService.getCoinBySymbol(base, undefined, false);
          const quoteCoin = await this.coinService.getCoinBySymbol(quote, undefined, false);

          if (baseCoin && quoteCoin) {
            return { baseCoin, quoteCoin };
          }
        } catch (extractError) {
          this.logger.debug(`Failed to extract coins from symbol parts: ${extractError.message}`);
        }
      }

      return null;
    } catch (error) {
      this.logger.error(`Failed to parse ticker pair from symbol ${symbol}: ${error.message}`);
      return null;
    }
  }

  /**
   * Validates an order against exchange requirements
   * @param order Order DTO to validate
   * @param orderType Type of order (MARKET, LIMIT, etc.)
   * @param symbol Trading pair symbol
   * @param user Optional user context
   * @returns Validated order with adjusted values
   */
  private async validateOrderForExchange(
    order: OrderDto | TestnetDto,
    orderType: OrderType,
    symbol: string,
    user?: User
  ): Promise<OrderDto | TestnetDto> {
    try {
      const { symbols } = await this.getExchangeInfo(symbol, user);
      const symbolInfo = symbols[0];
      return this.orderValidationService.validateExchangeOrder(order, orderType, symbolInfo);
    } catch (error) {
      this.logger.error(`Order validation failed for ${symbol}: ${error.message}`);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to validate order: ${error.message}`);
    }
  }

  /**
   * Transform an Order entity into a response object for the frontend
   * @param order The database Order entity
   * @param baseCoin Optional base coin if not included in order
   * @param quoteCoin Optional quote coin if not included in order
   * @returns Transformed order response
   */
  private transformOrderToResponse(
    order: Order,
    baseCoin?: Coin | null,
    quoteCoin?: Coin | null
  ): Record<string, unknown> {
    return {
      ...order,
      baseCoin: baseCoin || order.baseCoin,
      quoteCoin: quoteCoin || order.quoteCoin
    };
  }

  /**
   * Load missing coin information for an order using the symbol
   * @param order Order entity that may have missing coin information
   * @returns Object containing base and quote coins
   */
  private async loadMissingCoinInfo(order: Order): Promise<{
    baseCoin: Coin | null;
    quoteCoin: Coin | null;
  }> {
    let baseCoin = order.baseCoin;
    let quoteCoin = order.quoteCoin;

    if (!order.baseCoin || !order.quoteCoin) {
      try {
        // Use symbol as fallback when baseCoin or quoteCoin is null
        const { base, quote } = this.orderCalculationService.extractCoinSymbol(order.symbol);

        // Only fetch if the current value is null/undefined
        if (!baseCoin && base) {
          baseCoin = await this.coinService.getCoinBySymbol(base, undefined, false);
        }
        if (!quoteCoin && quote) {
          quoteCoin = await this.coinService.getCoinBySymbol(quote, undefined, false);
        }
      } catch (error) {
        this.logger.warn(`Failed to fetch coins for order ${order.id}: ${error.message}`);
        // Continue with null values
      }
    }

    return { baseCoin, quoteCoin };
  }
}
