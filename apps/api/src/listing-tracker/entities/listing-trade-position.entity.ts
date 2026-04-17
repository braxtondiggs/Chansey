import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn
} from 'typeorm';

import { ListingAnnouncement } from './listing-announcement.entity';
import { ListingCandidate } from './listing-candidate.entity';

import { Coin } from '../../coin/coin.entity';
import { Order } from '../../order/order.entity';
import { User } from '../../users/users.entity';

export enum ListingStrategyType {
  PRE_LISTING = 'PRE_LISTING',
  POST_ANNOUNCEMENT = 'POST_ANNOUNCEMENT'
}

export enum ListingPositionStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  EXITED_TIME_STOP = 'EXITED_TIME_STOP',
  EXITED_SL = 'EXITED_SL',
  EXITED_TP = 'EXITED_TP'
}

@Entity('listing_trade_positions')
@Index(['userId', 'status', 'expiresAt'])
@Index(['orderId'])
export class ListingTradePosition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: Relation<User>;

  @Column({ type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: Relation<Order>;

  @Column({ type: 'enum', enum: ListingStrategyType })
  strategyType: ListingStrategyType;

  @Column({ type: 'uuid' })
  coinId: string;

  @ManyToOne(() => Coin, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'coinId' })
  coin: Relation<Coin>;

  @Column({ type: 'uuid', nullable: true })
  announcementId?: string | null;

  @ManyToOne(() => ListingAnnouncement, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'announcementId' })
  announcement?: Relation<ListingAnnouncement> | null;

  @Column({ type: 'uuid', nullable: true })
  candidateId?: string | null;

  @ManyToOne(() => ListingCandidate, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'candidateId' })
  candidate?: Relation<ListingCandidate> | null;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'uuid', nullable: true })
  hedgeOrderId?: string | null;

  @ManyToOne(() => Order, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'hedgeOrderId' })
  hedgeOrder?: Relation<Order> | null;

  @Column({ type: 'enum', enum: ListingPositionStatus, default: ListingPositionStatus.OPEN })
  status: ListingPositionStatus;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  constructor(partial: Partial<ListingTradePosition> = {}) {
    Object.assign(this, partial);
  }
}
