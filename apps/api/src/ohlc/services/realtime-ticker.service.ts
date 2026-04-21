import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import { Cache } from 'cache-manager';

import { CoinService } from '../../coin/coin.service';
import { TickerBatcherService } from '../../exchange/ticker-batcher/ticker-batcher.service';
import { toErrorInfo } from '../../shared/error.util';

export interface TickerPrice {
  coinId: string;
  symbol: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  updatedAt: Date;
  source: string;
}

@Injectable()
export class RealtimeTickerService {
  private readonly logger = new Logger(RealtimeTickerService.name);
  private readonly CACHE_TTL = 45 * 1000; // 45 seconds in milliseconds
  private readonly CACHE_PREFIX = 'ticker:price:';
  private readonly EXCHANGE_PRIORITY = ['binance_us', 'gdax', 'kraken'];

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    @Inject(forwardRef(() => CoinService))
    private readonly coinService: CoinService,
    private readonly tickerBatcher: TickerBatcherService
  ) {}

  /**
   * Get current price for a coin (cached)
   */
  async getPrice(coinId: string): Promise<TickerPrice | null> {
    // Check cache first
    const cacheKey = `${this.CACHE_PREFIX}${coinId}`;
    const cached = await this.cache.get<string>(cacheKey);

    if (cached) {
      const parsed = JSON.parse(cached);
      return {
        ...parsed,
        updatedAt: new Date(parsed.updatedAt)
      };
    }

    // Fetch from exchange
    const coin = await this.coinService.getCoinById(coinId).catch(() => null);
    if (!coin) {
      return null;
    }

    const ticker = await this.fetchTicker(coin.symbol);
    if (!ticker) {
      return null;
    }

    const tickerPrice: TickerPrice = {
      coinId,
      ...ticker
    };

    // Cache the result
    await this.cache.set(cacheKey, JSON.stringify(tickerPrice), this.CACHE_TTL);

    return tickerPrice;
  }

  /**
   * Get prices for multiple coins (batch)
   */
  async getPrices(coinIds: string[]): Promise<Map<string, TickerPrice>> {
    const result = new Map<string, TickerPrice>();

    // First, check cache for all coins
    const uncachedIds: string[] = [];

    for (const coinId of coinIds) {
      const cacheKey = `${this.CACHE_PREFIX}${coinId}`;
      const cached = await this.cache.get<string>(cacheKey);

      if (cached) {
        const parsed = JSON.parse(cached);
        result.set(coinId, {
          ...parsed,
          updatedAt: new Date(parsed.updatedAt)
        });
      } else {
        uncachedIds.push(coinId);
      }
    }

    // Fetch uncached coins
    if (uncachedIds.length > 0) {
      for (const coinId of uncachedIds) {
        const coin = await this.coinService.getCoinById(coinId).catch(() => null);
        if (!coin) continue;

        const ticker = await this.fetchTicker(coin.symbol);
        if (ticker) {
          const tickerPrice: TickerPrice = {
            coinId: coin.id,
            ...ticker
          };

          result.set(coin.id, tickerPrice);

          // Cache the result
          const cacheKey = `${this.CACHE_PREFIX}${coin.id}`;
          await this.cache.set(cacheKey, JSON.stringify(tickerPrice), this.CACHE_TTL);
        }
      }
    }

    return result;
  }

  /**
   * Force refresh price (bypass cache)
   */
  async refreshPrice(coinId: string): Promise<TickerPrice | null> {
    // Clear cache
    const cacheKey = `${this.CACHE_PREFIX}${coinId}`;
    await this.cache.del(cacheKey);

    // Fetch fresh price
    return this.getPrice(coinId);
  }

  /**
   * Update Coin.currentPrice from latest ticker
   */
  async syncCoinCurrentPrice(coinId: string): Promise<void> {
    const ticker = await this.getPrice(coinId);

    if (ticker) {
      await this.coinService.updateCurrentPrice(coinId, ticker.price);
    }
  }

  /**
   * Sync current prices for multiple coins
   */
  async syncCoinCurrentPrices(coinIds: string[]): Promise<void> {
    const prices = await this.getPrices(coinIds);

    for (const [coinId, ticker] of prices) {
      await this.coinService.updateCurrentPrice(coinId, ticker.price);
    }
  }

  /**
   * Internal: Fetch ticker from exchange with priority-list fallthrough.
   * Delegates to the batcher — which owns retry, circuit breaker, and market filtering.
   */
  private async fetchTicker(symbol: string): Promise<Omit<TickerPrice, 'coinId'> | null> {
    const tradingSymbol = `${symbol.toUpperCase()}/USD`;

    for (const exchangeSlug of this.EXCHANGE_PRIORITY) {
      try {
        const batched = await this.tickerBatcher.getTicker(exchangeSlug, tradingSymbol);
        if (!batched || !batched.price) continue;
        const refPrice = batched.price;
        return {
          symbol: tradingSymbol,
          price: refPrice,
          change24h: batched.change ?? 0,
          changePercent24h: batched.percentage ?? 0,
          volume24h: batched.quoteVolume ?? batched.baseVolume ?? 0,
          high24h: batched.high ?? refPrice,
          low24h: batched.low ?? refPrice,
          updatedAt: new Date(),
          source: exchangeSlug
        };
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.debug(`Failed to fetch ticker from ${exchangeSlug} for ${tradingSymbol}: ${err.message}`);
        // Continue to next exchange
      }
    }

    return null;
  }
}
