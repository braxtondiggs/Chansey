import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import Redis from 'ioredis';
import { Repository } from 'typeorm';

import { Coin } from '../../coin/coin.entity';
import { toErrorInfo } from '../../shared/error.util';
import { LOCK_REDIS } from '../../shared/lock-redis.provider';
import { AnnouncementClient, RawAnnouncement } from '../clients/announcement-client.interface';
import { BinanceAnnouncementClient } from '../clients/binance-announcement.client';
import { CoinbaseAnnouncementClient } from '../clients/coinbase-announcement.client';
import { KrakenAnnouncementClient } from '../clients/kraken-announcement.client';
import { ListingAnnouncement } from '../entities/listing-announcement.entity';

// Shared with `CoinbaseAnnouncementClient` bootstrap seeding — both must use the same key format.
const LAST_SEEN_KEY = (exchange: string) => `listing-tracker:last-seen:${exchange}`;
/** Keep the set bounded so poll diffs stay cheap. Must exceed Kraken's seeded asset-pair count (~700) — and leave headroom as exchanges add pairs — so the bootstrap isn't evicted on the first real diff. */
const LAST_SEEN_MAX = 5000;

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
    binance: BinanceAnnouncementClient,
    coinbase: CoinbaseAnnouncementClient,
    kraken: KrakenAnnouncementClient
  ) {
    this.clients = [binance, coinbase, kraken];
  }

  /**
   * Poll all announcement sources and persist any newly-seen items.
   * Returns one entry per exchange describing the outcome.
   */
  async pollAll(): Promise<PollResult[]> {
    const results = await Promise.all(this.clients.map((client) => this.pollOne(client)));
    return results;
  }

  /**
   * Poll a single client, diff against Redis last-seen set, persist new rows.
   * Individual client failures never throw — the circuit breaker inside the
   * client already tracks repeated failures for alerting.
   */
  async pollOne(client: AnnouncementClient): Promise<PollResult> {
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
        const persisted = await this.persist(item);
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

  private async persist(item: RawAnnouncement): Promise<ListingAnnouncement | null> {
    try {
      const existing = await this.announcementRepo.findOne({
        where: { exchangeSlug: item.exchangeSlug, sourceUrl: item.sourceUrl }
      });
      if (existing) return null;

      const coinId = await this.resolveCoinId(item.announcedSymbol);

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

  private async resolveCoinId(symbol: string): Promise<string | null> {
    const coin = await this.coinRepo.findOne({ where: { symbol: symbol.toLowerCase() } });
    return coin?.id ?? null;
  }
}
