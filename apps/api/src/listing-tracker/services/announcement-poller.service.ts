import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import Redis from 'ioredis';
import { Repository } from 'typeorm';

import { Coin } from '../../coin/coin.entity';
import { CircuitBreakerService } from '../../shared/circuit-breaker.service';
import { CoinGeckoClientService } from '../../shared/coingecko-client.service';
import { toErrorInfo } from '../../shared/error.util';
import { LOCK_REDIS } from '../../shared/lock-redis.provider';
import { withRateLimitRetry } from '../../shared/retry.util';
import { AnnouncementClient, RawAnnouncement } from '../clients/announcement-client.interface';
import { BinanceAnnouncementClient } from '../clients/binance-announcement.client';
import { CoinbaseAnnouncementClient } from '../clients/coinbase-announcement.client';
import { KrakenAnnouncementClient } from '../clients/kraken-announcement.client';
import { ListingAnnouncement } from '../entities/listing-announcement.entity';

// Shared with `CoinbaseAnnouncementClient` bootstrap seeding — both must use the same key format.
const LAST_SEEN_KEY = (exchange: string) => `listing-tracker:last-seen:${exchange}`;
/** Keep the set bounded so poll diffs stay cheap. Must exceed Kraken's seeded asset-pair count (~700) — and leave headroom as exchanges add pairs — so the bootstrap isn't evicted on the first real diff. */
const LAST_SEEN_MAX = 5000;

const COINGECKO_CIRCUIT_KEY = 'listing-tracker:coingecko-symbol-lookup';
/** Cache the full CoinGecko coin list for 24h in Redis so every poll doesn't hit the network. */
const COINGECKO_LIST_CACHE_KEY = 'listing-tracker:coingecko-coin-list';
const COINGECKO_LIST_CACHE_TTL_SECONDS = 24 * 60 * 60;

interface CachedGeckoListItem {
  id: string;
  symbol: string;
}

export interface PollResult {
  exchangeSlug: string;
  fetched: number;
  inserted: ListingAnnouncement[];
  error?: string;
}

@Injectable()
export class AnnouncementPollerService {
  private readonly logger = new Logger(AnnouncementPollerService.name);
  private readonly clients: AnnouncementClient[];

  constructor(
    @InjectRepository(ListingAnnouncement)
    private readonly announcementRepo: Repository<ListingAnnouncement>,
    @InjectRepository(Coin) private readonly coinRepo: Repository<Coin>,
    @Inject(LOCK_REDIS) private readonly redis: Redis,
    private readonly gecko: CoinGeckoClientService,
    private readonly circuitBreaker: CircuitBreakerService,
    binance: BinanceAnnouncementClient,
    coinbase: CoinbaseAnnouncementClient,
    kraken: KrakenAnnouncementClient
  ) {
    this.clients = [binance, coinbase, kraken];
  }

  /**
   * Poll all announcement sources and persist any newly-seen items.
   * Returns one entry per exchange describing the outcome.
   *
   * Each invocation builds a lazy per-call memo of the CoinGecko symbol index
   * so multiple unmatched-symbol lookups across all clients within the same
   * poll share one Redis/network fetch and one O(N) index build.
   */
  async pollAll(): Promise<PollResult[]> {
    let geckoSymbolIndex: Map<string, string[]> | null = null;
    const getGeckoIndex = async (): Promise<Map<string, string[]>> => {
      if (geckoSymbolIndex) return geckoSymbolIndex;
      const list = await this.getCachedGeckoList();
      const idx = new Map<string, string[]>();
      for (const item of list) {
        const ids = idx.get(item.symbol);
        if (ids) ids.push(item.id);
        else idx.set(item.symbol, [item.id]);
      }
      geckoSymbolIndex = idx;
      return idx;
    };

    const results = await Promise.all(this.clients.map((client) => this.pollOne(client, getGeckoIndex)));
    return results;
  }

  /**
   * Poll a single client, diff against Redis last-seen set, persist new rows.
   * Individual client failures never throw — the circuit breaker inside the
   * client already tracks repeated failures for alerting.
   */
  async pollOne(client: AnnouncementClient, getGeckoIndex?: () => Promise<Map<string, string[]>>): Promise<PollResult> {
    try {
      // Fail-closed: if bootstrap sentinel is missing we cannot distinguish new listings
      // from the existing product catalog. Skip the poll rather than fan out hundreds of trades.
      const ready = await client.bootstrapIfNeeded();
      if (!ready) {
        this.logger.warn(`Skipping ${client.exchangeSlug} poll — bootstrap sentinel not set`);
        return { exchangeSlug: client.exchangeSlug, fetched: 0, inserted: [], error: 'bootstrap_pending' };
      }

      const items = await client.getLatest();
      const lastSeenKey = LAST_SEEN_KEY(client.exchangeSlug);
      const seen = new Set(await this.redis.smembers(lastSeenKey));

      const fresh = items.filter((item) => !seen.has(item.externalId));
      if (fresh.length === 0) {
        return { exchangeSlug: client.exchangeSlug, fetched: items.length, inserted: [] };
      }

      const inserted: ListingAnnouncement[] = [];
      for (const item of fresh) {
        const persisted = await this.persist(item, getGeckoIndex);
        if (persisted) inserted.push(persisted);
      }

      // Update last-seen set (capped size to avoid unbounded growth)
      if (fresh.length > 0) {
        const pipeline = this.redis.pipeline();
        for (const item of fresh) pipeline.sadd(lastSeenKey, item.externalId);
        pipeline.expire(lastSeenKey, 30 * 24 * 60 * 60); // 30 days
        await pipeline.exec();

        const size = await this.redis.scard(lastSeenKey);
        if (size > LAST_SEEN_MAX) {
          await this.redis.spop(lastSeenKey, size - LAST_SEEN_MAX);
        }
      }

      return { exchangeSlug: client.exchangeSlug, fetched: items.length, inserted };
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.warn(`Poll failed for ${client.exchangeSlug}: ${err.message}`);
      return { exchangeSlug: client.exchangeSlug, fetched: 0, inserted: [], error: err.message };
    }
  }

