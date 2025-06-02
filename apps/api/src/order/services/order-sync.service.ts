import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import * as ccxt from 'ccxt';
import { Repository } from 'typeorm';

import { Exchange } from '@chansey/api-interfaces';

import { OrderCalculationService } from './order-calculation.service';

import { Coin } from '../../coin/coin.entity';
import { CoinService } from '../../coin/coin.service';
import { TickerPairService } from '../../coin/ticker-pairs/ticker-pairs.service';
import { BinanceUSService } from '../../exchange/binance/binance-us.service';
import { CoinbaseService } from '../../exchange/coinbase/coinbase.service';
import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { ExchangeService } from '../../exchange/exchange.service';
import { User } from '../../users/users.entity';
import { Order, OrderSide, OrderStatus } from '../order.entity';

@Injectable()
export class OrderSyncService {
  private readonly logger = new Logger(OrderSyncService.name);

  constructor(
    @InjectRepository(Order) private readonly orderRepository: Repository<Order>,
    private readonly calculationService: OrderCalculationService,
    private readonly coinService: CoinService,
    private readonly exchangeService: ExchangeService,
    private readonly tickerPairService: TickerPairService,
    private readonly exchangeKeyService: ExchangeKeyService,
    private readonly binanceService: BinanceUSService,
    private readonly coinbaseService: CoinbaseService
  ) {}

  /**
   * Fetch historical orders from exchange
   */
  async fetchHistoricalOrders(client: ccxt.Exchange, lastSyncTime?: Date): Promise<ccxt.Order[]> {
    try {
      const since = lastSyncTime ? new Date(lastSyncTime).getTime() : undefined;
      const markets = await client.loadMarkets();
      const allOrders: ccxt.Order[] = [];

      for (const symbol of Object.keys(markets)) {
        try {
          const symbolOrders = await client.fetchOrders(symbol, since);
          allOrders.push(...symbolOrders);
        } catch (error) {
          this.logger.debug(`Failed to fetch orders for ${symbol}: ${error.message}`);
        }
      }

      return this.removeDuplicateOrders(allOrders);
    } catch (error) {
      this.logger.error(`Failed to fetch historical orders: ${error.message}`);
      return [];
    }
  }

  /**
   * Save exchange orders to database
   */
  async saveExchangeOrders(exchangeOrders: ccxt.Order[], user: User, exchangeName?: string): Promise<number> {
    let savedCount = 0;

    for (const exchangeOrder of exchangeOrders) {
      try {
        const existingOrder = await this.findExistingOrder(exchangeOrder, user);

        if (existingOrder) {
          const updated = await this.updateExistingOrder(existingOrder, exchangeOrder);
          if (updated) {
            this.logger.debug(`Updated existing order ${exchangeOrder.id}`);
          }
          continue;
        }

        const saved = await this.createNewOrder(exchangeOrder, user, exchangeName);
        if (saved) {
          savedCount++;
          this.logger.debug(`Saved new order ${exchangeOrder.id}`);
        }
      } catch (error) {
        this.logger.error(`Failed to process order ${exchangeOrder.id}: ${error.message}`);
      }
    }

    return savedCount;
  }

  private async findExistingOrder(exchangeOrder: ccxt.Order, user: User): Promise<Order | null> {
    return this.orderRepository.findOne({
      where: {
        orderId: exchangeOrder.id.toString(),
        user: { id: user.id }
      }
    });
  }

  private async updateExistingOrder(existingOrder: Order, exchangeOrder: ccxt.Order): Promise<boolean> {
    const newStatus = this.calculationService.mapCcxtStatusToOrderStatus(exchangeOrder.status);
    const newExecutedQuantity = exchangeOrder.filled || exchangeOrder.amount || 0;
    const feeData = this.calculationService.extractFeeData(exchangeOrder);
    const newPrice = this.calculationService.calculateOrderPrice(exchangeOrder);
    const newCost = this.calculationService.calculateOrderCost(exchangeOrder);
    const newAveragePrice = exchangeOrder.average || null;

    const updateData: Partial<Order> = {};
    let hasChanges = false;

    if (existingOrder.status !== newStatus) {
      updateData.status = newStatus;
      hasChanges = true;
    }

    if (existingOrder.executedQuantity !== newExecutedQuantity) {
      updateData.executedQuantity = newExecutedQuantity;
      hasChanges = true;
    }

    if (Math.abs(existingOrder.price - newPrice) > 0.00000001) {
      updateData.price = newPrice;
      hasChanges = true;
    }

    if (feeData.fee > 0 && existingOrder.fee !== feeData.fee) {
      updateData.fee = feeData.fee;
      updateData.commission = feeData.commission;
      if (feeData.feeCurrency) {
        updateData.feeCurrency = feeData.feeCurrency;
      }
      hasChanges = true;
    }

    if (newCost > 0 && (!existingOrder.cost || Math.abs(existingOrder.cost - newCost) > 0.00000001)) {
      updateData.cost = newCost;
      hasChanges = true;
    }

    if (
      newAveragePrice &&
      (!existingOrder.averagePrice || Math.abs(existingOrder.averagePrice - newAveragePrice) > 0.00000001)
    ) {
      updateData.averagePrice = newAveragePrice;
      hasChanges = true;
    }

    if (hasChanges) {
      await this.orderRepository.update(existingOrder.id, updateData);
      return true;
    }

    return false;
  }

