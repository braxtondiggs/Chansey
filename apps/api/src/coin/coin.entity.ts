import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Timestamp,
  UpdateDateColumn
} from 'typeorm';

import { Portfolio } from '../portfolio/portfolio.entity';
import { Price } from '../price/price.entity';

@Entity()
export class Coin {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  slug: string;

  @Column({ unique: true })
  name: string;

  @Column()
  symbol: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  image?: string;

  @Column({ type: 'date', nullable: true })
  genesis?: Date;

  @Column({ nullable: true })
  marketRank?: number;

  @Column({ nullable: true })
  geckoRank?: number;

  @Column({ type: 'decimal', nullable: true })
  developerScore?: number;

  @Column({ type: 'decimal', nullable: true })
  communityScore?: number;

  @Column({ type: 'decimal', nullable: true })
  liquidityScore?: number;

  @Column({ type: 'decimal', nullable: true })
  publicInterestScore?: number;

  @Column({ type: 'decimal', nullable: true })
  sentiment_up?: number;

  @Column({ type: 'decimal', nullable: true })
  sentiment_down?: number;

  @CreateDateColumn({ select: false })
  createdAt: Timestamp;

  @UpdateDateColumn({ select: false })
  updatedAt: Timestamp;

  @OneToMany(() => Portfolio, (portfolio) => portfolio.coin)
  portfolios: Portfolio[];

  @OneToMany(() => Price, (price) => price.coin)
  prices: Price[];
}
new Error('Function not implemented.');
