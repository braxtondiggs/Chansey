import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';

import { Cache } from 'cache-manager';

import { paperTradingConfig } from './paper-trading.config';

import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { toErrorInfo } from '../../shared/error.util';
import type { User } from '../../users/users.entity';

export interface PriceData {
  symbol: string;
  price: number;
  bid?: number;
  ask?: number;
  timestamp: Date;
  source: string;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBook {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: Date;
}

export interface SlippageResult {
  estimatedPrice: number;
  slippageBps: number;
  marketImpact: number;
}

@Injectable()
export class PaperTradingMarketDataService {
  private readonly logger = new Logger(PaperTradingMarketDataService.name);
  private readonly cacheTtlMs: number;

  constructor(
    @Inject(paperTradingConfig.KEY) private readonly config: ConfigType<typeof paperTradingConfig>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly exchangeManager: ExchangeManagerService
  ) {
    this.cacheTtlMs = config.priceCacheTtlMs;
  }

  /**
   * Get current price for a symbol from exchange
   * Uses cache with short TTL to minimize API calls
   */
  async getCurrentPrice(exchangeSlug: string, symbol: string, user?: User): Promise<PriceData> {
    const cacheKey = `paper-trading:price:${exchangeSlug}:${symbol}`;

    // Try cache first
    const cached = await this.cacheManager.get<PriceData>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Format symbol for exchange
      const formattedSymbol = this.exchangeManager.formatSymbol(exchangeSlug, symbol);

      // Get client (public if no user)
      const client = user
        ? await this.exchangeManager.getExchangeClient(exchangeSlug, user)
        : await this.exchangeManager.getPublicClient(exchangeSlug);

      // Fetch ticker
      const ticker = await client.fetchTicker(formattedSymbol);

      const priceData: PriceData = {
        symbol,
        price: ticker.last ?? ticker.close ?? 0,
        bid: ticker.bid,
        ask: ticker.ask,
        timestamp: new Date(ticker.timestamp ?? Date.now()),
        source: exchangeSlug
      };

      // Cache the result
      await this.cacheManager.set(cacheKey, priceData, this.cacheTtlMs);

      return priceData;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to fetch price for ${symbol} from ${exchangeSlug}: ${err.message}`);
      throw error;
    }
  }

  /**
   * Get prices for multiple symbols in one call
   */
  async getPrices(exchangeSlug: string, symbols: string[], user?: User): Promise<Map<string, PriceData>> {
    const results = new Map<string, PriceData>();

    // Check cache for all symbols in parallel
    const cacheResults = await Promise.all(
      symbols.map(async (symbol) => {
        const cacheKey = `paper-trading:price:${exchangeSlug}:${symbol}`;
        const cached = await this.cacheManager.get<PriceData>(cacheKey);
        return { symbol, cached };
      })
    );

    const uncachedSymbols: string[] = [];
    for (const { symbol, cached } of cacheResults) {
      if (cached) {
        results.set(symbol, cached);
      } else {
        uncachedSymbols.push(symbol);
      }
    }

    if (uncachedSymbols.length === 0) {
      return results;
    }

    try {
      // Get client
      const client = user
        ? await this.exchangeManager.getExchangeClient(exchangeSlug, user)
        : await this.exchangeManager.getPublicClient(exchangeSlug);

      // Fetch all tickers (more efficient than individual calls)
      const tickers = await client.fetchTickers(
        uncachedSymbols.map((s) => this.exchangeManager.formatSymbol(exchangeSlug, s))
      );

      for (const symbol of uncachedSymbols) {
        const formattedSymbol = this.exchangeManager.formatSymbol(exchangeSlug, symbol);
        const ticker = tickers[formattedSymbol];

        if (ticker) {
          const priceData: PriceData = {
            symbol,
            price: ticker.last ?? ticker.close ?? 0,
            bid: ticker.bid,
            ask: ticker.ask,
            timestamp: new Date(ticker.timestamp ?? Date.now()),
            source: exchangeSlug
          };

          results.set(symbol, priceData);

          // Cache the result
          const cacheKey = `paper-trading:price:${exchangeSlug}:${symbol}`;
          await this.cacheManager.set(cacheKey, priceData, this.cacheTtlMs);
        }
      }

      return results;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to fetch prices from ${exchangeSlug}: ${err.message}`);
      throw error;
    }
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

      const rawOrderBook = await client.fetchOrderBook(formattedSymbol, depth);

      const orderBook: OrderBook = {
        symbol,
        bids: rawOrderBook.bids.map(([price, quantity]) => ({
          price: Number(price ?? 0),
          quantity: Number(quantity ?? 0)
        })),
        asks: rawOrderBook.asks.map(([price, quantity]) => ({
          price: Number(price ?? 0),
          quantity: Number(quantity ?? 0)
        })),
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
  ): Promise<SlippageResult> {
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

  /**
   * Check if exchange connection is healthy
   */
  async checkExchangeHealth(exchangeSlug: string): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
    const startTime = Date.now();

    try {
      const client = await this.exchangeManager.getPublicClient(exchangeSlug);
      await client.fetchTime();

      return {
        healthy: true,
        latencyMs: Date.now() - startTime
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      return {
        healthy: false,
        error: err.message
      };
    }
  }

  /**
   * Clear cached prices for a symbol
   */
  async clearCache(exchangeSlug: string, symbol?: string): Promise<void> {
    if (symbol) {
      await this.cacheManager.del(`paper-trading:price:${exchangeSlug}:${symbol}`);
      await this.cacheManager.del(`paper-trading:orderbook:${exchangeSlug}:${symbol}`);
    }
    // Note: cache-manager doesn't support pattern-based deletion easily
    // For full cache clear, would need to track keys or use Redis SCAN
  }
}
