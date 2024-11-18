import { ApiProperty } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { TickerPairs } from '../coin/ticker-pairs/ticker-pairs.entity';

@Entity()
@Index(['slug'], { unique: true })
@Index(['name'], { unique: true })
export class Exchange {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique identifier for the exchange',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @Column({ unique: true })
  @ApiProperty({
    description: 'URL-friendly identifier for the exchange',
    example: 'binance'
  })
  slug: string;

  @Column({ unique: true })
  @ApiProperty({
    description: 'Name of the exchange',
    example: 'Binance'
  })
  name: string;

  @Column({ nullable: true, type: 'text' })
  @ApiProperty({
    description: 'Detailed description of the exchange',
    example: 'Binance is a global cryptocurrency exchange offering a wide range of services.'
  })
  description?: string;

  @Column({ nullable: true })
  @ApiProperty({
    description: 'URL to the exchange’s logo or image',
    example: 'https://example.com/logo.png'
  })
  image?: string;

  @Column({ nullable: true })
  @ApiProperty({
    description: 'Country where the exchange is based',
    example: 'Cayman Islands'
  })
  country?: string;

  @Column({ nullable: true, type: 'int' })
  @ApiProperty({
    description: 'Year the exchange was established',
    example: 2017
  })
  yearEstablished?: number;

  @Column({ nullable: true, type: 'float' })
  @ApiProperty({
    description: 'Trust score of the exchange based on various factors',
    example: 9.5
  })
  trustScore?: number;

  @Column({ nullable: true, type: 'int' })
  @ApiProperty({
    description: 'Rank of the exchange based on trust score',
    example: 1
  })
  trustScoreRank?: number;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 2,
    default: 0
  })
  @ApiProperty({
    description: '24-hour trade volume in BTC',
    example: 5000000.0
  })
  tradeVolume24HBtc?: number;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 2,
    default: 0
  })
  @ApiProperty({
    description: '24-hour normalized trade volume',
    example: 7500000.0
  })
  tradeVolume24HNormalized?: number;

  @Column({ nullable: true, default: true })
  @ApiProperty({
    description: 'Indicates if the exchange is centralized',
    example: true
  })
  centralized?: boolean;

  @Column({ nullable: true })
  @ApiProperty({
    description: 'Official website URL of the exchange',
    example: 'https://www.binance.com'
  })
  url?: string;

  @Column({ nullable: true })
  @ApiProperty({
    description: 'Official Twitter handle of the exchange',
    example: '@binance'
  })
  twitter?: string;

  @Column({ nullable: true })
  @ApiProperty({
    description: 'Official Facebook page of the exchange',
    example: 'https://www.facebook.com/binance'
  })
  facebook?: string;

  @Column({ nullable: true })
  @ApiProperty({
    description: 'Official Reddit community of the exchange',
    example: 'https://www.reddit.com/r/binance'
  })
  reddit?: string;

  @Column({ nullable: true })
  @ApiProperty({
    description: 'Official Telegram group of the exchange',
    example: 'https://t.me/binance'
  })
  telegram?: string;

  @Column({ nullable: true })
  @ApiProperty({
    description: 'Official Slack channel of the exchange',
    example: 'https://binance.slack.com'
  })
  slack?: string;

  @Column({ nullable: true })
  @ApiProperty({
    description: 'Additional URL related to the exchange',
    example: 'https://www.binance.com/announcement'
  })
  otherUrl1?: string;

  @Column({ nullable: true })
  @ApiProperty({
    description: 'Another additional URL related to the exchange',
    example: 'https://www.binance.com/blog'
  })
  otherUrl2?: string;

  @Column({ default: false })
  @ApiProperty({
    description: 'Indicates if the exchange is supported by the application',
    example: true
  })
  supported: boolean;

  @CreateDateColumn({ type: 'timestamptz', select: false })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', select: false })
  updatedAt: Date;

  @OneToMany(() => TickerPairs, (ticker) => ticker.exchange, {
    cascade: true,
    onDelete: 'CASCADE',
    eager: false
  })
  @ApiProperty({
    description: 'List of ticker pairs associated with the exchange',
    type: () => [TickerPairs]
  })
  ticker: TickerPairs[];

  constructor(partial: Partial<Exchange>) {
    Object.assign(this, partial);
  }
}
