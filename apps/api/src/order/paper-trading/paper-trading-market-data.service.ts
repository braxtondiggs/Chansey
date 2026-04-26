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
import { TickerBatcherService } from '../../exchange/ticker-batcher/ticker-batcher.service';
import { tickerCircuitKey } from '../../shared/circuit-breaker.constants';
import { CircuitBreakerService } from '../../shared/circuit-breaker.service';
import { toErrorInfo } from '../../shared/error.util';
import { withExchangeRetry } from '../../shared/retry.util';

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
    private readonly coinService: CoinService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly tickerBatcher: TickerBatcherService
  ) {
    this.cacheTtlMs = config.priceCacheTtlMs;
  }

  private circuitKey(exchangeSlug: string): string {
    return tickerCircuitKey(exchangeSlug);
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
   * Get current price for a symbol. Routes through TickerBatcherService,
   * which coalesces concurrent callers and owns the circuit-breaker state
   * for the exchange hop. Falls back to stale cache → alternate exchange → DB.
   */
  async getCurrentPrice(exchangeSlug: string, symbol: string): Promise<PriceData> {
    const cacheKey = `paper-trading:price:${exchangeSlug}:${symbol}`;

    const cached = await this.cacheManager.get<PriceData>(cacheKey);
    if (cached) {
      return cached;
    }

    // If the breaker is open, skip the batcher and go straight to the stale chain.
    const circuitOpen = this.circuitBreaker.isOpen(this.circuitKey(exchangeSlug));

    let fetched: PriceData | null = null;
    let fetchError: Error | null = circuitOpen ? new Error(`Circuit breaker open for ${exchangeSlug}`) : null;

    if (!circuitOpen) {
      try {
        const ticker = await this.tickerBatcher.getTicker(exchangeSlug, symbol);
        if (ticker) {
          fetched = {
            symbol,
            price: ticker.price,
            bid: ticker.bid,
            ask: ticker.ask,
            timestamp: ticker.timestamp,
            source: exchangeSlug
          };
        } else {
          fetchError = new Error(`No ticker for ${symbol} on ${exchangeSlug}`);
        }
      } catch (error: unknown) {
        fetchError = error instanceof Error ? error : new Error(String(error));
      }
    }

    if (fetched) {
      await this.cacheManager.set(cacheKey, fetched, this.cacheTtlMs);
      await this.cacheManager.set(`${cacheKey}:stale`, fetched, STALE_CACHE_TTL_MS);
      return fetched;
    }

    const staleKey = `${cacheKey}:stale`;
    const stale = await this.cacheManager.get<PriceData>(staleKey);
    if (stale) {
      const message = `${circuitOpen ? 'Circuit open' : 'Batcher fetch exhausted'} for ${symbol} on ${exchangeSlug}. Using stale cached price.`;
      if (circuitOpen) {
        this.logger.debug(message);
      } else {
        this.logger.warn(message);
      }
      return { ...stale, source: `${stale.source}:stale` };
    }

    const fallbackPrice = await this.tryFallbackExchanges(symbol, exchangeSlug);
    if (fallbackPrice) {
      await this.cacheManager.set(`${cacheKey}:stale`, fallbackPrice, STALE_CACHE_TTL_MS);
      return fallbackPrice;
    }

    const dbPrice = await this.tryDatabasePrice(symbol);
    if (dbPrice) {
      return dbPrice;
    }

    this.logger.error(
      `Failed to fetch price for ${symbol} from ${exchangeSlug} after ${circuitOpen ? 'circuit-open short-circuit' : 'batcher'}, fallback exchanges, and DB lookup`
    );
    throw fetchError ?? new Error(`Failed to fetch price for ${symbol} from ${exchangeSlug}`);
  }

  /**
   * Get prices for multiple symbols. Routes through the batcher for a single
   * coalesced exchange hop per flush window.
   */
  async getPrices(exchangeSlug: string, symbols: string[]): Promise<Map<string, PriceData>> {
    const results = new Map<string, PriceData>();

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

    const circuitOpen = this.circuitBreaker.isOpen(this.circuitKey(exchangeSlug));

    let fetchError: Error | null = circuitOpen ? new Error(`Circuit breaker open for ${exchangeSlug}`) : null;

    if (!circuitOpen) {
      try {
        const tickerMap = await this.tickerBatcher.getTickers(exchangeSlug, uncachedSymbols);
        for (const [symbol, ticker] of tickerMap) {
          const priceData: PriceData = {
            symbol,
            price: ticker.price,
            bid: ticker.bid,
            ask: ticker.ask,
            timestamp: ticker.timestamp,
            source: exchangeSlug
          };
          results.set(symbol, priceData);
          const cacheKey = `paper-trading:price:${exchangeSlug}:${symbol}`;
          await this.cacheManager.set(cacheKey, priceData, this.cacheTtlMs);
          await this.cacheManager.set(`${cacheKey}:stale`, priceData, STALE_CACHE_TTL_MS);
        }
      } catch (error: unknown) {
        fetchError = error instanceof Error ? error : new Error(String(error));
      }
    }

    // Run the stale → fallback-exchange → DB recovery chain for any uncached symbol
    // that didn't come back from the batcher, regardless of whether it threw or just
    // returned a partial map. A silent drop would otherwise shrink the trading
    // universe mid-session.
    const partialMisses = uncachedSymbols.filter((s) => !results.has(s));

    if (partialMisses.length > 0) {
      const message = fetchError
        ? `${circuitOpen ? 'Circuit open' : 'Batcher fetch exhausted'} for ${exchangeSlug}. ` +
          `Falling back for ${partialMisses.length} symbol(s).`
        : `Batcher returned partial data for ${exchangeSlug}. Falling back for ${partialMisses.length} symbol(s).`;
      if (circuitOpen) {
        this.logger.debug(message);
      } else {
        this.logger.warn(message);
      }

      // Phase 1: parallel stale-cache (Redis) — cheap
      const afterStale = await this.recoverFromStaleCache(exchangeSlug, partialMisses, results);
      // Phase 2: parallel fallback-exchange + DB — only for what stale cache missed
      if (afterStale.length > 0) {
        await this.recoverFromExternalFallback(exchangeSlug, afterStale, results);
      }
    }

    // Only throw when the fetch itself failed AND recovery didn't cover every
    // symbol. Partial batch success with unrecoverable symbols returns what we have —
    // the engine already tolerates missing symbols via its validSymbols filter.
    if (fetchError) {
      const finalMisses = uncachedSymbols.filter((s) => !results.has(s));
      if (finalMisses.length > 0) {
        throw new Error(
          `Failed to fetch prices from ${exchangeSlug} via batcher, ` +
            `and ${finalMisses.length} symbol(s) have no stale cache, fallback exchange, or DB fallback`
        );
      }
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
        const ticker = await this.tickerBatcher.getTicker(slug, fallbackSymbol);

        if (ticker && ticker.price > 0) {
          this.logger.warn(`Fetched price for ${symbol} from fallback exchange ${slug}`);
          return {
            symbol,
            price: ticker.price,
            bid: ticker.bid,
            ask: ticker.ask,
            timestamp: ticker.timestamp,
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
   * Parallel stale-cache lookup. Mutates `results` with hits.
   * Returns the symbols that weren't recovered from stale cache.
   */
  private async recoverFromStaleCache(
    exchangeSlug: string,
    symbols: string[],
    results: Map<string, PriceData>
  ): Promise<string[]> {
    const lookups = await Promise.all(
      symbols.map(async (symbol) => {
        const staleKey = `paper-trading:price:${exchangeSlug}:${symbol}:stale`;
        const stale = await this.cacheManager.get<PriceData>(staleKey);
        return { symbol, stale };
      })
    );

    const stillMissing: string[] = [];
    for (const { symbol, stale } of lookups) {
      if (stale) {
        results.set(symbol, { ...stale, source: `${stale.source}:stale` });
      } else {
        stillMissing.push(symbol);
      }
    }
    return stillMissing;
  }

  /**
   * Parallel fallback-exchange + DB lookup. Mutates `results` with hits.
   * Writes successful fallback prices back to the stale cache so the next
   * miss is served from Phase 1.
   */
  private async recoverFromExternalFallback(
    exchangeSlug: string,
    symbols: string[],
    results: Map<string, PriceData>
  ): Promise<void> {
    await Promise.all(
      symbols.map(async (symbol) => {
        const staleKey = `paper-trading:price:${exchangeSlug}:${symbol}:stale`;
        const fallbackPrice = await this.tryFallbackExchanges(symbol, exchangeSlug);
        if (fallbackPrice) {
          results.set(symbol, fallbackPrice);
          await this.cacheManager.set(staleKey, fallbackPrice, STALE_CACHE_TTL_MS);
          return;
        }
        const dbPrice = await this.tryDatabasePrice(symbol);
        if (dbPrice) {
          results.set(symbol, dbPrice);
        }
      })
    );
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
