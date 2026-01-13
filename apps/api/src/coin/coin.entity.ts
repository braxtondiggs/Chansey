import { ApiProperty } from '@nestjs/swagger';

import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { TickerPairs } from './ticker-pairs/ticker-pairs.entity';

import { Order } from '../order/order.entity';
import { Portfolio } from '../portfolio/portfolio.entity';

@Entity()
export class Coin {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique identifier for the coin',
    example: '7a8a03ab-07fe-4c8a-9b5a-50fdfeb9828f'
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

  @Column({ type: 'timestamptz', nullable: true })
  @ApiProperty({
    description: 'Genesis date of the coin',
    example: '2009-01-03T00:00:00.000Z',
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

  @Column({ type: 'decimal', precision: 25, scale: 8, nullable: true, default: null })
  @ApiProperty({
    description: 'Total supply of the coin',
    example: 21000000.0,
    required: false,
    type: Number
  })
  totalSupply?: number;

  @Column({ type: 'decimal', precision: 25, scale: 8, nullable: true, default: null })
  @ApiProperty({
    description: 'Circulating supply of the coin',
    example: 18500000.0,
    required: false,
    type: Number
  })
  circulatingSupply?: number;

  @Column({ type: 'decimal', precision: 25, scale: 8, nullable: true, default: null })
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

  @Column({ type: 'decimal', precision: 25, scale: 8, nullable: true, default: null })
  @ApiProperty({
    description: 'All-time high price of the coin',
    example: 60000.0,
    required: false,
    type: Number
  })
  ath?: number;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true, default: null })
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

  @Column({ type: 'decimal', precision: 25, scale: 8, default: null })
  @ApiProperty({
    description: 'All-time low price of the coin',
    example: 3000.0,
    required: false,
    type: Number
  })
  atl?: number;

  @Column({ type: 'decimal', precision: 15, scale: 6, default: null })
  @ApiProperty({
    description: 'Change from all-time low',
    example: 50.0,
    required: false,
    type: Number
  })
  atlChange?: number;

  @Column({ type: 'decimal', precision: 25, scale: 8, nullable: true, default: null })
  @ApiProperty({
    description: 'Total volume of the coin',
    example: 600000000.0,
    required: false,
    type: Number
  })
  totalVolume?: number;

  @Column({ type: 'decimal', precision: 25, scale: 8, nullable: true, default: null })
  @ApiProperty({
    description: 'Market capitalization of the coin',
    example: 1200000000000.0,
    required: false,
    type: Number
  })
  marketCap?: number;

  @Column({ type: 'decimal', precision: 25, scale: 8, nullable: true, default: null })
  @ApiProperty({
    description: 'Price change in 24 hours',
    example: -132.19,
    required: false,
    type: Number
  })
  priceChange24h?: number;

  @Column({ type: 'decimal', precision: 10, scale: 5, nullable: true, default: null })
  @ApiProperty({
    description: 'Price change percentage in 24 hours',
    example: -4.97413,
    required: false,
    type: Number
  })
  priceChangePercentage24h?: number;

  @Column({ type: 'decimal', precision: 10, scale: 5, nullable: true, default: null })
  @ApiProperty({
    description: 'Price change percentage in 7 days',
    example: 0.74613,
    required: false,
    type: Number
  })
  priceChangePercentage7d?: number;

  @Column({ type: 'decimal', precision: 25, scale: 8, nullable: true, default: null })
  @ApiProperty({
    description: 'Current price of the coin in USD',
    example: 45000.12345678,
    required: false,
    type: Number
  })
  currentPrice?: number;

  @Column({ type: 'decimal', precision: 10, scale: 5, nullable: true, default: null })
  @ApiProperty({
    description: 'Price change percentage in 14 days',
    example: 8.36958,
    required: false,
    type: Number
  })
  priceChangePercentage14d?: number;

  @Column({ type: 'decimal', precision: 10, scale: 5, nullable: true, default: null })
  @ApiProperty({
    description: 'Price change percentage in 30 days',
    example: 41.03672,
    required: false,
    type: Number
  })
  priceChangePercentage30d?: number;

  @Column({ type: 'decimal', precision: 10, scale: 5, nullable: true, default: null })
  @ApiProperty({
    description: 'Price change percentage in 60 days',
    example: 20.9407,
    required: false,
    type: Number
  })
  priceChangePercentage60d?: number;

