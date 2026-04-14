import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';

import { Cache } from 'cache-manager';

import { OrderBook, RealisticSlippageResult } from './paper-trading-market-data.types';
import { paperTradingConfig } from './paper-trading.config';

import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { toErrorInfo } from '../../shared/error.util';
import { withExchangeRetryThrow } from '../../shared/retry.util';
import type { User } from '../../users/users.entity';

@Injectable()
export class PaperTradingSlippageService {
  private readonly logger = new Logger(PaperTradingSlippageService.name);
  private readonly cacheTtlMs: number;

  constructor(
    @Inject(paperTradingConfig.KEY) private readonly config: ConfigType<typeof paperTradingConfig>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly exchangeManager: ExchangeManagerService
  ) {
    this.cacheTtlMs = config.priceCacheTtlMs;
  }

  /**
   * Get order book for realistic slippage calculation
   */
  async getOrderBook(exchangeSlug: string, symbol: string, depth = 20, user?: User): Promise<OrderBook> {
    const cacheKey = `paper-trading:orderbook:${exchangeSlug}:${symbol}`;

    // Try cache first (shorter TTL for order books)
    const cached = await this.cacheManager.get<OrderBook>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const formattedSymbol = this.exchangeManager.formatSymbol(exchangeSlug, symbol);

      const client = user
        ? await this.exchangeManager.getExchangeClient(exchangeSlug, user)
        : await this.exchangeManager.getPublicClient(exchangeSlug);

      const rawOrderBook = await withExchangeRetryThrow(() => client.fetchOrderBook(formattedSymbol, depth), {
        logger: this.logger,
        operationName: `fetchOrderBook(${exchangeSlug}:${symbol})`
      });

      const orderBook: OrderBook = {
        symbol,
        bids: rawOrderBook.bids
          .map(([price, quantity]) => ({
            price: Number(price ?? 0),
            quantity: Number(quantity ?? 0)
          }))
          .filter((l) => l.price > 0 && l.quantity > 0),
        asks: rawOrderBook.asks
          .map(([price, quantity]) => ({
            price: Number(price ?? 0),
            quantity: Number(quantity ?? 0)
          }))
          .filter((l) => l.price > 0 && l.quantity > 0),
        timestamp: new Date(rawOrderBook.timestamp ?? Date.now())
      };

      // Cache with short TTL (order books change quickly)
      await this.cacheManager.set(cacheKey, orderBook, Math.min(this.cacheTtlMs, 2000));

      return orderBook;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to fetch order book for ${symbol} from ${exchangeSlug}: ${err.message}`);
      throw error;
    }
  }

  /**
   * Calculate realistic slippage based on order book depth
   */
  async calculateRealisticSlippage(
    exchangeSlug: string,
    symbol: string,
    quantity: number,
    side: 'BUY' | 'SELL',
    user?: User
  ): Promise<RealisticSlippageResult> {
    try {
      const orderBook = await this.getOrderBook(exchangeSlug, symbol, 50, user);
      const levels = side === 'BUY' ? orderBook.asks : orderBook.bids;

      if (levels.length === 0) {
        // Fallback to fixed slippage if no order book
        return {
          estimatedPrice: 0,
          slippageBps: 10, // Default 10 bps
          marketImpact: 0
        };
      }

      // Calculate volume-weighted average price for the quantity
      let remainingQuantity = quantity;
      let totalCost = 0;
      let levelsFilled = 0;

      for (const level of levels) {
        if (remainingQuantity <= 0) break;

        const fillQuantity = Math.min(remainingQuantity, level.quantity);
        totalCost += fillQuantity * level.price;
        remainingQuantity -= fillQuantity;
        levelsFilled++;
      }

      const filledQuantity = quantity - remainingQuantity;
      if (filledQuantity === 0) {
        return {
          estimatedPrice: levels[0].price,
          slippageBps: 50, // High slippage for no fill
          marketImpact: 0
        };
      }

      const avgPrice = totalCost / filledQuantity;
      const bestPrice = levels[0].price;
      if (bestPrice <= 0) {
        return { estimatedPrice: avgPrice, slippageBps: 10, marketImpact: 0 };
      }
      const slippageBps = Math.abs(((avgPrice - bestPrice) / bestPrice) * 10000);

      // Market impact is based on how many levels were consumed
      const marketImpact = Math.min(levelsFilled * 2, 50); // Cap at 50 bps

      return {
        estimatedPrice: avgPrice,
        slippageBps: slippageBps + marketImpact,
        marketImpact
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to calculate slippage for ${symbol}: ${err.message}. Using fixed slippage.`);

      // Fallback to fixed slippage
      return {
        estimatedPrice: 0,
        slippageBps: 10,
        marketImpact: 0
      };
    }
  }
}