  private async persist(
    item: RawAnnouncement,
    getGeckoIndex?: () => Promise<Map<string, string[]>>
  ): Promise<ListingAnnouncement | null> {
    try {
      const existing = await this.announcementRepo.findOne({
        where: { exchangeSlug: item.exchangeSlug, sourceUrl: item.sourceUrl }
      });
      if (existing) return null;

      const coinId = await this.resolveCoinId(item.announcedSymbol, getGeckoIndex);

      const entity = this.announcementRepo.create({
        exchangeSlug: item.exchangeSlug,
        coinId,
        announcedSymbol: item.announcedSymbol,
        announcementType: item.announcementType,
        sourceUrl: item.sourceUrl,
        detectedAt: item.detectedAt,
        rawPayload: item.rawPayload,
        dispatched: false
      });
      return await this.announcementRepo.save(entity);
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to persist ${item.exchangeSlug} announcement ${item.sourceUrl}: ${err.message}`);
      return null;
    }
  }

  private async resolveCoinId(
    symbol: string,
    getGeckoIndex?: () => Promise<Map<string, string[]>>
  ): Promise<string | null> {
    const normalized = symbol.toLowerCase();
    const local = await this.coinRepo.findOne({ where: { symbol: normalized } });
    if (local) return local.id;
    return this.resolveFromCoinGecko(normalized, getGeckoIndex);
  }

  /**
   * Fallback lookup when the symbol isn't yet in our `coin` table. Matches against
   * CoinGecko's `/coins/list` (24h Redis-cached) and returns a coin id only when
   * there's exactly one symbol match — ambiguous or missing symbols stay null so
   * the dispatcher can log them instead of linking the wrong coin.
   *
   * Uses a per-`pollAll()` memoized symbol→ids index when provided so concurrent
   * unmatched symbols share one indexing pass.
   */
  private async resolveFromCoinGecko(
    lowerSymbol: string,
    getGeckoIndex?: () => Promise<Map<string, string[]>>
  ): Promise<string | null> {
    try {
      const index = getGeckoIndex ? await getGeckoIndex() : await this.buildGeckoIndex();
      if (index.size === 0) return null;

      const matches = index.get(lowerSymbol) ?? [];
      if (matches.length === 0) return null;
      if (matches.length > 1) {
        this.logger.warn(
          `CoinGecko symbol '${lowerSymbol}' matched ${matches.length} coins — leaving announcement unmapped (candidates: ${matches
            .slice(0, 5)
            .join(', ')}${matches.length > 5 ? '…' : ''})`
        );
        return null;
      }

      const geckoId = matches[0];
      const local = await this.coinRepo.findOne({ where: { slug: geckoId } });
      return local?.id ?? null;
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.warn(`CoinGecko symbol lookup failed for '${lowerSymbol}': ${err.message}`);
      return null;
    }
  }

  /**
   * One-off index build for callers that didn't provide a memoized getter
   * (e.g. direct `pollOne` invocations from tests).
   */
  private async buildGeckoIndex(): Promise<Map<string, string[]>> {
    const list = await this.getCachedGeckoList();
    const idx = new Map<string, string[]>();
    for (const item of list) {
      const ids = idx.get(item.symbol);
      if (ids) ids.push(item.id);
      else idx.set(item.symbol, [item.id]);
    }
    return idx;
  }

  private async getCachedGeckoList(): Promise<CachedGeckoListItem[]> {
    try {
      const cached = await this.redis.get(COINGECKO_LIST_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as CachedGeckoListItem[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.warn(`Cache read failed for CoinGecko list: ${err.message}`);
    }

    this.circuitBreaker.checkCircuit(COINGECKO_CIRCUIT_KEY);
    const retryResult = await withRateLimitRetry(() => this.gecko.client.coins.list.get({ include_platform: false }), {
      maxRetries: 2,
      logger: this.logger,
      operationName: 'listing-tracker:coingecko-list'
    });
    if (!retryResult.success) {
      this.circuitBreaker.recordFailure(COINGECKO_CIRCUIT_KEY);
      throw retryResult.error;
    }
    this.circuitBreaker.recordSuccess(COINGECKO_CIRCUIT_KEY);

    const list: CachedGeckoListItem[] = (retryResult.result ?? [])
      .map((item) => {
        const id = typeof item.id === 'string' ? item.id : null;
        const symbol = typeof item.symbol === 'string' ? item.symbol.toLowerCase() : null;
        return id && symbol ? { id, symbol } : null;
      })
      .filter((item): item is CachedGeckoListItem => item !== null);

    if (list.length > 0) {
      try {
        await this.redis.set(COINGECKO_LIST_CACHE_KEY, JSON.stringify(list), 'EX', COINGECKO_LIST_CACHE_TTL_SECONDS);
      } catch (error) {
        const err = toErrorInfo(error);
        this.logger.warn(`Cache write failed for CoinGecko list: ${err.message}`);
      }
    }
    return list;
  }
}
