import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { Cache } from 'cache-manager';

import { CoinGeckoClientService } from '../../../shared/coingecko-client.service';
import { toErrorInfo } from '../../../shared/error.util';
import { withRateLimitRetry } from '../../../shared/retry.util';

/**
 * Minimal shape of a CoinGecko ticker — only fields both callers care about.
 * The full ticker object is cached, so downstream code can read any additional fields.
 */
export interface CachedTicker {
  coin_id?: string;
  target_coin_id?: string;
  base?: string;
  target?: string;
  volume?: number | string;
  bid_ask_spread_percentage?: number | string;
  trade_url?: string;
  last_traded_at?: string;
  [key: string]: unknown;
}

/**
 * Fetches and caches the full ticker list for a CoinGecko exchange.
 *
 * Both `coin-sync` and `ticker-pairs-sync` run weekly and need the same ticker data
 * per exchange. This service paginates /exchanges/{id}/tickers once per week and
 * stores the result in Redis for 8 days so the second caller reads from cache.
 * TTL > cadence (7d) ensures the cache is never stale-expired when the next
 * Sunday fires — shorter TTLs defeat the shared cache entirely.
 */
@Injectable()
export class ExchangeTickerFetcherService {
  private static readonly CACHE_TTL_MS = 8 * 24 * 60 * 60 * 1000; // 8 days (> weekly cadence + buffer)
  private static readonly PAGE_DELAY_MS = 2500;
  private readonly logger = new Logger(ExchangeTickerFetcherService.name);

  constructor(
    private readonly gecko: CoinGeckoClientService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache
  ) {}

  /**
   * Returns every ticker for the given exchange slug, using the Redis cache
   * when available. On cache miss, paginates CoinGecko and populates the cache.
   * Returns [] on fatal error so callers can continue with remaining exchanges.
   */
  async fetchAllTickersForExchange(exchangeSlug: string): Promise<CachedTicker[]> {
    const cacheKey = `coingecko:exchange-tickers:${exchangeSlug}`;

    try {
      const cached = await this.cacheManager.get<CachedTicker[]>(cacheKey);
      if (cached && cached.length > 0) {
        this.logger.log(`Ticker cache HIT for ${exchangeSlug} (${cached.length} tickers)`);
        return cached;
      }
    } catch (error: unknown) {
      const { message } = toErrorInfo(error);
      this.logger.warn(`Ticker cache read failed for ${exchangeSlug}: ${message}, treating as miss`);
    }

    this.logger.log(`Ticker cache MISS for ${exchangeSlug}, paginating CoinGecko`);

    const geckoId = exchangeSlug === 'coinbase' ? 'gdax' : exchangeSlug.toLowerCase();
    const all: CachedTicker[] = [];
    let page = 1;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const retryResult = await withRateLimitRetry(() => this.gecko.client.exchanges.tickers.get(geckoId, { page }), {
        maxRetries: 2,
        logger: this.logger,
        operationName: `tickers(${geckoId}, page=${page})`
      });

      if (!retryResult.success) {
        const { message } = toErrorInfo(retryResult.error);
        this.logger.error(`Failed to fetch page ${page} tickers for ${exchangeSlug}: ${message}`);
        if (page === 1) return [];
        // Partial data is better than none — break and cache what we have
        break;
      }

      const tickers = (retryResult.result?.tickers ?? []) as CachedTicker[];
      if (tickers.length === 0) {
        this.logger.log(`Completed pagination for ${exchangeSlug} (${all.length} tickers)`);
        break;
      }

      all.push(...tickers);
      page++;

      await new Promise((resolve) => setTimeout(resolve, ExchangeTickerFetcherService.PAGE_DELAY_MS));
    }

    if (all.length > 0) {
      try {
        await this.cacheManager.set(cacheKey, all, ExchangeTickerFetcherService.CACHE_TTL_MS);
        this.logger.log(`Cached ${all.length} tickers for ${exchangeSlug} (TTL: 8d)`);
      } catch (error: unknown) {
        const { message } = toErrorInfo(error);
        this.logger.warn(`Failed to cache tickers for ${exchangeSlug}: ${message}`);
      }
    }

    return all;
  }
}
