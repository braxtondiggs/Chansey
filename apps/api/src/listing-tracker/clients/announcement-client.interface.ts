import { type ListingAnnouncementType } from '../entities/listing-announcement.entity';

/**
 * Raw announcement returned by a listing-tracker client. Callers normalize
 * these into `ListingAnnouncement` rows with a resolved `coinId` (or null).
 */
export interface RawAnnouncement {
  exchangeSlug: string;
  externalId: string;
  sourceUrl: string;
  title: string;
  announcedSymbol: string;
  announcementType: ListingAnnouncementType;
  detectedAt: Date;
  rawPayload: Record<string, unknown>;
}

export interface AnnouncementClient {
  readonly exchangeSlug: string;
  getLatest(): Promise<RawAnnouncement[]>;
  /**
   * Ensures the bootstrap sentinel is set in Redis. If missing, attempts to
   * seed the poller's last-seen set so the first real poll does not treat
   * every live product as a brand-new listing. Returns true if the sentinel
   * is present (either already set, or newly seeded).
   */
  bootstrapIfNeeded(): Promise<boolean>;
}
