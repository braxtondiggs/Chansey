import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import {
  AfterLoad,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';

import { Coin } from '../../coin/coin.entity';
import { Exchange } from '../exchange.entity';

@Entity()
@Index(['coin', 'target', 'exchange'], { unique: true })
export class Ticker {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique identifier for the ticker',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  @ApiProperty({
    description: 'Trading volume',
    example: 1500000.5
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
  @ApiProperty({
    description: 'Percentage spread',
    example: 0.75
  })
  spreadPercentage?: number;

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

  @Expose()
  public symbol: string;
  @AfterLoad()
  computeSymbol() {
    if (this.coin && this.target) this.symbol = `${this.coin.symbol}${this.target.symbol}`.toUpperCase();
  }

  @CreateDateColumn({ type: 'timestamptz', select: false })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', select: false })
  updatedAt: Date;

  @Index('ticker_exchangeId_index')
  @ManyToOne(() => Exchange, (exchange) => exchange.tickers, {
    onDelete: 'CASCADE',
    eager: true
  })
  exchange: Exchange;

  @Index('ticker_coinId_index')
  @ManyToOne(() => Coin, (coin) => coin.tickers, {
    onDelete: 'CASCADE',
    eager: false
  })
  coin: Coin;

  @Index('ticker_targetId_index')
  @ManyToOne(() => Coin, (coin) => coin.tickersAsTarget, {
    onDelete: 'CASCADE',
    eager: false
  })
  target: Coin;

  constructor(partial: Partial<Ticker>) {
    Object.assign(this, partial);
  }
}
