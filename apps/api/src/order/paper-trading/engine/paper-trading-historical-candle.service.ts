import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import { Cache } from 'cache-manager';

import { CoinService } from '../../../coin/coin.service';
import { ExchangeManagerService } from '../../../exchange/exchange-manager.service';
import { CandleData, OHLCCandle } from '../../../ohlc/ohlc-candle.entity';
import { OHLCService } from '../../../ohlc/ohlc.service';
import { OHLCBackfillService } from '../../../ohlc/services/ohlc-backfill.service';
import { toErrorInfo } from '../../../shared/error.util';
import { withExchangeRetryThrow } from '../../../shared/retry.util';
import type { User } from '../../../users/users.entity';

const CANDLE_CACHE_TTL_MS = 5 * 60 * 1000;
const CANDLE_CACHE_TTL_PARTIAL_MS = 60 * 1000;
const BACKFILL_DEDUP_TTL_MS = 6 * 60 * 60 * 1000;
const EXCHANGE_FETCH_TIMEOUT_MS = 5000;
const HOUR_MS = 60 * 60 * 1000;
const FALLBACK_COUNTER_WINDOW_MS = 60 * 60 * 1000;
const FALLBACK_COUNTER_THRESHOLD = 5;

function mapOHLCCandleToCandleData(candle: OHLCCandle): CandleData {
  return {
    avg: candle.close,
    high: candle.high,
    low: candle.low,
    date: candle.timestamp instanceof Date ? candle.timestamp : new Date(candle.timestamp),
    open: candle.open,
    close: candle.close,
    volume: candle.volume
  };
}

/**
 * Serves historical OHLC candles to paper-trading algorithms with a tiered lookup:
 *   1. 5-min cache.
 *   2. Local `ohlc_candles` hypertable — the 99% fast path when coverage is good.
 *   3. Exchange fallback with 5 s timeout for coverage gaps; triggers async backfill
 *      so subsequent ticks can serve from the DB.
 *
 * Extracted from `PaperTradingMarketDataService` for file-size compliance and because
 * its dependency set (`OHLCService`, `OHLCBackfillService`) is distinct from the price
 * fetcher's. See also `paper-trading-market-data.service.ts` for live prices.
 */
