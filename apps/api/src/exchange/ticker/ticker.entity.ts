import { ApiProperty } from '@nestjs/swagger';
import {
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

  @Column({ type: 'decimal' })
  @ApiProperty()
  volume: number;

  @Column({ default: false })
  @ApiProperty()
  stale?: boolean;

  @Column({ default: false })
  @ApiProperty()
  anomaly?: boolean;

  @Column({ type: 'timestamptz' })
  @ApiProperty()
  lastTraded: Date;

  @Column({ type: 'timestamptz' })
  @ApiProperty()
  fetchAt: Date;

  @CreateDateColumn({ select: false })
  createdAt: Timestamp;

  @UpdateDateColumn({ select: false })
  updatedAt: Timestamp;

  @ManyToOne(() => Exchange, (exchange) => exchange.tickers)
  @JoinTable()
  exchange: Exchange;

  @ManyToOne(() => Coin)
  @JoinTable()
  coin: Coin;

  @ManyToOne(() => Coin)
  @JoinTable()
  target: Coin;

  constructor(partial: Partial<Ticker>) {
    Object.assign(this, partial);
  }
}
