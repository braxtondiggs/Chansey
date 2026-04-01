import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { QueryDeepPartialEntity, Repository } from 'typeorm';

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

  async getEventsByCoin(coinId: string): Promise<CoinListingEvent[]> {
    return this.repo.find({
      where: { coinId },
      order: { eventDate: 'DESC' }
    });
  }
}
