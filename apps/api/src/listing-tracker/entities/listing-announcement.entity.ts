import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  Unique
} from 'typeorm';

import { Coin } from '../../coin/coin.entity';

export enum ListingAnnouncementType {
  NEW_LISTING = 'NEW_LISTING',
  TRADING_LIVE = 'TRADING_LIVE',
  DEPOSITS_OPEN = 'DEPOSITS_OPEN'
}

@Entity('listing_announcements')
@Unique('UQ_listing_announcements_exchange_source', ['exchangeSlug', 'sourceUrl'])
@Index(['exchangeSlug', 'detectedAt'])
@Index(['dispatched', 'detectedAt'])
export class ListingAnnouncement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40 })
  exchangeSlug: string;

  @Column({ type: 'uuid', nullable: true })
  coinId?: string | null;

  @ManyToOne(() => Coin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'coinId' })
  coin?: Relation<Coin> | null;

  @Column({ type: 'varchar', length: 30 })
  announcedSymbol: string;

  @Column({ type: 'enum', enum: ListingAnnouncementType, default: ListingAnnouncementType.NEW_LISTING })
  announcementType: ListingAnnouncementType;

  @Column({ type: 'varchar', length: 2048 })
  sourceUrl: string;

  @Column({ type: 'timestamptz' })
  detectedAt: Date;

  @Column({ type: 'jsonb', nullable: true })
  rawPayload?: Record<string, unknown> | null;

  @Column({ type: 'boolean', default: false })
  dispatched: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  constructor(partial: Partial<ListingAnnouncement> = {}) {
    Object.assign(this, partial);
  }
}
