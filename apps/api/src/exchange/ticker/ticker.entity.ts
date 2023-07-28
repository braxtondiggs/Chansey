import { ApiProperty } from '@nestjs/swagger';
import {
  AfterLoad,
  Column,
  CreateDateColumn,
  Entity,
  JoinTable,
  ManyToOne,
  PrimaryGeneratedColumn,
  Timestamp,
  UpdateDateColumn
} from 'typeorm';

import { Coin } from '../../coin/coin.entity';
import { Exchange } from '../exchange.entity';

@Entity()
export class Ticker {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @Column({ type: 'decimal', default: 0 })
  @ApiProperty()
  volume: number;

  @Column({ nullable: true })
  @ApiProperty()
  tradeUrl?: string;

  @Column({ type: 'decimal', default: 0 })
  @ApiProperty()
  spreadPercentage?: number;

  @Column({ type: 'timestamptz' })
  @ApiProperty()
  lastTraded: Date;

  @Column({ type: 'timestamptz' })
  @ApiProperty()
  fetchAt: Date;

  public symbol: string;
  @AfterLoad()
  getSymbol() {
    this.symbol = `${this.coin.symbol}${this.target.symbol}`.toUpperCase();
  }

  @CreateDateColumn({ select: false })
  createdAt: Timestamp;

  @UpdateDateColumn({ select: false })
  updatedAt: Timestamp;

  @ManyToOne(() => Exchange, (exchange) => exchange.tickers)
  @JoinTable()
  exchange: Exchange;

  @ManyToOne(() => Coin, (coin) => coin.tickers, { eager: true })
  @JoinTable()
  coin: Coin;

  @ManyToOne(() => Coin, (coin) => coin.tickers, { eager: true })
  @JoinTable()
  target: Coin;

  constructor(partial: Partial<Ticker>) {
    Object.assign(this, partial);
  }
}
