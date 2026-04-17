import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';

import Redis from 'ioredis';

import { AnnouncementClient, RawAnnouncement } from './announcement-client.interface';

import { CircuitBreakerService } from '../../shared/circuit-breaker.service';
import { toErrorInfo } from '../../shared/error.util';
import { LOCK_REDIS } from '../../shared/lock-redis.provider';
import { ListingAnnouncementType } from '../entities/listing-announcement.entity';

const KRAKEN_ASSET_PAIRS_ENDPOINT = 'https://api.kraken.com/0/public/AssetPairs';
// Match against the user-facing quote (parsed from `wsname`) rather than Kraken's native `ZUSD` codes.
const ELIGIBLE_QUOTE_ASSETS = new Set(['USD', 'USDC']);
const FETCH_TIMEOUT_MS = 10_000;
const LAST_SEEN_TTL_SECONDS = 30 * 24 * 60 * 60;
// Must match `AnnouncementPollerService.LAST_SEEN_KEY()` — bootstrap seeds the same set the poller reads.
const POLLER_LAST_SEEN_KEY = (slug: string) => `listing-tracker:last-seen:${slug}`;
const BOOTSTRAP_SENTINEL_KEY = 'listing-tracker:kraken:seeded';
// Kraken's `wsname` yields the user-facing symbol (e.g. `XBT/USD`), but a few bases still use legacy short codes.
const KRAKEN_SYMBOL_ALIASES: Record<string, string> = { XBT: 'BTC', XDG: 'DOGE' };

interface KrakenAssetPair {
  altname?: string;
  wsname?: string;
  base: string;
  quote: string;
  status?: string;
}

interface KrakenAssetPairsResponse {
  result?: Record<string, KrakenAssetPair>;
  error?: string[];
}

@Injectable()
export class KrakenAnnouncementClient implements AnnouncementClient, OnModuleInit {
  readonly exchangeSlug = 'kraken';
  private readonly logger = new Logger(KrakenAnnouncementClient.name);
  private readonly circuitKey = `listing-tracker:${this.exchangeSlug}`;

  constructor(
    private readonly circuitBreaker: CircuitBreakerService,
    @Inject(LOCK_REDIS) private readonly redis: Redis
  ) {}

  async onModuleInit(): Promise<void> {
    await this.bootstrapIfNeeded();
  }

  async bootstrapIfNeeded(): Promise<boolean> {
    try {
      const alreadySeeded = await this.redis.get(BOOTSTRAP_SENTINEL_KEY);
      if (alreadySeeded) return true;

      return await this.seedFromCurrentProducts();
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.warn(`Kraken bootstrap seeding failed (will retry on next poll): ${err.message}`);
      return false;
    }
  }

  private async seedFromCurrentProducts(): Promise<boolean> {
    const pairs = await this.fetchAssetPairs();
    const bases = this.extractEligibleBases(pairs);
    if (bases.length === 0) return false;

    const lastSeenKey = POLLER_LAST_SEEN_KEY(this.exchangeSlug);
    const pipeline = this.redis.pipeline();
    for (const base of bases) {
      pipeline.sadd(lastSeenKey, this.externalIdFor(base));
    }
    pipeline.expire(lastSeenKey, LAST_SEEN_TTL_SECONDS);
    pipeline.set(BOOTSTRAP_SENTINEL_KEY, new Date().toISOString());
    await pipeline.exec();

    this.logger.log(`Kraken bootstrap seeded ${bases.length} existing products — no announcements will fire for these`);
    return true;
  }

  async getLatest(): Promise<RawAnnouncement[]> {
    this.circuitBreaker.checkCircuit(this.circuitKey);
    try {
      const pairs = await this.fetchAssetPairs();
      const bases = this.extractEligibleBases(pairs);
      this.circuitBreaker.recordSuccess(this.circuitKey);
      return bases.map((base) => this.toRawAnnouncement(base));
    } catch (error) {
      this.circuitBreaker.recordFailure(this.circuitKey);
      const err = toErrorInfo(error);
      this.logger.warn(`Kraken AssetPairs fetch failed: ${err.message}`);
      throw error;
    }
  }

  private async fetchAssetPairs(): Promise<KrakenAssetPair[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(KRAKEN_ASSET_PAIRS_ENDPOINT, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; ChanseyListingTracker/1.0)'
        },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Kraken AssetPairs HTTP ${response.status}`);
      }
      const body = (await response.json()) as KrakenAssetPairsResponse;
      return body.result ? Object.values(body.result) : [];
    } finally {
      clearTimeout(timeout);
    }
  }

  private extractEligibleBases(pairs: KrakenAssetPair[]): string[] {
    const bases = new Set<string>();
    for (const pair of pairs) {
      if (pair.status !== 'online') continue;

      const [wsBase, wsQuote] = pair.wsname ? pair.wsname.split('/') : [undefined, undefined];
      const quote = (wsQuote ?? pair.quote).toUpperCase();
      if (!ELIGIBLE_QUOTE_ASSETS.has(quote)) continue;

      const rawBase = (wsBase ?? pair.base).toUpperCase();
      const normalized = KRAKEN_SYMBOL_ALIASES[rawBase] ?? rawBase;
      bases.add(normalized);
    }
    return [...bases].sort();
  }

  private externalIdFor(base: string): string {
    return `kraken-listing:${base}`;
  }

  private toRawAnnouncement(base: string): RawAnnouncement {
    return {
      exchangeSlug: this.exchangeSlug,
      externalId: this.externalIdFor(base),
      sourceUrl: `https://pro.kraken.com/app/trade/${base.toLowerCase()}-usd`,
      title: `Kraken trading live for ${base}`,
      announcedSymbol: base,
      announcementType: ListingAnnouncementType.TRADING_LIVE,
      detectedAt: new Date(),
      rawPayload: { base, source: 'products-diff' }
    };
  }
}