  private async createNewOrder(exchangeOrder: ccxt.Order, user: User, exchangeName?: string): Promise<boolean> {
    try {
      // Get coin information
      const { base: coinSymbol } = this.calculationService.extractCoinSymbol(exchangeOrder.symbol);
      const coin = await this.coinService.getCoinBySymbol(coinSymbol, null, false);

      // Calculate order data
      const price = this.calculationService.calculateOrderPrice(exchangeOrder);
      const feeData = this.calculationService.extractFeeData(exchangeOrder);
      const cost = this.calculationService.calculateOrderCost(exchangeOrder);
      const gainLoss = this.calculationService.calculateGainLoss(exchangeOrder, feeData);

      // Get exchange information
      const exchange = await this.getExchangeForOrder(exchangeOrder, exchangeName);

      // Get trading pair coins
      const { baseCoin, quoteCoin } = await this.getTradingPairCoins(exchangeOrder.symbol, coin);

      // Extract algorithmic trading fields
      const algorithmicFields = this.extractAlgorithmicTradingFields(exchangeOrder);

      const newOrder = this.orderRepository.create({
        clientOrderId: exchangeOrder.clientOrderId || exchangeOrder.id.toString(),
        baseCoin,
        quoteCoin,
        executedQuantity: exchangeOrder.filled || 0,
        orderId: exchangeOrder.id.toString(),
        price: price || 0,
        quantity: exchangeOrder.amount || 0,
        side: exchangeOrder.side === 'buy' ? OrderSide.BUY : OrderSide.SELL,
        status: this.calculationService.mapCcxtStatusToOrderStatus(exchangeOrder.status),
        symbol: exchangeOrder.symbol,
        transactTime: new Date(exchangeOrder.timestamp),
        type: this.calculationService.mapCcxtOrderTypeToOrderType(exchangeOrder.type),
        user,
        cost: cost > 0 ? cost : null,
        fee: feeData.fee || 0,
        commission: feeData.commission || 0,
        feeCurrency: feeData.feeCurrency,
        gainLoss: gainLoss,
        averagePrice: exchangeOrder.average || null,
        exchange: exchange,
        ...algorithmicFields
      });

      await this.orderRepository.save(newOrder);
      return true;
    } catch (error) {
      this.logger.error(`Failed to create new order: ${error.message}`);
      return false;
    }
  }

  private async getExchangeForOrder(exchangeOrder: ccxt.Order, exchangeName?: string): Promise<Exchange | null> {
    try {
      if (exchangeName) {
        return await this.exchangeService.getExchangeByName(exchangeName);
      }

      if (exchangeOrder.info?.exchange) {
        const exchangeNameFromOrder = exchangeOrder.info.exchange.toLowerCase();
        if (exchangeNameFromOrder.includes('binance')) {
          return await this.exchangeService.getExchangeByName('Binance US');
        } else if (exchangeNameFromOrder.includes('coinbase') || exchangeNameFromOrder.includes('gdax')) {
          return await this.exchangeService.getExchangeByName('Coinbase');
        }
      }

      return null;
    } catch (error) {
      this.logger.error(`Error identifying exchange for order ${exchangeOrder.id}: ${error.message}`);
      return null;
    }
  }

