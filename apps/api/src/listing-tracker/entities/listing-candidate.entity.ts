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

import { Coin } from '../../coin/coin.entity';
import { NUMERIC_TRANSFORMER } from '../../utils/transformers';

export interface ListingScoreBreakdown {
  tvlGrowth90d: number;
  crossListingCount: number;
  categoryMomentum: number;
  socialVelocity: number;
  marketCapRank: number;
  krakenListed: boolean;
  socialDataAvailable: boolean;
  weights: Record<string, number>;
  raw?: Record<string, unknown>;
}

@Entity('listing_candidates')
@Index(['qualified', 'score'])
export class ListingCandidate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  coinId: string;

  @ManyToOne(() => Coin, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'coinId' })
  coin: Relation<Coin>;

  @Column({ type: 'decimal', precision: 6, scale: 2, transformer: NUMERIC_TRANSFORMER, default: 0 })
  score: number;

  @Column({ type: 'jsonb', nullable: true })
  scoreBreakdown?: ListingScoreBreakdown | null;

  @Column({ type: 'boolean', default: false })
  qualified: boolean;

  @Column({ type: 'timestamptz' })
  firstScoredAt: Date;

  @Column({ type: 'timestamptz' })
  lastScoredAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastTradedAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  constructor(partial: Partial<ListingCandidate> = {}) {
    Object.assign(this, partial);
  }
}
