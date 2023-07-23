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

import { Ticker } from '../exchange/ticker/ticker.entity';
import { Portfolio } from '../portfolio/portfolio.entity';
import { Price } from '../price/price.entity';

@Entity()
export class Coin {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @Column({ unique: true })
  @ApiProperty()
  slug: string;

  @Column({ unique: true })
  @ApiProperty()
  name: string;

  @Column()
  @ApiProperty()
  symbol: string;

  @Column({ nullable: true })
  @ApiProperty()
  description?: string;

  @Column({ nullable: true })
  @ApiProperty()
  image?: string;

  @Column({ type: 'date', nullable: true })
  @ApiProperty()
  genesis?: Date;

  @Column({ nullable: true })
  @ApiProperty()
  marketRank?: number;

  @Column({ nullable: true })
  @ApiProperty()
  totalSupply?: number;

  @Column({ nullable: true })
  @ApiProperty()
  circulatingSupply?: number;

  @Column({ nullable: true })
  @ApiProperty()
  maxSupply?: number;

  @Column({ nullable: true })
  @ApiProperty()
  geckoRank?: number;

  @Column({ type: 'decimal', default: null })
  @ApiProperty()
  developerScore?: number;

  @Column({ type: 'decimal', default: null })
  @ApiProperty()
  communityScore?: number;

  @Column({ type: 'decimal', default: null })
  @ApiProperty()
  liquidityScore?: number;

  @Column({ type: 'decimal', default: null })
  @ApiProperty()
  publicInterestScore?: number;

  @Column({ type: 'decimal', default: null })
  @ApiProperty()
  sentimentUp?: number;

  @Column({ type: 'decimal', default: null })
  @ApiProperty()
  sentimentDown?: number;

  @Column({ type: 'decimal', default: null })
  @ApiProperty()
  ath: number;

  @Column({ type: 'decimal', default: null })
  @ApiProperty()
  athChange: number;

  @Column({ type: 'timestamptz', default: null })
  @ApiProperty()
  athDate: Date;

  @Column({ type: 'decimal', default: null })
  @ApiProperty()
  atl: number;

  @Column({ type: 'decimal', default: null })
  @ApiProperty()
  atlChange: number;

  @Column({ type: 'timestamptz', default: null })
  @ApiProperty()
  atlDate: Date;

  @Column({ type: 'timestamptz', default: null })
  @ApiProperty()
  geckoLastUpdatedAt: Date;

  @CreateDateColumn({ select: false })
  createdAt: Timestamp;

  @UpdateDateColumn({ select: false })
  updatedAt: Timestamp;

  @OneToMany(() => Portfolio, (portfolio) => portfolio.coin)
  @ApiProperty({
    type: Portfolio,
    isArray: true
  })
  portfolios: Portfolio[];

  @OneToMany(() => Price, (price) => price.coin)
  @ApiProperty({
    type: Price,
    isArray: true
  })
  prices: Price[];

  @OneToMany(() => Ticker, (ticker) => ticker.coin)
  @ApiProperty({
    type: Ticker,
    isArray: true
  })
  tickers: Ticker[];

  constructor(partial: Partial<Coin>) {
    Object.assign(this, partial);
  }
}

export enum CoinRelations {
  PRICES = 'prices',
  PORTFOLIOS = 'portfolios',
  TICKERS = 'tickers'
}
