import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';

import type * as ccxt from 'ccxt';

import { tickerBatcherConfig } from './ticker-batcher.config';
import type { BatchedTicker, BatchState, PendingRequest } from './ticker-batcher.types';

import { tickerCircuitKey } from '../../shared/circuit-breaker.constants';
import { CircuitBreakerService } from '../../shared/circuit-breaker.service';
import { toErrorInfo } from '../../shared/error.util';
import {
  isClientError,
  isRateLimitError,
  isTransientError,
  isWeightLimitError,
  withExchangeRetry
} from '../../shared/retry.util';
import { ExchangeManagerService } from '../exchange-manager.service';
import { formatSymbolForExchange } from '../utils';

const CLIENT_ERROR_LOG_INTERVAL_MS = 5 * 60 * 1000;
const SHUTDOWN_ERROR_MESSAGE = 'ticker-batcher shutting down';

/**
 * TickerBatcherService
 *
 * Coalesces concurrent in-process ticker fetches for the same exchange into
 * a single `fetchTickers(union-of-symbols)` call per flush window. This
 * collapses the linear-in-users request volume that Binance.US rejects with
 * `-1102` when multiple sessions independently poll within ~100ms of each other.
 *
 * The batcher owns the exchange-hop only: CCXT call + retry + circuit +
 * symbol-market filtering. Callers retain their own Redis cache and stale /
 * fallback-exchange / DB-fallback chain. Clean boundary:
 *
 *   batcher  = protocol correctness
 *   caller   = staleness policy
 */
@Injectable()
export class TickerBatcherService implements OnModuleDestroy {
  private readonly logger = new Logger(TickerBatcherService.name);

  private readonly batches = new Map<string, BatchState>();
  private readonly memCache = new Map<string, { data: BatchedTicker; expiresAt: number }>();
  private readonly lastClientErrorLogAt = new Map<string, number>();
  private destroyed = false;

