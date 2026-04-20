import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';

import { Cache } from 'cache-manager';

import { PaperTradingSession } from './entities';
import type { PriceData } from './paper-trading-market-data.types';
import { paperTradingConfig } from './paper-trading.config';

import { CoinService } from '../../coin/coin.service';
import { CoinSelectionRelations } from '../../coin-selection/coin-selection.entity';
import { CoinSelectionService } from '../../coin-selection/coin-selection.service';
import { EXCHANGE_QUOTE_CURRENCY } from '../../exchange/constants';
import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { toErrorInfo } from '../../shared/error.util';
import { withExchangeRetry } from '../../shared/retry.util';
import type { User } from '../../users/users.entity';

export type { PriceData, OrderBook, OrderBookLevel, RealisticSlippageResult } from './paper-trading-market-data.types';

const STALE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const FALLBACK_EXCHANGE_SLUGS = ['gdax', 'kraken'] as const;

@Injectable()
export class PaperTradingMarketDataService {
  private readonly logger = new Logger(PaperTradingMarketDataService.name);
  private readonly cacheTtlMs: number;
  private readonly symbolUniverseCache = new Map<string, { symbols: string[]; cachedAt: number }>();
  private readonly SYMBOL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    @Inject(paperTradingConfig.KEY) private readonly config: ConfigType<typeof paperTradingConfig>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly exchangeManager: ExchangeManagerService,
    private readonly coinSelectionService: CoinSelectionService,
    private readonly coinService: CoinService
  ) {
    this.cacheTtlMs = config.priceCacheTtlMs;
  }

  /** Resolve symbol universe from user's coin selections, falling back to risk-level coins. */
  async resolveSymbolUniverse(session: PaperTradingSession, quoteCurrency: string): Promise<string[]> {
    const fallback = [`BTC/${quoteCurrency}`, `ETH/${quoteCurrency}`];

    const cacheKey = `${session.id}:${quoteCurrency}`;
    const cached = this.symbolUniverseCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < this.SYMBOL_CACHE_TTL_MS) {
      return cached.symbols;
    }

    if (!session.user) {
      this.logger.warn(`Session ${session.id}: no user attached, using BTC/ETH fallback`);
      return fallback;
    }

    // Tier 1: user's explicit coin selections
    try {
      const selections = await this.coinSelectionService.getCoinSelectionsByUser(session.user, [
        CoinSelectionRelations.COIN
      ]);
      if (selections.length > 0) {
        const symbols = selections.map((s) => `${s.coin.symbol.toUpperCase()}/${quoteCurrency}`);
        this.symbolUniverseCache.set(cacheKey, { symbols, cachedAt: Date.now() });
        return symbols;
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Session ${session.id}: coin selection fetch failed (${err.message}), trying risk-level coins`);
    }

    // Tier 2: risk-level based coins
    try {
      const coins = await this.coinService.getCoinsByRiskLevel(session.user);
      if (coins.length > 0) {
        const symbols = coins.map((c) => `${c.symbol.toUpperCase()}/${quoteCurrency}`);
        this.symbolUniverseCache.set(cacheKey, { symbols, cachedAt: Date.now() });
        return symbols;
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Session ${session.id}: risk-level coin fetch failed (${err.message}), using BTC/ETH fallback`);
      return fallback;
    }

    this.logger.warn(
      `Session ${session.id} (user: ${session.user?.id}): no coin selections or risk-level coins found, using BTC/ETH fallback`
    );
    // Do not cache the fallback — retry next tick so real selections are picked up
    return fallback;
  }

  /** Remove cached symbol universes for sessions that are no longer active. */
  sweepOrphaned(activeSessionIds: Set<string>): number {
    let swept = 0;
    for (const key of this.symbolUniverseCache.keys()) {
      const sessionId = key.split(':')[0];
      if (!activeSessionIds.has(sessionId)) {
        this.symbolUniverseCache.delete(key);
        swept++;
      }
    }
    return swept;
  }

  clearSymbolCache(sessionId: string): void {
    for (const key of this.symbolUniverseCache.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        this.symbolUniverseCache.delete(key);
      }
    }
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

    // Format symbol for exchange
    const formattedSymbol = this.exchangeManager.formatSymbol(exchangeSlug, symbol);

    // Get client (public if no user)
    const client = user
      ? await this.exchangeManager.getExchangeClient(exchangeSlug, user)
      : await this.exchangeManager.getPublicClient(exchangeSlug);

    // Fetch ticker with retry
    const result = await withExchangeRetry(() => client.fetchTicker(formattedSymbol), {
      logger: this.logger,
      operationName: `fetchTicker(${exchangeSlug}:${symbol})`
    });

    if (result.success && result.result) {
      const ticker = result.result;
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

      // Write stale fallback cache with longer TTL
      const staleKey = `${cacheKey}:stale`;
      await this.cacheManager.set(staleKey, priceData, STALE_CACHE_TTL_MS);

      return priceData;
    }

    // All retries exhausted — fall back to stale cache
    const staleKey = `${cacheKey}:stale`;
    const stale = await this.cacheManager.get<PriceData>(staleKey);
    if (stale) {
      this.logger.warn(
        `All retries exhausted fetching price for ${symbol} from ${exchangeSlug}. Using stale cached price.`
      );
      return { ...stale, source: `${stale.source}:stale` };
    }

    // Try fallback exchanges
    const fallbackPrice = await this.tryFallbackExchanges(symbol, exchangeSlug);
    if (fallbackPrice) {
      const staleKey2 = `${cacheKey}:stale`;
      await this.cacheManager.set(staleKey2, fallbackPrice, STALE_CACHE_TTL_MS);
      return fallbackPrice;
    }

    // Try database price as last resort
    const dbPrice = await this.tryDatabasePrice(symbol);
    if (dbPrice) {
      return dbPrice;
    }

    this.logger.error(
      `Failed to fetch price for ${symbol} from ${exchangeSlug} after retries, fallback exchanges, and DB lookup`
    );
    throw result.error;
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

    // Get client
    const client = user
      ? await this.exchangeManager.getExchangeClient(exchangeSlug, user)
      : await this.exchangeManager.getPublicClient(exchangeSlug);

    // Lazy-load markets so we can filter out symbols the exchange doesn't list.
    // Without this, CCXT drops unknown symbols internally and may send an empty
    // `symbols` param to the REST API, which Binance rejects with code -1102.
    let marketsLoaded = Boolean(client.markets && Object.keys(client.markets).length > 0);
    if (!marketsLoaded) {
      try {
        await client.loadMarkets();
        marketsLoaded = Boolean(client.markets && Object.keys(client.markets).length > 0);
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.warn(`loadMarkets(${exchangeSlug}) failed, proceeding without symbol validation: ${err.message}`);
      }
    }

    const formattedPairs = uncachedSymbols.map((raw) => ({
      raw,
      formatted: this.exchangeManager.formatSymbol(exchangeSlug, raw)
    }));

    const validPairs = marketsLoaded
      ? formattedPairs.filter(({ formatted }) => formatted in (client.markets as Record<string, unknown>))
      : formattedPairs;

    if (validPairs.length === 0) {
      this.logger.warn(
        `getPrices(${exchangeSlug}): none of ${uncachedSymbols.length} requested symbols ` +
          `(${uncachedSymbols.join(', ')}) exist on exchange; returning cached-only results`
      );
      return results;
    }

    // Fetch all tickers with retry
    const result = await withExchangeRetry(() => client.fetchTickers(validPairs.map((p) => p.formatted)), {
      logger: this.logger,
      operationName: `fetchTickers(${exchangeSlug})`
    });

    if (result.success && result.result) {
      const tickers = result.result;

      for (const { raw: symbol, formatted: formattedSymbol } of validPairs) {
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

          // Write stale fallback cache with longer TTL
          const staleKey = `${cacheKey}:stale`;
          await this.cacheManager.set(staleKey, priceData, STALE_CACHE_TTL_MS);
        }
      }

      return results;
    }

    // All retries exhausted — fall back to stale cache
    this.logger.warn(
      `All retries exhausted fetching prices from ${exchangeSlug}. ` +
        `Falling back to stale cached prices for ${uncachedSymbols.length} symbol(s).`
    );

    const stillMissing: string[] = [];
    for (const symbol of uncachedSymbols) {
      const staleKey = `paper-trading:price:${exchangeSlug}:${symbol}:stale`;
      const stale = await this.cacheManager.get<PriceData>(staleKey);
      if (stale) {
        results.set(symbol, { ...stale, source: `${stale.source}:stale` });
      } else {
        stillMissing.push(symbol);
      }
    }

    // Try fallback exchanges and DB for symbols with no stale cache
    for (const symbol of stillMissing) {
      const fallbackPrice = await this.tryFallbackExchanges(symbol, exchangeSlug);
      if (fallbackPrice) {
        results.set(symbol, fallbackPrice);
        const cacheKey = `paper-trading:price:${exchangeSlug}:${symbol}:stale`;
        await this.cacheManager.set(cacheKey, fallbackPrice, STALE_CACHE_TTL_MS);
        continue;
      }

      const dbPrice = await this.tryDatabasePrice(symbol);
      if (dbPrice) {
        results.set(symbol, dbPrice);
        continue;
      }
    }

    const finalMisses = stillMissing.filter((s) => !results.has(s));
    if (finalMisses.length > 0) {
      throw new Error(
        `Failed to fetch prices from ${exchangeSlug} after retries, ` +
          `and ${finalMisses.length} symbol(s) have no stale cache, fallback exchange, or DB fallback`
      );
    }

    return results;
  }

  /**
   * Check if exchange connection is healthy
   */
  async checkExchangeHealth(exchangeSlug: string): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
    const startTime = Date.now();

    try {
      const client = await this.exchangeManager.getPublicClient(exchangeSlug);
      const result = await withExchangeRetry(() => client.fetchTime(), {
        logger: this.logger,
        operationName: `checkExchangeHealth(${exchangeSlug})`
      });

      if (!result.success) {
        return {
          healthy: false,
          error: result.error?.message
        };
      }

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
   * Try alternative exchanges when the primary exchange fails.
   * Handles quote currency mismatch (e.g. USDT on Binance → USD on Coinbase/Kraken).
   */
  private async tryFallbackExchanges(symbol: string, primarySlug: string): Promise<PriceData | null> {
    const [base] = symbol.split('/');

    for (const slug of FALLBACK_EXCHANGE_SLUGS) {
      if (slug === primarySlug) continue;

      try {
        const quoteAsset = EXCHANGE_QUOTE_CURRENCY[slug] ?? 'USD';
        const fallbackSymbol = `${base}/${quoteAsset}`;
        const formattedSymbol = this.exchangeManager.formatSymbol(slug, fallbackSymbol);
        const client = await this.exchangeManager.getPublicClient(slug);
        const ticker = await client.fetchTicker(formattedSymbol);

        if (ticker?.last != null || ticker?.close != null) {
          this.logger.warn(`Fetched price for ${symbol} from fallback exchange ${slug}`);
          return {
            symbol,
            price: ticker.last ?? ticker.close ?? 0,
            bid: ticker.bid,
            ask: ticker.ask,
            timestamp: new Date(ticker.timestamp ?? Date.now()),
            source: `${slug}:fallback`
          };
        }
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.debug(`Fallback exchange ${slug} failed for ${symbol}: ${err.message}`);
      }
    }

    return null;
  }

  /**
   * Last-resort fallback using the coin's stored price from the database.
   * May be hours stale but prevents hard failure.
   */
  private async tryDatabasePrice(symbol: string): Promise<PriceData | null> {
    const [base] = symbol.split('/');

    try {
      const coin = await this.coinService.getCoinBySymbol(base, undefined, false);
      if (coin?.currentPrice != null) {
        this.logger.warn(`Using DB coin.currentPrice for ${symbol} (coinId: ${coin.id})`);
        return {
          symbol,
          price: coin.currentPrice,
          timestamp: new Date(),
          source: 'db:coin.currentPrice'
        };
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.debug(`DB price fallback failed for ${symbol}: ${err.message}`);
    }

    return null;
  }

  /**
   * Clear cached prices for a symbol
   */
  async clearCache(exchangeSlug: string, symbol?: string): Promise<void> {
    if (symbol) {
      await this.cacheManager.del(`paper-trading:price:${exchangeSlug}:${symbol}`);
      await this.cacheManager.del(`paper-trading:price:${exchangeSlug}:${symbol}:stale`);
      await this.cacheManager.del(`paper-trading:orderbook:${exchangeSlug}:${symbol}`);
    }
    // Note: cache-manager doesn't support pattern-based deletion easily
    // For full cache clear, would need to track keys or use Redis SCAN
  }
}