  @Column({ type: 'decimal', precision: 10, scale: 5, nullable: true, default: null })
  @ApiProperty({
    description: 'Price change percentage in 200 days',
    example: 5.1652,
    required: false,
    type: Number
  })
  priceChangePercentage200d?: number;

  @Column({ type: 'decimal', precision: 10, scale: 5, nullable: true, default: null })
  @ApiProperty({
    description: 'Price change percentage in 1 year',
    example: -33.698,
    required: false,
    type: Number
  })
  priceChangePercentage1y?: number;

  @Column({ type: 'decimal', precision: 25, scale: 8, nullable: true, default: null })
  @ApiProperty({
    description: 'Market cap change in 24 hours',
    example: -16184990966.68,
    required: false,
    type: Number
  })
  marketCapChange24h?: number;

  @Column({ type: 'decimal', precision: 10, scale: 5, nullable: true, default: null })
  @ApiProperty({
    description: 'Market cap change percentage in 24 hours',
    example: -5.04176,
    required: false,
    type: Number
  })
  marketCapChangePercentage24h?: number;

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

  @Column({ type: 'jsonb', nullable: true, default: null })
  @ApiProperty({
    description: 'External resource links (homepage, blockchain explorers, repositories, etc.)',
    example: {
      homepage: ['https://bitcoin.org'],
      blockchainSite: ['https://blockchain.com', 'https://blockchair.com'],
      officialForumUrl: ['https://bitcointalk.org'],
      subredditUrl: 'https://reddit.com/r/bitcoin',
      reposUrl: { github: ['https://github.com/bitcoin/bitcoin'] }
    },
    required: false
  })
  links?: {
    homepage?: string[];
    blockchainSite?: string[];
    officialForumUrl?: string[];
    subredditUrl?: string;
    reposUrl?: {
      github?: string[];
    };
  };

  @Column({ type: 'timestamptz', nullable: true, default: null })
  @ApiProperty({
    description: 'Date when metadata (description/links) was last refreshed from CoinGecko',
    example: '2025-10-22T00:00:00Z',
    required: false,
    type: Date
  })
  metadataLastUpdated?: Date;

  @CreateDateColumn({ type: 'timestamptz', select: false })
  @ApiProperty({
    description: 'Timestamp when the coin was created',
    example: '2022-01-01T00:00:00Z',
    readOnly: true
  })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  @ApiProperty({
    description: 'Timestamp when the coin was last updated',
    example: '2023-01-01T00:00:00Z',
    readOnly: true
  })
  updatedAt: Date;

  @OneToMany(() => Order, (order) => order.baseCoin)
  @ApiProperty({
    description: 'List of orders where this coin is the base coin',
    type: () => Order,
    isArray: true,
    required: false
  })
  baseOrders: Order[];

  @OneToMany(() => Order, (order) => order.quoteCoin)
  @ApiProperty({
    description: 'List of orders where this coin is the quote coin',
    type: () => Order,
    isArray: true,
    required: false
  })
  quoteOrders: Order[];

  @OneToMany(() => Portfolio, (portfolio) => portfolio.coin)
  @ApiProperty({
    description: 'List of portfolios associated with the coin',
    type: () => Portfolio,
    isArray: true,
    required: false
  })
  portfolios: Portfolio[];

  @OneToMany(() => TickerPairs, (pair) => pair.baseAsset)
  @ApiProperty({
    description: 'Trading pairs where this coin is the base asset',
    type: () => TickerPairs,
    isArray: true,
    required: false
  })
  baseAssetPairs: TickerPairs[];

  @OneToMany(() => TickerPairs, (pair) => pair.quoteAsset)
  @ApiProperty({
    description: 'Trading pairs where this coin is the quote asset',
    type: () => TickerPairs,
    isArray: true,
    required: false
  })
  quoteAssetPairs: TickerPairs[];

  constructor(partial: Partial<Coin>) {
    Object.assign(this, partial);
  }
}

export enum CoinRelations {
  PORTFOLIOS = 'portfolios',
  BASE_ASSETS = 'baseAssetPairs',
  QUOTE_ASSETS = 'quoteAssetPairs',
  BASE_ORDERS = 'baseOrders',
  QUOTE_ORDERS = 'quoteOrders'
}
