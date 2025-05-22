import { ApiProperty } from '@nestjs/swagger';

import { IsBoolean, IsEnum, IsNotEmpty, IsNumber, Length, Min } from 'class-validator';
import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn
} from 'typeorm';

import { Exchange } from '../../exchange/exchange.entity';
import { Coin } from '../coin.entity';

export enum TickerPairStatus {
  TRADING = 'TRADING',
  BREAK = 'BREAK',
  DELISTED = 'DELISTED'
}

@Entity()
@Unique(['symbol', 'exchange'])
@Index(['symbol', 'exchange'])
export class TickerPairs {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique identifier for the ticker',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @Index('ticker_pair_baseAssetId_index')
  @ManyToOne(() => Coin, (coin) => coin.baseAssetPairs, {
    cascade: true,
    eager: false,
    nullable: false,
    onDelete: 'CASCADE'
  })
  @ApiProperty({
    description: 'Base asset (first part) of the trading pair, e.g. BTC in BTC/USD',
    type: () => Coin
  })
  baseAsset: Coin;

  @ManyToOne(() => Coin, (coin) => coin.quoteAssetPairs, {
    cascade: true,
    eager: false,
    nullable: false,
    onDelete: 'CASCADE'
  })
  @ApiProperty({
    description: 'Quote asset (second part) of the trading pair, e.g. USD in BTC/USD',
    type: () => Coin
  })
  quoteAsset: Coin;

  @Column({ length: 20, update: false })
  @Length(1, 20)
  @IsNotEmpty()
  @ApiProperty({
    description:
      'Trading pair symbol (e.g. "BTCUSD", "ETHBTC"). Automatically generated from baseAsset and quoteAsset.',
    example: 'BTCUSD',
    maxLength: 20
  })
  symbol: string;

  @Column({ type: 'decimal', precision: 30, scale: 8, default: 0 })
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Trading volume in the base asset',
    example: 1500000.5,
    minimum: 0
  })
  volume: number;

  @Column({ nullable: true })
  @ApiProperty({
    description: 'URL to the trading page',
    example: 'https://www.exchange.com/trade/BTC-USD',
    required: false
  })
  tradeUrl?: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Percentage spread',
    example: 0.75,
    minimum: 0
  })
  spreadPercentage?: number;

  @Index('ticker_exchange_lastTraded_index')
  @Column({ type: 'timestamptz' })
  @ApiProperty({
    description: 'Timestamp of the last trade',
    example: '2024-04-24T10:15:30.123Z'
  })
  lastTraded: Date;

  @Column({ type: 'timestamptz' })
  @ApiProperty({
    description: 'Timestamp when the ticker was fetched',
    example: '2024-04-24T10:15:30.123Z'
  })
  fetchAt: Date;

  @Column({ type: 'enum', enum: TickerPairStatus, default: TickerPairStatus.TRADING })
  @IsEnum(TickerPairStatus)
  @IsNotEmpty()
  @ApiProperty({
    description: 'Status of the trading pair',
    enum: TickerPairStatus,
    example: TickerPairStatus.TRADING,
    default: TickerPairStatus.TRADING
  })
  status: TickerPairStatus;

  @Column({ default: true })
  @IsBoolean()
  @ApiProperty({
    description: 'Whether spot trading is allowed for this pair',
    example: true,
    default: true
  })
  isSpotTradingAllowed: boolean;

  @Column({ default: false })
  @IsBoolean()
  @ApiProperty({
    description: 'Whether margin trading is allowed for this pair',
    example: false,
    default: false
  })
  isMarginTradingAllowed: boolean;

  @CreateDateColumn({ type: 'timestamptz', select: false })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', select: false })
  updatedAt: Date;

  @Index('ticker_pair_exchangeId_index')
  @ManyToOne(() => Exchange, (exchange) => exchange.ticker, {
    onDelete: 'CASCADE',
    eager: true
  })
  exchange: Exchange;

  @BeforeInsert()
  @BeforeUpdate()
  generateSymbol() {
    if (this.baseAsset && this.quoteAsset) {
      this.symbol = `${this.baseAsset.symbol}${this.quoteAsset.symbol}`.toUpperCase();
    }
  }

  constructor(partial: Partial<Omit<TickerPairs, 'id' | 'createdAt' | 'updatedAt'>>) {
    Object.assign(this, partial);
  }
}
