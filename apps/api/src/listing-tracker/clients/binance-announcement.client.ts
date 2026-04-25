import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';

import Redis from 'ioredis';

import { AnnouncementClient, RawAnnouncement } from './announcement-client.interface';

import { CircuitBreakerService } from '../../shared/circuit-breaker.service';
import { toErrorInfo } from '../../shared/error.util';
import { LOCK_REDIS } from '../../shared/lock-redis.provider';
import { ListingAnnouncementType } from '../entities/listing-announcement.entity';

const BINANCE_EXCHANGE_INFO_ENDPOINT = 'https://api.binance.us/api/v3/exchangeInfo';
const ELIGIBLE_QUOTE_ASSETS = new Set(['USD', 'USDT', 'USDC']);
const FETCH_TIMEOUT_MS = 10_000;
const LAST_SEEN_TTL_SECONDS = 30 * 24 * 60 * 60;
// Must match `AnnouncementPollerService.LAST_SEEN_KEY()` — bootstrap seeds the same set the poller reads.
const POLLER_LAST_SEEN_KEY = (slug: string) => `listing-tracker:last-seen:${slug}`;
const BOOTSTRAP_SENTINEL_KEY = 'listing-tracker:binance_us:seeded';

interface BinanceSymbol {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
}

interface BinanceExchangeInfoResponse {
  symbols?: BinanceSymbol[];
}

@Injectable()
export class BinanceAnnouncementClient implements AnnouncementClient, OnModuleInit {
  readonly exchangeSlug = 'binance_us';
  private readonly logger = new Logger(BinanceAnnouncementClient.name);
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
      this.logger.warn(`Binance bootstrap seeding failed (will retry on next poll): ${err.message}`);
      return false;
    }
  }

  private async seedFromCurrentProducts(): Promise<boolean> {
    const symbols = await this.fetchSymbols();
    const bases = this.extractEligibleBases(symbols);
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
      `Binance US bootstrap seeded ${bases.length} existing products — no announcements will fire for these`
    );
    return true;
  }

  async getLatest(): Promise<RawAnnouncement[]> {
    this.circuitBreaker.checkCircuit(this.circuitKey);
    try {
      const symbols = await this.fetchSymbols();
      const bases = this.extractEligibleBases(symbols);
      this.circuitBreaker.recordSuccess(this.circuitKey);
      return bases.map((base) => this.toRawAnnouncement(base));
    } catch (error) {
      this.circuitBreaker.recordFailure(this.circuitKey);
      const err = toErrorInfo(error);
      this.logger.warn(`Binance exchangeInfo fetch failed: ${err.message}`);
      throw error;
    }
  }

  private async fetchSymbols(): Promise<BinanceSymbol[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(BINANCE_EXCHANGE_INFO_ENDPOINT, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; ChanseyListingTracker/1.0)'
        },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Binance exchangeInfo HTTP ${response.status}`);
      }
      const body = (await response.json()) as BinanceExchangeInfoResponse;
      return body.symbols ?? [];
    } finally {
      clearTimeout(timeout);
    }
  }

  private extractEligibleBases(symbols: BinanceSymbol[]): string[] {
    const bases = new Set<string>();
    for (const symbol of symbols) {
      if (symbol.status !== 'TRADING') continue;
      if (!ELIGIBLE_QUOTE_ASSETS.has(symbol.quoteAsset)) continue;
      bases.add(symbol.baseAsset.toUpperCase());
    }
    return [...bases].sort();
  }

  private externalIdFor(base: string): string {
    return `binance-listing:${base}`;
  }

  private toRawAnnouncement(base: string): RawAnnouncement {
    return {
      exchangeSlug: this.exchangeSlug,
      externalId: this.externalIdFor(base),
      sourceUrl: `https://www.binance.us/trade/${base}_USDT`,
      title: `Binance trading live for ${base}`,
      announcedSymbol: base,
      announcementType: ListingAnnouncementType.TRADING_LIVE,
      detectedAt: new Date(),
      rawPayload: { base, source: 'products-diff' }
    };
  }
}
