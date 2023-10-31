import { ApiProperty } from '@nestjs/swagger';
import {
  AfterLoad,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinTable,
  ManyToOne,
  PrimaryGeneratedColumn,
  Timestamp,
  UpdateDateColumn
} from 'typeorm';

import { Coin } from '../../coin/coin.entity';
import { Exchange } from '../exchange.entity';

@Entity()
@Index(['coin', 'target', 'exchange'], { unique: true })
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

  @CreateDateColumn({ select: false, default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Timestamp;

  @UpdateDateColumn({ select: false, default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Timestamp;

  @Index('ticker_exchangeId_index')
  @ManyToOne(() => Exchange, (exchange) => exchange.tickers, { onDelete: 'CASCADE' })
  @JoinTable()
  exchange: Exchange;

  @Index('ticker_coinId_index')
  @ManyToOne(() => Coin, (coin) => coin.tickers, { eager: true, onDelete: 'CASCADE' })
  @JoinTable()
  coin: Coin;

  @Index('ticker_targetId_index')
  @ManyToOne(() => Coin, (coin) => coin.tickers, { eager: true, onDelete: 'CASCADE' })
  @JoinTable()
  target: Coin;

  constructor(partial: Partial<Ticker>) {
    Object.assign(this, partial);
  }
}