  constructor(
    @Inject(tickerBatcherConfig.KEY) private readonly config: ConfigType<typeof tickerBatcherConfig>,
    private readonly exchangeManager: ExchangeManagerService,
    private readonly circuitBreaker: CircuitBreakerService
  ) {}

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    for (const [, state] of this.batches) {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      for (const [, waiters] of state.pending) {
        for (const waiter of waiters) {
          waiter.reject(new Error(SHUTDOWN_ERROR_MESSAGE));
        }
      }
      state.pending.clear();
    }
    this.batches.clear();
  }

  /** Fetch a single ticker via the batched path. */
  async getTicker(slug: string, symbol: string): Promise<BatchedTicker | undefined> {
    const cached = this.readMemCache(slug, symbol);
    if (cached) return cached;

    return this.enqueue(slug, symbol);
  }

  /** Fetch multiple tickers; omits entries for symbols the exchange can't serve. */
  async getTickers(slug: string, symbols: string[]): Promise<Map<string, BatchedTicker>> {
    const result = new Map<string, BatchedTicker>();
    const toFetch: string[] = [];

    for (const symbol of symbols) {
      const cached = this.readMemCache(slug, symbol);
      if (cached) {
        result.set(symbol, cached);
      } else {
        toFetch.push(symbol);
      }
    }

    if (toFetch.length === 0) return result;

    const settled = await Promise.all(
      toFetch.map((sym) =>
        this.enqueue(slug, sym)
          .then((ticker) => ({ sym, ticker }))
          .catch((err: Error) => ({ sym, error: err }))
      )
    );

    let firstError: Error | undefined;
    for (const entry of settled) {
      if ('error' in entry && entry.error) {
        firstError = firstError ?? entry.error;
        continue;
      }
      const ticker = (entry as { sym: string; ticker?: BatchedTicker }).ticker;
      if (ticker) {
        result.set(entry.sym, ticker);
      }
    }

    if (firstError && result.size === 0) {
      throw firstError;
    }

    return result;
  }

  private readMemCache(slug: string, symbol: string): BatchedTicker | undefined {
    const entry = this.memCache.get(`${slug}:${symbol}`);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.memCache.delete(`${slug}:${symbol}`);
      return undefined;
    }
    return entry.data;
  }

  private writeMemCache(slug: string, symbol: string, data: BatchedTicker): void {
    this.memCache.set(`${slug}:${symbol}`, { data, expiresAt: Date.now() + this.config.memCacheTtlMs });
  }

  private enqueue(slug: string, symbol: string): Promise<BatchedTicker | undefined> {
    if (this.destroyed) {
      return Promise.reject(new Error(SHUTDOWN_ERROR_MESSAGE));
    }

    return new Promise<BatchedTicker | undefined>((resolve, reject) => {
      const state = this.getOrCreateBatch(slug);
      const waiters = state.pending.get(symbol);
      const entry: PendingRequest = { resolve, reject };

      if (waiters) {
        waiters.push(entry);
      } else {
        state.pending.set(symbol, [entry]);
      }

      // Max-size trip: flush synchronously without waiting for the timer.
      if (state.pending.size >= this.config.maxBatchSize) {
        if (state.timer) {
          clearTimeout(state.timer);
          state.timer = null;
        }
        // Fire-and-forget — the promise we returned is resolved inside flush().
        void this.flush(slug);
        return;
      }

      // First enqueue wins: timer is armed once and never reset, which bounds
      // latency for the earliest caller.
      if (state.timer === null) {
        state.timer = setTimeout(() => {
          void this.flush(slug);
        }, this.config.flushMs);
      }
    });
  }

  private getOrCreateBatch(slug: string): BatchState {
    let state = this.batches.get(slug);
    if (!state) {
      state = { pending: new Map(), timer: null };
      this.batches.set(slug, state);
    }
    return state;
  }

  private async flush(slug: string): Promise<void> {
    const state = this.batches.get(slug);
    if (!state || state.pending.size === 0) {
      if (state?.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      return;
    }

    // Snapshot + reset so new enqueues arriving mid-flush open a fresh batch.
    const pending = state.pending;
    state.pending = new Map();
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    const circuitKey = tickerCircuitKey(slug);
    const rawSymbols = Array.from(pending.keys());
    const coalescedCallers = Array.from(pending.values()).reduce((acc, list) => acc + list.length, 0);
    const startedAt = Date.now();

    try {
      this.circuitBreaker.checkCircuit(circuitKey);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      for (const waiters of pending.values()) {
        for (const waiter of waiters) waiter.reject(err);
      }
      return;
    }

    try {
      const client = await this.exchangeManager.getPublicClient(slug);
      const validPairs = await this.filterValidPairs(client, slug, rawSymbols);

      if (validPairs.length === 0) {
        this.logger.warn(
          `ticker_batch_flush(${slug}): none of ${rawSymbols.length} requested symbols exist on exchange`
        );
        for (const waiters of pending.values()) {
          for (const waiter of waiters) waiter.resolve(undefined);
        }
        return;
      }

      const result = await withExchangeRetry(() => client.fetchTickers(validPairs.map((p) => p.formatted)), {
        logger: this.logger,
        operationName: `fetchTickers(${slug})`,
        // Rate/weight limits are account-wide and client errors are
        // terminal — retrying just burns budget.
        isRetryable: (err) =>
          isTransientError(err) && !isRateLimitError(err) && !isWeightLimitError(err) && !isClientError(err)
      });

      if (result.success && result.result) {
        this.circuitBreaker.recordSuccess(circuitKey);
        this.resolveFromResponse(slug, pending, validPairs, result.result);

        this.logger.debug(
          JSON.stringify({
            event: 'ticker_batch_flush',
            slug,
            symbols: validPairs.length,
            coalescedCallers,
            durationMs: Date.now() - startedAt
          })
        );
        return;
      }

      const err = result.error ?? new Error(`fetchTickers(${slug}) failed`);
      this.circuitBreaker.recordFailure(circuitKey);
      this.handleBatchError(slug, err, pending, validPairs.length, result.attempts, startedAt, client, validPairs);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.circuitBreaker.recordFailure(circuitKey);
      this.handleBatchError(slug, err, pending, rawSymbols.length, 0, startedAt);
    }
  }

  private async filterValidPairs(
    client: ccxt.Exchange,
    slug: string,
    rawSymbols: string[]
  ): Promise<Array<{ raw: string; formatted: string }>> {
    let marketsLoaded = Boolean(client.markets && Object.keys(client.markets).length > 0);
    if (!marketsLoaded) {
      try {
        await client.loadMarkets();
        marketsLoaded = Boolean(client.markets && Object.keys(client.markets).length > 0);
      } catch (error: unknown) {
        const info = toErrorInfo(error);
        this.logger.warn(`loadMarkets(${slug}) failed, proceeding without symbol validation: ${info.message}`);
      }
    }

    const formattedPairs = rawSymbols.map((raw) => ({
      raw,
      formatted: formatSymbolForExchange(slug, raw)
    }));

    if (!marketsLoaded) return formattedPairs;

    const markets = client.markets as Record<string, unknown>;
    return formattedPairs.filter(({ formatted }) => formatted in markets);
  }

  private resolveFromResponse(
    slug: string,
    pending: Map<string, PendingRequest[]>,
    validPairs: Array<{ raw: string; formatted: string }>,
    tickers: Record<string, ccxt.Ticker>
  ): void {
    const fulfilled = new Set<string>();

    for (const { raw, formatted } of validPairs) {
      const ticker = tickers[formatted];
      const waiters = pending.get(raw);
      if (!waiters) continue;

      if (ticker) {
        const batched = this.toBatchedTicker(raw, slug, ticker);
        this.writeMemCache(slug, raw, batched);
        for (const waiter of waiters) waiter.resolve(batched);
      } else {
        for (const waiter of waiters) waiter.resolve(undefined);
      }
      fulfilled.add(raw);
    }

    // Any symbol we filtered out of validPairs — resolve undefined (exchange
    // doesn't list it). Callers fall through to their own fallback chain.
    for (const [raw, waiters] of pending) {
      if (fulfilled.has(raw)) continue;
      for (const waiter of waiters) waiter.resolve(undefined);
    }
  }

  private toBatchedTicker(symbol: string, source: string, ticker: ccxt.Ticker): BatchedTicker {
    const price = ticker.last ?? ticker.close ?? 0;
    const tsRaw = ticker.timestamp;
    const timestamp = new Date(typeof tsRaw === 'number' ? tsRaw : Date.now());
    return {
      symbol,
      price,
      bid: ticker.bid,
      ask: ticker.ask,
      high: ticker.high,
      low: ticker.low,
      change: ticker.change,
      percentage: ticker.percentage,
      baseVolume: ticker.baseVolume,
      quoteVolume: ticker.quoteVolume,
      timestamp,
      source
    };
  }

  private handleBatchError(
    slug: string,
    err: Error,
    pending: Map<string, PendingRequest[]>,
    symbolCount: number,
    attempts: number,
    startedAt: number,
    client?: ccxt.Exchange,
    validPairs?: Array<{ raw: string; formatted: string }>
  ): void {
    const clientError = isClientError(err);
    const errorCodeMatch = err.message?.match(/"code"\s*:\s*(-?\d+)/);
    const errorCode = errorCodeMatch ? errorCodeMatch[1] : undefined;

    const payload = {
      event: 'ticker_batch_error',
      slug,
      symbols: symbolCount,
      attempts,
      errorCode,
      durationMs: Date.now() - startedAt,
      message: err.message
    };

    if (clientError && client && validPairs) {
      this.logClientErrorOnce(slug, client, validPairs, err);
    } else if (clientError) {
      this.logThrottled(slug, () => this.logger.error(JSON.stringify({ ...payload, event: 'ticker_batch_rejected' })));
    } else {
      this.logger.warn(JSON.stringify(payload));
    }

    for (const waiters of pending.values()) {
      for (const waiter of waiters) waiter.reject(err);
    }
  }

  /**
   * Throttled (1×/5min per exchange) evidence trap for Binance client-error
   * rejections on a batch fetchTickers call. Captures *everything* CCXT already
   * has in memory at the moment of failure so we can diagnose without guessing:
   *
   * - The exact URL CCXT sent (reveals param encoding, symbol list, query shape)
   * - The raw response body from the exchange (often has extra context)
   * - Selected response headers (`x-mbx-used-weight-1m`, `cf-ray`, `server`,
   *   `x-cache`) — reveal rate-limit budget, Cloudflare routing, region hints
   * - Our unified symbols AND the exchange-specific market IDs CCXT resolved
   *   them to (mismatches here catch ghost/inactive markets)
   * - Active vs total market counts (stale market cache detection)
   *
   * No extra network calls — every field is already populated by CCXT on the
   * failing request. Safe to run inside the error path.
   */
  private logClientErrorOnce(
    slug: string,
    client: ccxt.Exchange,
    validPairs: Array<{ raw: string; formatted: string }>,
    error: Error
  ): void {
    this.logThrottled(slug, () => {
      try {
        const formatted = validPairs.map((p) => p.formatted);
        // Resolve each unified symbol to the exchange's internal market id. If this
        // differs from what we expected (e.g. returns undefined for a ghost market),
        // CCXT would serialize `[null, ...]` into the symbols param — explaining
        // Binance's "malformed" rejection.
        const marketIds = validPairs.map((p) => {
          try {
            return client.marketId(p.formatted);
          } catch (e: unknown) {
            return `<${(e as Error).message?.slice(0, 40) ?? 'resolve-failed'}>`;
          }
        });
        const markets = client.markets ?? {};
        const marketsTotal = Object.keys(markets).length;
        const marketsActive = Object.values(markets).filter((m) => m && (m as { active?: boolean }).active).length;

        // CCXT exposes the failing request/response on the exchange instance.
        // Guard every access — any of these can be undefined if the throw happened
        // before the response was parsed.
        const rawClient = client as unknown as {
          last_request_url?: string;
          last_request_body?: string;
          last_http_response?: string;
          last_response_headers?: Record<string, string>;
        };
        const responseHeaders = rawClient.last_response_headers ?? {};
        const pickHeaders = [
          'x-mbx-used-weight',
          'x-mbx-used-weight-1m',
          'cf-ray',
          'cf-cache-status',
          'server',
          'x-cache',
          'via'
        ];
        const headerSnapshot: Record<string, string | undefined> = {};
        for (const key of pickHeaders) {
          const match = Object.keys(responseHeaders).find((k) => k.toLowerCase() === key);
          if (match) headerSnapshot[key] = String(responseHeaders[match]).slice(0, 200);
        }

        this.logger.error(
          JSON.stringify({
            event: 'ticker_batch_client_error',
            message: `fetchTickers(${slug}) rejected by exchange as client error`,
            slug,
            sent_symbols: formatted,
            market_ids: marketIds,
            markets_total: marketsTotal,
            markets_active: marketsActive,
            last_request_url: (rawClient.last_request_url ?? '').slice(0, 500),
            last_request_body: (rawClient.last_request_body ?? '').slice(0, 300),
            last_http_response: (rawClient.last_http_response ?? '').slice(0, 400),
            response_headers: headerSnapshot,
            error: error.message.slice(0, 400)
          })
        );
      } catch (capErr: unknown) {
        // Never let the diagnostic throw — it must not make the failure worse.
        const info = toErrorInfo(capErr);
        this.logger.warn(`logClientErrorOnce(${slug}) failed to build diagnostic: ${info.message}`);
      }
    });
  }

  /**
   * Run `fire` at most once per CLIENT_ERROR_LOG_INTERVAL_MS per exchange.
   * Shared gate between the rich client-error log and the simpler rejection log.
   */
  private logThrottled(slug: string, fire: () => void): void {
    const now = Date.now();
    const last = this.lastClientErrorLogAt.get(slug);
    if (last !== undefined && now - last < CLIENT_ERROR_LOG_INTERVAL_MS) return;
    this.lastClientErrorLogAt.set(slug, now);
    fire();
  }
}
