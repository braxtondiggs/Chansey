import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique
} from 'typeorm';

import { Coin } from '../coin/coin.entity';
import { Exchange } from '../exchange/exchange.entity';
import { ColumnNumericTransformer } from '../utils/transformers';

@Entity('ohlc_candles')
@Unique(['coinId', 'timestamp', 'exchangeId'])
@Index(['coinId', 'timestamp'])
@Index(['timestamp'])
@Index(['exchangeId', 'timestamp'])
export class OHLCCandle {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique identifier for the candle',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @Column('uuid')
  @ApiProperty({ description: 'Foreign key to Coin entity' })
  coinId: string;

  @ManyToOne(() => Coin, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'coinId' })
  coin: Coin;

  @Column('uuid')
  @ApiProperty({ description: 'Foreign key to Exchange entity' })
  exchangeId: string;

  @ManyToOne(() => Exchange, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exchangeId' })
  exchange: Exchange;

  @Column({
    type: 'timestamptz',
    nullable: false
  })
  @ApiProperty({
    description: 'Candle open timestamp (start of hour)',
    example: '2024-01-06T12:00:00.000Z'
  })
  timestamp: Date;

  @Column({
    type: 'decimal',
    precision: 25,
    scale: 8,
    transformer: new ColumnNumericTransformer(),
    nullable: false
  })
  @ApiProperty({
    description: 'Opening price',
    example: 45000.12345678
  })
  open: number;

  @Column({
    type: 'decimal',
    precision: 25,
    scale: 8,
    transformer: new ColumnNumericTransformer(),
    nullable: false
  })
  @ApiProperty({
    description: 'Highest price during the hour',
    example: 45500.0
  })
  high: number;

  @Column({
    type: 'decimal',
    precision: 25,
    scale: 8,
    transformer: new ColumnNumericTransformer(),
    nullable: false
  })
  @ApiProperty({
    description: 'Lowest price during the hour',
    example: 44800.0
  })
  low: number;

  @Column({
    type: 'decimal',
    precision: 25,
    scale: 8,
    transformer: new ColumnNumericTransformer(),
    nullable: false
  })
  @ApiProperty({
    description: 'Closing price',
    example: 45200.0
  })
  close: number;

  @Column({
    type: 'decimal',
    precision: 30,
    scale: 8,
    transformer: new ColumnNumericTransformer(),
    default: 0
  })
  @ApiProperty({
    description: 'Trading volume in base currency',
    example: 1234.56789
  })
  volume: number;

  @Column({
    type: 'decimal',
    precision: 30,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
    nullable: true
  })
  @ApiProperty({
    description: 'Trading volume in quote currency (USD)',
    example: 55650000.0
  })
  quoteVolume: number;

  @CreateDateColumn({ type: 'timestamptz' })
  @ApiProperty({
    description: 'Timestamp when the candle record was created',
    example: '2024-01-06T12:05:00.000Z'
  })
  createdAt: Date;

  constructor(partial: Partial<Omit<OHLCCandle, 'id' | 'createdAt'>>) {
    Object.assign(this, partial);
  }
}

export interface OHLCSummary {
  readonly coinId: string;
  readonly timestamp: Date;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export type OHLCSummaryByPeriod = {
  [coinId: string]: OHLCSummary[];
};

/**
 * PriceSummary - Compatibility interface for algorithm strategies.
 * Maps OHLC candle data to the legacy price format.
 *
 * Field mappings:
 * - avg: OHLC close price (represents the final/current price)
 * - coin: coinId (UUID)
 * - date: timestamp (candle open time)
 * - high: OHLC high
 * - low: OHLC low
 */
export interface PriceSummary {
  readonly avg: number;
  readonly coin: string;
  readonly date: Date;
  readonly high: number;
  readonly low: number;
  readonly open?: number;
  readonly close?: number;
  readonly volume?: number;
}

export type PriceSummaryByPeriod = {
  [coinId: string]: PriceSummary[];
};

export type PriceSummaryByDay = PriceSummaryByPeriod;
export type PriceSummaryByHour = PriceSummaryByPeriod;
