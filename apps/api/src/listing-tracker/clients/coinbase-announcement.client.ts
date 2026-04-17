import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';

import Redis from 'ioredis';

import { AnnouncementClient, RawAnnouncement } from './announcement-client.interface';

import { CircuitBreakerService } from '../../shared/circuit-breaker.service';
import { toErrorInfo } from '../../shared/error.util';
import { LOCK_REDIS } from '../../shared/lock-redis.provider';
import { ListingAnnouncementType } from '../entities/listing-announcement.entity';

const COINBASE_PRODUCTS_ENDPOINT = 'https://api.exchange.coinbase.com/products';
const ELIGIBLE_QUOTE_CURRENCIES = new Set(['USD', 'USDC']);
const FETCH_TIMEOUT_MS = 10_000;
const LAST_SEEN_TTL_SECONDS = 30 * 24 * 60 * 60;
// Must match `AnnouncementPollerService.LAST_SEEN_KEY()` — bootstrap seeds the same set the poller reads.
const POLLER_LAST_SEEN_KEY = (slug: string) => `listing-tracker:last-seen:${slug}`;
const BOOTSTRAP_SENTINEL_KEY = 'listing-tracker:coinbase:seeded';

interface CoinbaseProduct {
  id: string;
  base_currency: string;
  quote_currency: string;
  status: 'online' | 'delisted' | string;
  fx_stablecoin?: boolean;
}

@Injectable()
export class CoinbaseAnnouncementClient implements AnnouncementClient, OnModuleInit {
  readonly exchangeSlug = 'coinbase';
  private readonly logger = new Logger(CoinbaseAnnouncementClient.name);
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
      this.logger.warn(`Coinbase bootstrap seeding failed (will retry on next poll): ${err.message}`);
      return false;
    }
  }

  private async seedFromCurrentProducts(): Promise<boolean> {
    const products = await this.fetchProducts();
    const bases = this.extractEligibleBases(products);
    if (bases.length === 0) return false;

    const lastSeenKey = POLLER_LAST_SEEN_KEY(this.exchangeSlug);
    const pipeline = this.redis.pipeline();
    for (const base of bases) {
      pipeline.sadd(lastSeenKey, this.externalIdFor(base));
    }
    pipeline.expire(lastSeenKey, LAST_SEEN_TTL_SECONDS);
    pipeline.set(BOOTSTRAP_SENTINEL_KEY, new Date().toISOString());
    await pipeline.exec();

    this.logger.log(
      `Coinbase bootstrap seeded ${bases.length} existing products — no announcements will fire for these`
    );
    return true;
  }

  async getLatest(): Promise<RawAnnouncement[]> {
    this.circuitBreaker.checkCircuit(this.circuitKey);
    try {
      const products = await this.fetchProducts();
      const bases = this.extractEligibleBases(products);
      this.circuitBreaker.recordSuccess(this.circuitKey);
      return bases.map((base) => this.toRawAnnouncement(base));
    } catch (error) {
      this.circuitBreaker.recordFailure(this.circuitKey);
      const err = toErrorInfo(error);
      this.logger.warn(`Coinbase products fetch failed: ${err.message}`);
      throw error;
    }
  }

  private async fetchProducts(): Promise<CoinbaseProduct[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(COINBASE_PRODUCTS_ENDPOINT, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; ChanseyListingTracker/1.0)'
        },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Coinbase products HTTP ${response.status}`);
      }
      return (await response.json()) as CoinbaseProduct[];
    } finally {
      clearTimeout(timeout);
    }
  }

  private extractEligibleBases(products: CoinbaseProduct[]): string[] {
    const bases = new Set<string>();
    for (const product of products) {
      if (product.status !== 'online') continue;
      if (!ELIGIBLE_QUOTE_CURRENCIES.has(product.quote_currency)) continue;
      if (product.fx_stablecoin) continue;
      bases.add(product.base_currency.toUpperCase());
    }
    return [...bases].sort();
  }

  private externalIdFor(base: string): string {
    return `coinbase-listing:${base}`;
  }

  private toRawAnnouncement(base: string): RawAnnouncement {
    return {
      exchangeSlug: this.exchangeSlug,
      externalId: this.externalIdFor(base),
      sourceUrl: `https://exchange.coinbase.com/markets/${base}-USD`,
      title: `Coinbase trading live for ${base}`,
      announcedSymbol: base,
      announcementType: ListingAnnouncementType.TRADING_LIVE,
      detectedAt: new Date(),
      rawPayload: { base, source: 'products-diff' }
    };
  }
}