  private async getTradingPairCoins(
    symbol: string,
    fallbackCoin?: Coin
  ): Promise<{ baseCoin: Coin | null; quoteCoin: Coin | null }> {
    try {
      const { base: baseCoinSymbol, quote: quoteCoinSymbol } = this.calculationService.extractCoinSymbol(symbol);
      const tickerPair = await this.tickerPairService.getTickerPairBySymbol(baseCoinSymbol, quoteCoinSymbol);

      if (tickerPair) {
        const baseCoin = await this.coinService.getCoinById(tickerPair.baseAsset.id);
        const quoteCoin = await this.coinService.getCoinById(tickerPair.quoteAsset.id);
        return { baseCoin, quoteCoin };
      }

      return { baseCoin: fallbackCoin || null, quoteCoin: null };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to load coins from ticker pair: ${errorMessage}`);
      return { baseCoin: fallbackCoin || null, quoteCoin: null };
    }
  }

  private extractAlgorithmicTradingFields(exchangeOrder: ccxt.Order): Partial<Order> {
    const fields: Partial<Order> = {};

    if (exchangeOrder.timeInForce) {
      fields.timeInForce = exchangeOrder.timeInForce as string;
    }

    if (exchangeOrder.stopPrice && exchangeOrder.stopPrice > 0) {
      fields.stopPrice = exchangeOrder.stopPrice;
    }

    if (exchangeOrder.remaining !== undefined && exchangeOrder.remaining !== null) {
      fields.remaining = exchangeOrder.remaining;
    } else if (exchangeOrder.amount && exchangeOrder.filled) {
      fields.remaining = exchangeOrder.amount - exchangeOrder.filled;
    }

    if (exchangeOrder.postOnly !== undefined) {
      fields.postOnly = exchangeOrder.postOnly;
    }

    if (exchangeOrder.reduceOnly !== undefined) {
      fields.reduceOnly = exchangeOrder.reduceOnly;
    }

    // Extract from info object for exchange-specific fields
    if (exchangeOrder.info && typeof exchangeOrder.info === 'object') {
      const info = exchangeOrder.info as Record<string, string | number>;

      if (info.triggerPrice && parseFloat(info.triggerPrice.toString()) > 0) {
        fields.triggerPrice = parseFloat(info.triggerPrice.toString());
      }

      if (info.takeProfitPrice && parseFloat(info.takeProfitPrice.toString()) > 0) {
        fields.takeProfitPrice = parseFloat(info.takeProfitPrice.toString());
      }

      if (info.stopLossPrice && parseFloat(info.stopLossPrice.toString()) > 0) {
        fields.stopLossPrice = parseFloat(info.stopLossPrice.toString());
      }

      if (info.updateTime) {
        fields.lastUpdateTimestamp = new Date(parseInt(info.updateTime.toString()));
      }
    }

    // Store trades and info as JSONB
    if (exchangeOrder.trades && exchangeOrder.trades.length > 0) {
      fields.trades = exchangeOrder.trades.map((trade) => ({
        id: trade.id,
        timestamp: trade.timestamp,
        amount: trade.amount,
        price: trade.price,
        cost: trade.cost,
        side: trade.side,
        fee: trade.fee ? { cost: trade.fee.cost, currency: trade.fee.currency } : null,
        takerOrMaker: trade.takerOrMaker
      }));

      const lastTrade = exchangeOrder.trades[exchangeOrder.trades.length - 1];
      if (lastTrade.timestamp) {
        fields.lastTradeTimestamp = new Date(lastTrade.timestamp);
      }
    }

    if (exchangeOrder.info && typeof exchangeOrder.info === 'object') {
      const cleanInfo = { ...exchangeOrder.info };
      delete cleanInfo.fills; // Remove potential duplicates
      fields.info = cleanInfo;
    }

    return fields;
  }

  private removeDuplicateOrders(orders: ccxt.Order[]): ccxt.Order[] {
    const uniqueOrders: ccxt.Order[] = [];
    const seenOrderIds = new Set<string | number>();

    for (const order of orders) {
      if (!seenOrderIds.has(order.id)) {
        seenOrderIds.add(order.id);
        uniqueOrders.push(order);
      }
    }

    return uniqueOrders;
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

      // Define exchange configurations
      const exchangeConfigs = [
        {
          name: 'Binance',
          client: await this.binanceService.getBinanceClient(user),
          service: this.binanceService
        },
        {
          name: 'Coinbase',
          client: await this.coinbaseService.getCoinbaseClient(user),
          service: this.coinbaseService
        }
      ];

      // Process each exchange
      for (const config of exchangeConfigs) {
        try {
          if (config.client) {
            const syncCount = await this.syncOrdersForExchange(user, config.name, config.client);
            totalNewOrders += syncCount;

            if (syncCount > 0) {
              this.logger.log(`Synced ${syncCount} ${config.name} orders for user: ${user.id}`);
            }
          } else {
            this.logger.debug(`No valid ${config.name} client for user: ${user.id}`);
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const errorStack = error instanceof Error ? error.stack : undefined;
          this.logger.error(`Error syncing ${config.name} orders for user ${user.id}: ${errorMessage}`, errorStack);
        }
      }

      return totalNewOrders;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to sync orders for user ${user.id}: ${errorMessage}`, errorStack);
      return 0;
    }
  }

  /**
   * Synchronizes orders from a specific exchange for a user
   * @param user The user to sync orders for
   * @param exchangeName The name of the exchange
   * @param client The exchange client
   * @returns The number of new orders synced
   */
  private async syncOrdersForExchange(user: User, exchangeName: string, client: ccxt.Exchange): Promise<number> {
    // Get the most recent order from DB for this user and exchange
    const mostRecentOrder = await this.orderRepository.findOne({
      where: {
        user: { id: user.id },
        exchange: { name: exchangeName }
      },
      order: { transactTime: 'DESC' }
    });

    // Use the exchange API to fetch historical orders
    const newOrders = await this.fetchHistoricalOrders(client, mostRecentOrder?.transactTime);

    if (newOrders.length > 0) {
      return await this.saveExchangeOrders(newOrders, user, exchangeName);
    }

    return 0;
  }

  /**
   * Synchronize orders for all users with active exchange keys
   * @returns The number of orders synced
   */
  async syncOrdersForAllUsers(): Promise<number> {
    try {
      // Get users with active exchange keys through the users service
      // Note: We'll need to inject UsersService to make this work
      // For now, return 0 and log that this needs implementation
      this.logger.warn('syncOrdersForAllUsers needs UsersService injection to work properly');
      return 0;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to sync orders for all users: ${errorMessage}`, errorStack);
      return 0;
    }
  }
}
