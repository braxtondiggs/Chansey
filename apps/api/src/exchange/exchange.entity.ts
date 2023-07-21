import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Timestamp,
  UpdateDateColumn
} from 'typeorm';

import { Ticker } from './ticker/ticker.entity';

@Entity()
export class Exchange {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @Column({ unique: true })
  @ApiProperty()
  slug: string;

  @Column({ unique: true })
  @ApiProperty()
  name: string;

  @Column({ nullable: true })
  @ApiProperty()
  description?: string;

  @Column({ nullable: true })
  @ApiProperty()
  image?: string;

  @Column({ nullable: true })
  @ApiProperty()
  country?: string;

  @Column({ nullable: true })
  @ApiProperty()
  yearEstablished?: number;

  @Column({ nullable: true })
  @ApiProperty()
  trustScore?: number;

  @Column({ nullable: true })
  @ApiProperty()
  trustScoreRank?: number;

  @Column({ type: 'decimal', precision: 30, scale: 15, default: 0 })
  @ApiProperty()
  tradeVolume24HBtc?: number;

  @Column({ type: 'decimal', precision: 30, scale: 15, default: 0 })
  @ApiProperty()
  tradeVolume24HNormalized?: number;

  @Column({ nullable: true })
  @ApiProperty()
  centralized?: boolean;

  @Column({ nullable: true })
  @ApiProperty()
  url?: string;

  @Column({ nullable: true })
  @ApiProperty()
  twitter?: string;

  @Column({ nullable: true })
  @ApiProperty()
  facebook?: string;

  @Column({ nullable: true })
  @ApiProperty()
  reddit?: string;

  @Column({ nullable: true })
  @ApiProperty()
  telegram?: string;

  @Column({ nullable: true })
  @ApiProperty()
  slack?: string;

  @Column({ nullable: true })
  @ApiProperty()
  otherUrl1?: string;

  @Column({ nullable: true })
  @ApiProperty()
  otherUrl2?: string;

  @CreateDateColumn({ select: false })
  createdAt: Timestamp;

  @UpdateDateColumn({ select: false })
  updatedAt: Timestamp;

  @OneToMany(() => Ticker, (ticker) => ticker.exchange, { onDelete: 'CASCADE' })
  tickers: Ticker[];

  constructor(partial: Partial<Exchange>) {
    Object.assign(this, partial);
  }
}
