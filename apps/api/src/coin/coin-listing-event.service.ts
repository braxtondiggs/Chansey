import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, LessThanOrEqual, QueryDeepPartialEntity, Repository } from 'typeorm';

import { CoinListingEvent, CoinListingEventType } from './coin-listing-event.entity';

@Injectable()
export class CoinListingEventService {
  constructor(
    @InjectRepository(CoinListingEvent)
    private readonly repo: Repository<CoinListingEvent>
  ) {}

  async recordEvent(
    coinId: string,
    eventType: CoinListingEventType,
    options?: { exchangeId?: string; source?: string; metadata?: Record<string, unknown> }
  ): Promise<CoinListingEvent> {
    const event = this.repo.create({
      coinId,
      eventType,
      exchangeId: options?.exchangeId ?? null,
      source: options?.source ?? 'coin_sync',
      metadata: options?.metadata ?? null,
      eventDate: new Date()
    });
    return this.repo.save(event);
  }

  async recordBulkDelistings(coinIds: string[], source = 'coin_sync'): Promise<void> {
    if (coinIds.length === 0) return;

    const now = new Date();
    const events: QueryDeepPartialEntity<CoinListingEvent>[] = coinIds.map((coinId) => ({
      coinId,
      eventType: CoinListingEventType.DELISTED,
      source,
      eventDate: now
    }));
    await this.repo.insert(events);
  }

  async recordBulkListings(coinIds: string[], source = 'coin_sync'): Promise<void> {
    if (coinIds.length === 0) return;

    const now = new Date();
    const events: QueryDeepPartialEntity<CoinListingEvent>[] = coinIds.map((coinId) => ({
      coinId,
      eventType: CoinListingEventType.LISTED,
      source,
      eventDate: now
    }));
    await this.repo.insert(events);
  }

  async recordBulkRelistings(coinIds: string[], source = 'coin_sync'): Promise<void> {
    if (coinIds.length === 0) return;

    const now = new Date();
    const events: QueryDeepPartialEntity<CoinListingEvent>[] = coinIds.map((coinId) => ({
      coinId,
      eventType: CoinListingEventType.RELISTED,
      source,
      eventDate: now
    }));
    await this.repo.insert(events);
  }

  async getEventsByCoin(coinId: string): Promise<CoinListingEvent[]> {
    return this.repo.find({
      where: { coinId },
      order: { eventDate: 'DESC' }
    });
  }

  /**
   * Returns coins currently delisted as of `asOfDate` (most recent DELISTED event with no
   * subsequent RELISTED before `asOfDate`).
   * Returns a Map of coinId → delistingDate for use in backtest forced-exit logic.
   */
  async getActiveDelistingsAsOf(coinIds: string[], asOfDate: Date): Promise<Map<string, Date>> {
    if (coinIds.length === 0) return new Map();

    // Fetch all DELISTED and RELISTED events for the given coins up to asOfDate
    const events = await this.repo.find({
      where: [
        { coinId: In(coinIds), eventType: CoinListingEventType.DELISTED, eventDate: LessThanOrEqual(asOfDate) },
        { coinId: In(coinIds), eventType: CoinListingEventType.RELISTED, eventDate: LessThanOrEqual(asOfDate) }
      ],
      order: { eventDate: 'ASC' }
    });

    // Group events by coin
    const eventsByCoin = new Map<string, CoinListingEvent[]>();
    for (const event of events) {
      const existing = eventsByCoin.get(event.coinId) ?? [];
      existing.push(event);
      eventsByCoin.set(event.coinId, existing);
    }

    const result = new Map<string, Date>();

    for (const [coinId, coinEvents] of eventsByCoin) {
      // Find the latest DELISTED event within the range
      let latestDelisting: Date | null = null;

      for (const event of coinEvents) {
        if (event.eventType === CoinListingEventType.DELISTED && event.eventDate <= asOfDate) {
          latestDelisting = event.eventDate;
        }
      }

      if (!latestDelisting) continue;

      // Check if a RELISTED event exists after the delisting and before asOfDate
      const delistingDate = latestDelisting;
      const wasRelisted = coinEvents.some(
        (e) => e.eventType === CoinListingEventType.RELISTED && e.eventDate > delistingDate && e.eventDate <= asOfDate
      );

      if (!wasRelisted) {
        result.set(coinId, latestDelisting);
      }
    }

    return result;
  }
}
