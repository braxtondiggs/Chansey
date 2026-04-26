import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import * as ccxt from 'ccxt';
import { QueryDeepPartialEntity, Repository } from 'typeorm';

import { Exchange } from '@chansey/api-interfaces';

import { OrderCalculationService } from './order-calculation.service';
import { OrderStateMachineService } from './order-state-machine.service';
import { PositionManagementService } from './position-management.service';

import { Coin } from '../../coin/coin.entity';
import { CoinService } from '../../coin/coin.service';
import { TickerPairService } from '../../coin/ticker-pairs/ticker-pairs.service';
import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { ExchangeService } from '../../exchange/exchange.service';
import { MetricsService } from '../../metrics/metrics.service';
import { toErrorInfo } from '../../shared/error.util';
import { withExchangeRetry, withExchangeRetryThrow } from '../../shared/retry.util';
import { User } from '../../users/users.entity';
import { OrderTransitionReason } from '../entities/order-status-history.entity';
import { Order, OrderSide, OrderStatus } from '../order.entity';
import {
  convertTradesToOrders,
  extractAlgorithmicTradingFields,
  extractFuturesFields
} from '../utils/order-mapping.util';

// Per-symbol stagger inside `fetchFromExchange`. CCXT's `enableRateLimit: true`
// (set in `ccxt-client.util.ts`) with Binance's `rateLimit: 50ms` already gates
// weight-10 calls (`fetchOrders`, `fetchMyTrades`) to a ~500ms minimum spacing
// internally — so the effective rate is ~120 calls/min × 10 = ~1200 weight/min,
// right at the budget. The 250ms JS sleep is a small additive cushion that
// matters only if CCXT's rate limiter degrades; it does NOT by itself reduce
// the call rate below CCXT's floor. The existing `withExchangeRetry` weight-
// limit handler covers any residual -1003 from concurrent OHLC/ticker traffic.
const PER_SYMBOL_STAGGER_MS = 250;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
    private readonly exchangeManager: ExchangeManagerService,
    private readonly metricsService: MetricsService,
    private readonly stateMachineService: OrderStateMachineService,
    @Inject(forwardRef(() => PositionManagementService))
    private readonly positionManagementService: PositionManagementService
  ) {}

  /**
   * Fetch historical orders from exchange
   */
  async fetchHistoricalOrders(client: ccxt.Exchange, lastSyncTime?: Date): Promise<ccxt.Order[]> {
    return this.fetchFromExchange<ccxt.Order>(
      client,
      'fetchOrders',
      (symbol, since) => client.fetchOrders(symbol, since),
      (items) => this.removeDuplicates(items, (o) => String(o.id)),
      'fetchOrders',
      lastSyncTime
    );
  }

  /**
   * Fetch historical trades from exchange using fetchMyTrades
   */
  async fetchMyTrades(client: ccxt.Exchange, lastSyncTime?: Date): Promise<ccxt.Trade[]> {
    return this.fetchFromExchange<ccxt.Trade>(
      client,
      'fetchMyTrades',
      (symbol, since) => client.fetchMyTrades(symbol, since),
      (items) => this.removeDuplicates(items, (t) => String(t.id ?? '')),
      'fetchMyTrades',
      lastSyncTime
    );
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
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Failed to process order ${exchangeOrder.id}: ${err.message}`);
      }
    }

    return savedCount;
  }

  /**
   * Synchronizes orders from exchange for a specific user
   */
  async syncOrdersForUser(user: User): Promise<number> {
    try {
      this.logger.log(`Syncing orders for user: ${user.id}`);

      const exchangeKeys = await this.exchangeKeyService.getSupportedExchangeKeys(user.id);
      if (!exchangeKeys || exchangeKeys.length === 0) {
        this.logger.debug(`No active exchange keys found for user: ${user.id}`);
        return 0;
      }

      let totalNewOrders = 0;

      const userExchangeSlugs = new Set(exchangeKeys.map((k) => k.slug));
      const availableExchanges = (await this.exchangeService.getExchanges({ supported: true })).filter((e) =>
        userExchangeSlugs.has(e.slug)
      );

      this.logger.log(`Syncing exchanges for user ${user.id}: ${availableExchanges.map((e) => e.name).join(', ')}`);

      for (const exchange of availableExchanges) {
        try {
          const client = await this.exchangeManager.getExchangeClient(exchange.slug, user);

          if (client) {
            const syncCount = await this.syncOrdersForExchange(user, exchange.name, client);
            totalNewOrders += syncCount;

            if (syncCount > 0) {
              this.logger.log(`Synced ${syncCount} ${exchange.name} orders for user: ${user.id}`);
            }
          } else {
            this.logger.debug(`No valid ${exchange.name} client for user: ${user.id}`);
          }
        } catch (error: unknown) {
          const err = toErrorInfo(error);
          this.logger.error(`Error syncing ${exchange.name} orders for user ${user.id}: ${err.message}`, err.stack);
        }
      }

      return totalNewOrders;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to sync orders for user ${user.id}: ${err.message}`, err.stack);
      return 0;
    }
  }

  private async fetchFromExchange<T>(
    client: ccxt.Exchange,
    capability: string,
    fetchFn: (symbol: string, since?: number) => Promise<T[]>,
    dedup: (items: T[]) => T[],
    operationName: string,
    lastSyncTime?: Date
  ): Promise<T[]> {
    if (!client.has[capability]) {
      this.logger.debug(`Exchange ${client.id} does not support ${capability}, skipping`);
      return [];
    }

    try {
      const since = lastSyncTime ? new Date(lastSyncTime).getTime() : undefined;
      const markets = await withExchangeRetryThrow(() => client.loadMarkets(), {
        logger: this.logger,
        operationName: `loadMarkets (${operationName})`
      });
      const allSymbols = Object.keys(markets);
      const activeSymbols = allSymbols.filter((s) => markets[s]?.active !== false);
      const skippedCount = allSymbols.length - activeSymbols.length;

      this.logger.log(`Fetching historical ${operationName} since: ${since}`);
      this.logger.log(`Active markets: ${activeSymbols.length}/${allSymbols.length}`);
      this.logger.debug(`Active symbols: ${activeSymbols.join(', ')}`);

      if (skippedCount > 0) {
        this.logger.debug(
          `Skipped ${skippedCount} inactive/delisted market(s): ${allSymbols.filter((s) => markets[s]?.active === false).join(', ')}`
        );
      }

      const allItems: T[] = [];

      for (let i = 0; i < activeSymbols.length; i++) {
        const symbol = activeSymbols[i];
        const result = await withExchangeRetry(() => fetchFn(symbol, since), {
          logger: this.logger,
          operationName: `${operationName}(${symbol})`
        });
        if (result.success) {
          this.logger.log(`Fetched ${result.result?.length ?? 0} ${operationName} for ${symbol}`);
          if (result.result) allItems.push(...result.result);
        } else {
          this.logger.log(
            `Failed to fetch ${operationName} for ${symbol}: ${result.error?.message ?? 'Unknown error'}`
          );
        }
        if (i < activeSymbols.length - 1) {
          await sleep(PER_SYMBOL_STAGGER_MS);
        }
      }

      return dedup(allItems);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to fetch historical ${operationName}: ${err.message}`);
      return [];
    }
  }

  private removeDuplicates<T>(items: T[], getId: (item: T) => string): T[] {
    const seen = new Set<string>();
    const unique: T[] = [];

    for (const item of items) {
      const id = getId(item);
      if (id && !seen.has(id)) {
        seen.add(id);
        unique.push(item);
      }
    }

    return unique;
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
    const newStatus = this.calculationService.mapCcxtStatusToOrderStatus(String(exchangeOrder.status ?? 'open'));
    const newExecutedQuantity = exchangeOrder.filled || exchangeOrder.amount || 0;
    const feeData = this.calculationService.extractFeeData(exchangeOrder);
    const newPrice = this.calculationService.calculateOrderPrice(exchangeOrder);
    const newCost = this.calculationService.calculateOrderCost(exchangeOrder);
    const newAveragePrice = exchangeOrder.average || null;

    const updateData: Partial<Order> = {};
    let hasChanges = false;
    const previousStatus = existingOrder.status;

    if (existingOrder.status !== newStatus) {
      await this.stateMachineService.transitionStatus(
        existingOrder.id,
        existingOrder.status,
        newStatus,
        OrderTransitionReason.EXCHANGE_SYNC,
        {
          exchangeOrderId: exchangeOrder.id,
          exchangeStatus: exchangeOrder.status,
          previousExecutedQuantity: existingOrder.executedQuantity,
          newExecutedQuantity,
          syncTimestamp: new Date().toISOString()
        }
      );
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
      await this.orderRepository.update(existingOrder.id, updateData as QueryDeepPartialEntity<Order>);

      if (previousStatus !== OrderStatus.FILLED && newStatus === OrderStatus.FILLED && this.positionManagementService) {
        try {
          await this.positionManagementService.handleOcoFill(existingOrder.id);
          this.logger.debug(`Processed OCO fill for order ${existingOrder.id}`);
        } catch (ocoError: unknown) {
          const err = toErrorInfo(ocoError);
          this.logger.warn(`Failed to process OCO fill for order ${existingOrder.id}: ${err.message}`);
        }
      }

      return true;
    }

    return false;
  }

  private async createNewOrder(exchangeOrder: ccxt.Order, user: User, exchangeName?: string): Promise<boolean> {
    try {
      const { base: coinSymbol } = this.calculationService.extractCoinSymbol(exchangeOrder.symbol);
      const coin = await this.coinService.getCoinBySymbol(coinSymbol, undefined, false);

      const price = this.calculationService.calculateOrderPrice(exchangeOrder);
      const feeData = this.calculationService.extractFeeData(exchangeOrder);
      const cost = this.calculationService.calculateOrderCost(exchangeOrder);
      const gainLoss = this.calculationService.calculateGainLoss(exchangeOrder, feeData);

      const exchange = await this.getExchangeForOrder(exchangeOrder, exchangeName);
      const { baseCoin, quoteCoin } = await this.getTradingPairCoins(exchangeOrder.symbol, coin ?? undefined);

      const algorithmicFields = extractAlgorithmicTradingFields(exchangeOrder);
      const futuresFields = extractFuturesFields(exchangeOrder);

      const newOrder = this.orderRepository.create({
        clientOrderId: exchangeOrder.clientOrderId || exchangeOrder.id.toString(),
        baseCoin: baseCoin && !CoinService.isVirtualCoin(baseCoin) ? baseCoin : undefined,
        quoteCoin: quoteCoin && !CoinService.isVirtualCoin(quoteCoin) ? quoteCoin : undefined,
        executedQuantity: exchangeOrder.filled || 0,
        orderId: exchangeOrder.id.toString(),
        price: price || 0,
        quantity: exchangeOrder.amount || 0,
        side: exchangeOrder.side === 'buy' ? OrderSide.BUY : OrderSide.SELL,
        status: this.calculationService.mapCcxtStatusToOrderStatus(String(exchangeOrder.status ?? 'open')),
        symbol: exchangeOrder.symbol,
        transactTime: new Date(exchangeOrder.timestamp),
        type: this.calculationService.mapCcxtOrderTypeToOrderType(String(exchangeOrder.type ?? 'market')),
        user,
        cost: cost > 0 ? cost : undefined,
        fee: feeData.fee || 0,
        commission: feeData.commission || 0,
        feeCurrency: feeData.feeCurrency,
        gainLoss: gainLoss ?? undefined,
        averagePrice: exchangeOrder.average ?? undefined,
        exchange: exchange ?? undefined,
        ...algorithmicFields,
        ...futuresFields
      });

      await this.orderRepository.save(newOrder);
      return true;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to create new order: ${err.message}`);
      return false;
    }
  }

  private async getExchangeForOrder(exchangeOrder: ccxt.Order, exchangeName?: string): Promise<Exchange | null> {
    try {
      if (exchangeName) {
        return await this.exchangeService.getExchangeByName(exchangeName);
      }

      if (exchangeOrder.info?.exchange) {
        const infoExchange = String(exchangeOrder.info.exchange).toLowerCase();
        const supported = await this.exchangeService.getExchanges({ supported: true });
        return (
          supported.find((e) => infoExchange.includes(e.slug) || infoExchange.includes(e.name.toLowerCase())) ?? null
        );
      }

      return null;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Error identifying exchange for order ${exchangeOrder.id}: ${err.message}`);
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
        const baseCoin = tickerPair.baseAsset ? await this.coinService.getCoinById(tickerPair.baseAsset.id) : null;
        const quoteCoin = tickerPair.quoteAsset ? await this.coinService.getCoinById(tickerPair.quoteAsset.id) : null;
        return { baseCoin, quoteCoin };
      }

      return { baseCoin: fallbackCoin || null, quoteCoin: null };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to load coins from ticker pair: ${err.message}`);
      return { baseCoin: fallbackCoin || null, quoteCoin: null };
    }
  }

  private async syncOrdersForExchange(user: User, exchangeName: string, client: ccxt.Exchange): Promise<number> {
    const exchangeSlug = exchangeName.toLowerCase().replace(/\s+/g, '-');
    const endTimer = this.metricsService.startOrderSyncTimer(exchangeSlug);

    try {
      const mostRecentOrder = await this.orderRepository.findOne({
        where: {
          user: { id: user.id },
          exchange: { name: exchangeName }
        },
        order: { transactTime: 'DESC' }
      });

      let totalNewOrders = 0;

      const newOrders = await this.fetchHistoricalOrders(client, mostRecentOrder?.transactTime);
      this.logger.log(`Fetched ${newOrders.length} new orders from ${exchangeName} for user ${user.id}`);

      if (newOrders.length > 0) {
        totalNewOrders += await this.saveExchangeOrders(newOrders, user, exchangeName);
      }

      try {
        const newTrades = await this.fetchMyTrades(client, mostRecentOrder?.transactTime);
        this.logger.log(`Fetched ${newTrades.length} new trades from ${exchangeName} for user ${user.id}`);

        if (newTrades.length > 0) {
          const { orders: syntheticOrders, tradeCount } = convertTradesToOrders(newTrades);
          this.logger.log(`Converted ${tradeCount} trades into ${syntheticOrders.length} synthetic orders`);

          if (syntheticOrders.length > 0) {
            totalNewOrders += await this.saveExchangeOrders(syntheticOrders, user, exchangeName);
          }
        }
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.warn(`Trade synchronization failed for ${exchangeName}: ${err.message}`);
      }

      this.metricsService.recordOrdersSynced(exchangeSlug, 'success', totalNewOrders);

      return totalNewOrders;
    } catch (error: unknown) {
      const errorType = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.metricsService.recordOrderSyncError(exchangeSlug, errorType);
      this.metricsService.recordOrdersSynced(exchangeSlug, 'failed', 0);
      throw error;
    } finally {
      endTimer();
    }
  }
}
