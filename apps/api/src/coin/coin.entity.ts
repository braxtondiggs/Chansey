import { ApiProperty } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { CoinPairs } from './pairs/pairs.entity';
import { Ticker } from '../exchange/ticker/ticker.entity';
import { Order } from '../order/order.entity';
import { Portfolio } from '../portfolio/portfolio.entity';
import { Price } from '../price/price.entity';

@Entity()
export class Coin {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique identifier for the coin',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  id: string;

  @Column({ unique: true })
  @ApiProperty({
    description: 'Unique slug identifier for the coin',
    example: 'bitcoin'
  })
  slug: string;

  @Column()
  @ApiProperty({
    description: 'Name of the coin',
    example: 'Bitcoin'
  })
  name: string;

  @Column()
  @ApiProperty({
    description: 'Symbol of the coin',
    example: 'BTC'
  })
  symbol: string;

  @Column({ nullable: true })
  @ApiProperty({
    description: 'Description of the coin',
    example: 'Bitcoin is a decentralized digital currency...',
    required: false
  })
  description?: string;

  @Column({ nullable: true })
  @ApiProperty({
    description: "URL to the coin's image",
    example: 'https://example.com/images/bitcoin.png',
    required: false
  })
  image?: string;

  @Column({ type: 'date', nullable: true })
  @ApiProperty({
    description: 'Genesis date of the coin',
    example: '2009-01-03',
    required: false
  })
  genesis?: Date;

  @Column({ type: 'int', nullable: true })
  @ApiProperty({
    description: 'Market rank of the coin',
    example: 1,
    required: false
  })
  marketRank?: number;

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true, default: null })
  @ApiProperty({
    description: 'Total supply of the coin',
    example: 21000000.0,
    required: false,
    type: Number
  })
  totalSupply?: number;

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true, default: null })
  @ApiProperty({
    description: 'Circulating supply of the coin',
    example: 18500000.0,
    required: false,
    type: Number
  })
  circulatingSupply?: number;

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true, default: null })
  @ApiProperty({
    description: 'Maximum supply of the coin',
    example: 21000000.0,
    required: false,
    type: Number
  })
  maxSupply?: number;

  @Column({ type: 'int', nullable: true })
  @ApiProperty({
    description: 'Coingecko rank of the coin',
    example: 1,
    required: false
  })
  geckoRank?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, default: null })
  @ApiProperty({
    description: 'Developer score of the coin',
    example: 75.5,
    required: false,
    type: Number
  })
  developerScore?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, default: null })
  @ApiProperty({
    description: 'Community score of the coin',
    example: 80.0,
    required: false,
    type: Number
  })
  communityScore?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, default: null })
  @ApiProperty({
    description: 'Liquidity score of the coin',
    example: 70.0,
    required: false,
    type: Number
  })
  liquidityScore?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, default: null })
  @ApiProperty({
    description: 'Public interest score of the coin',
    example: 85.0,
    required: false,
    type: Number
  })
  publicInterestScore?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, default: null })
  @ApiProperty({
    description: 'Sentiment up score',
    example: 60.0,
    required: false,
    type: Number
  })
  sentimentUp?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, default: null })
  @ApiProperty({
    description: 'Sentiment down score',
    example: 40.0,
    required: false,
    type: Number
  })
  sentimentDown?: number;

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true, default: null })
  @ApiProperty({
    description: 'All-time high price of the coin',
    example: 60000.0,
    required: false,
    type: Number
  })
  ath?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, default: null })
  @ApiProperty({
    description: 'Change from all-time high',
    example: -20.0,
    required: false,
    type: Number
  })
  athChange?: number;

  @Column({ type: 'timestamptz', nullable: true, default: null })
  @ApiProperty({
    description: 'Date when ATH was reached',
    example: '2021-04-14T00:00:00Z',
    required: false,
    type: Date
  })
  athDate?: Date;

  @Column({ type: 'decimal', precision: 20, scale: 8, default: null })
  @ApiProperty({
    description: 'All-time low price of the coin',
    example: 3000.0,
    required: false,
    type: Number
  })
  atl?: number;

  @Column({ type: 'decimal', precision: 7, scale: 2, default: null })
  @ApiProperty({
    description: 'Change from all-time low',
    example: 50.0,
    required: false,
    type: Number
  })
  atlChange?: number;

  @Column({ type: 'timestamptz', default: null })
  @ApiProperty({
    description: 'Date when ATL was reached',
    example: '2013-12-18T00:00:00Z',
    required: false,
    type: Date
  })
  atlDate?: Date;

  @Column({ type: 'timestamptz', nullable: true, default: null })
  @ApiProperty({
    description: 'Date when Coingecko last updated the coin information',
    example: '2023-09-15T12:34:56Z',
    required: false,
    type: Date
  })
  geckoLastUpdatedAt?: Date;

  @CreateDateColumn({ type: 'timestamptz', select: false })
  @ApiProperty({
    description: 'Timestamp when the coin was created',
    example: '2022-01-01T00:00:00Z',
    readOnly: true
  })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', select: false })
  @ApiProperty({
    description: 'Timestamp when the coin was last updated',
    example: '2023-01-01T00:00:00Z',
    readOnly: true
  })
  updatedAt: Date;

  @OneToMany(() => Order, (order) => order.coin)
  @ApiProperty({
    description: 'List of orders for the coin',
    type: () => Order,
    isArray: true,
    required: false
  })
  orders: Order[];

  @OneToMany(() => Portfolio, (portfolio) => portfolio.coin)
  @ApiProperty({
    description: 'List of portfolios associated with the coin',
    type: () => Portfolio,
    isArray: true,
    required: false
  })
  portfolios: Portfolio[];

  @OneToMany(() => Price, (price) => price.coin)
  @ApiProperty({
    description: 'List of prices for the coin',
    type: () => Price,
    isArray: true,
    required: false
  })
  prices: Price[];

  @OneToMany(() => Ticker, (ticker) => ticker.coin)
  @ApiProperty({
    description: 'List of tickers for the coin',
    type: () => Ticker,
    isArray: true,
    required: false
  })
  tickers: Ticker[];

  @OneToMany(() => Ticker, (ticker) => ticker.target)
  @ApiProperty({
    description: 'List of tickers where the coin is the target',
    type: () => Ticker,
    isArray: true,
    required: false
  })
  tickersAsTarget: Ticker[];

  @OneToMany(() => CoinPairs, (pair) => pair.baseAsset)
  @ApiProperty({
    description: 'Trading pairs where this coin is the base asset',
    type: () => CoinPairs,
    isArray: true,
    required: false
  })
  baseAssetPairs: CoinPairs[];

  @OneToMany(() => CoinPairs, (pair) => pair.quoteAsset)
  @ApiProperty({
    description: 'Trading pairs where this coin is the quote asset',
    type: () => CoinPairs,
    isArray: true,
    required: false
  })
  quoteAssetPairs: CoinPairs[];

  constructor(partial: Partial<Coin>) {
    Object.assign(this, partial);
  }
}

export enum CoinRelations {
  PRICES = 'prices',
  PORTFOLIOS = 'portfolios',
  TICKERS = 'tickers',
  ORDERS = 'orders'
}
