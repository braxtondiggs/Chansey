import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn, Relation } from 'typeorm';

import { Coin } from './coin.entity';

import { Exchange } from '../exchange/exchange.entity';

export enum CoinListingEventType {
  LISTED = 'LISTED',
  DELISTED = 'DELISTED'
}

@Entity('coin_listing_events')
@Index(['coin', 'eventType'])
export class CoinListingEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Coin, { onDelete: 'CASCADE' })
  coin: Relation<Coin>;

  @Column({ type: 'uuid' })
  coinId: string;

  @ManyToOne(() => Exchange, { nullable: true, onDelete: 'SET NULL' })
  exchange: Relation<Exchange> | null;

  @Column({ type: 'uuid', nullable: true })
  exchangeId: string | null;

  @Column({ type: 'enum', enum: CoinListingEventType, enumName: 'coin_listing_event_type_enum' })
  eventType: CoinListingEventType;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  eventDate: Date;

  @Column({ type: 'varchar', length: 50, default: 'coin_sync' })
  source: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