@Injectable()
export class PaperTradingHistoricalCandleService {
  private readonly logger = new Logger(PaperTradingHistoricalCandleService.name);
  private readonly fallbackCounters = new Map<string, { count: number; windowStart: number }>();

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly exchangeManager: ExchangeManagerService,
    private readonly coinService: CoinService,
    @Inject(forwardRef(() => OHLCService))
    private readonly ohlcService: OHLCService,
    @Inject(forwardRef(() => OHLCBackfillService))
    private readonly ohlcBackfillService: OHLCBackfillService
  ) {}

  async getHistoricalCandles(
    exchangeSlug: string,
    symbol: string,
    timeframe = '1h',
    limit = 100,
    user?: User
  ): Promise<CandleData[]> {
    let effectiveTimeframe = timeframe;
    if (timeframe !== '1h') {
      this.logger.warn(
        `getHistoricalCandles called with timeframe=${timeframe} for ${symbol}; only '1h' is supported. Coercing to '1h'.`
      );
      effectiveTimeframe = '1h';
    }

    const cacheKey = `paper-trading:ohlcv:${exchangeSlug}:${symbol}:${effectiveTimeframe}:${limit}`;

    const cached = await this.cacheManager.get<CandleData[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const [base] = symbol.split('/');
    const coin = await this.coinService.getCoinBySymbol(base, undefined, false).catch(() => null);
    if (!coin) {
      this.logger.warn(`Unknown coin for symbol ${symbol}; no historical candles available`);
      return [];
    }

    const now = new Date();
    const rangeStart = new Date(now.getTime() - (limit + 5) * HOUR_MS);

    let dbCandles: OHLCCandle[] = [];
    try {
      dbCandles = await this.ohlcService.getCandlesByDateRange([coin.id], rangeStart, now);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`DB candle query failed for ${symbol} (coinId=${coin.id}): ${err.message}`);
    }

    if (dbCandles.length >= limit) {
      const sliced = dbCandles.slice(-limit).map(mapOHLCCandleToCandleData);
      await this.cacheManager.set(cacheKey, sliced, CANDLE_CACHE_TTL_MS);
      return sliced;
    }

    // DB gap — trigger async backfill (deduped), then try exchange with a tight timeout.
    this.trackFallbackUsage(coin.id, symbol);
    await this.triggerBackfillIfNeeded(coin.id);

    const partialDbCandles = dbCandles.map(mapOHLCCandleToCandleData);
    const exchangeCandles = await this.fetchExchangeCandlesWithTimeout(
      exchangeSlug,
      symbol,
      effectiveTimeframe,
      limit,
      user
    );

    if (exchangeCandles && exchangeCandles.length > 0) {
      const sliced = exchangeCandles.slice(-limit);
      await this.cacheManager.set(cacheKey, sliced, CANDLE_CACHE_TTL_MS);
      return sliced;
    }

    // Double failure — return partial DB candles (may be []) with a shorter cache TTL.
    this.logger.warn(
      `Historical candles unavailable for ${symbol}: DB has ${partialDbCandles.length}/${limit} candles and exchange fetch from ${exchangeSlug} failed or returned empty.`
    );
    await this.cacheManager.set(cacheKey, partialDbCandles, CANDLE_CACHE_TTL_PARTIAL_MS);
    return partialDbCandles;
  }

  private async triggerBackfillIfNeeded(coinId: string): Promise<void> {
    const dedupKey = `paper-trading:backfill-triggered:${coinId}`;
    try {
      const already = await this.cacheManager.get<boolean>(dedupKey);
      if (already) {
        return;
      }
      await this.cacheManager.set(dedupKey, true, BACKFILL_DEDUP_TTL_MS);
      // Fire-and-forget — errors are logged inside startBackfill.
      this.ohlcBackfillService.startBackfill(coinId).catch((error: unknown) => {
        const err = toErrorInfo(error);
        this.logger.debug(`Backfill trigger for coin ${coinId} failed: ${err.message}`);
      });
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.debug(`Backfill dedup check failed for coin ${coinId}: ${err.message}`);
    }
  }

  private trackFallbackUsage(coinId: string, symbol: string): void {
    const now = Date.now();
    const entry = this.fallbackCounters.get(coinId);
    if (!entry || now - entry.windowStart > FALLBACK_COUNTER_WINDOW_MS) {
      this.fallbackCounters.set(coinId, { count: 1, windowStart: now });
      return;
    }
    entry.count += 1;
    if (entry.count === FALLBACK_COUNTER_THRESHOLD) {
      this.logger.warn(
        `Symbol ${symbol} (coinId=${coinId}) has hit exchange fallback ${entry.count} times in the last hour — likely OHLC sync coverage gap.`
      );
    }
  }

  private async fetchExchangeCandlesWithTimeout(
    exchangeSlug: string,
    symbol: string,
    timeframe: string,
    limit: number,
    user?: User
  ): Promise<CandleData[] | null> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const formattedSymbol = this.exchangeManager.formatSymbol(exchangeSlug, symbol);
      const client = user
        ? await this.exchangeManager.getExchangeClient(exchangeSlug, user)
        : await this.exchangeManager.getPublicClient(exchangeSlug);

      const fetchPromise = withExchangeRetryThrow(
        () => client.fetchOHLCV(formattedSymbol, timeframe, undefined, limit),
        { logger: this.logger, operationName: `fetchOHLCV(${exchangeSlug}:${symbol})` }
      );

      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Exchange fetchOHLCV timed out after ${EXCHANGE_FETCH_TIMEOUT_MS}ms`)),
          EXCHANGE_FETCH_TIMEOUT_MS
        );
      });

      const ohlcv = await Promise.race([fetchPromise, timeoutPromise]);

      return ohlcv.map((candle) => ({
        avg: candle[4] as number,
        high: candle[2] as number,
        low: candle[3] as number,
        date: new Date(candle[0] as number),
        open: candle[1] as number,
        close: candle[4] as number,
        volume: candle[5] as number
      }));
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to fetch OHLCV for ${symbol} from ${exchangeSlug}: ${err.message}`);
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
