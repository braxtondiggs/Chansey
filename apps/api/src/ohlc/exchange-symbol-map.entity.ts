import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn
} from 'typeorm';

import { Coin } from '../coin/coin.entity';
import { Exchange } from '../exchange/exchange.entity';

@Entity('exchange_symbol_map')
@Unique(['coinId', 'exchangeId'])
@Index(['exchangeId', 'isActive'])
@Index(['coinId'])
export class ExchangeSymbolMap {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique identifier for the symbol mapping',
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

  @Column({ length: 20 })
  @ApiProperty({
    description: 'Trading symbol on this exchange',
    example: 'BTC/USD'
  })
  symbol: string;

  @Column({ default: true })
  @ApiProperty({
    description: 'Whether this mapping is active for sync',
    example: true
  })
  isActive: boolean;

  @Column({ type: 'int', default: 0 })
  @ApiProperty({
    description: 'Priority for fallback ordering (lower = higher priority)',
    example: 0
  })
  priority: number;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiProperty({
    description: 'Last successful sync timestamp',
    example: '2024-01-06T12:00:00.000Z'
  })
  lastSyncAt: Date;

  @Column({ type: 'int', default: 0 })
  @ApiProperty({
    description: 'Consecutive failure count',
    example: 0
  })
  failureCount: number;

  @CreateDateColumn({ type: 'timestamptz' })
  @ApiProperty({
    description: 'Timestamp when the mapping was created',
    example: '2024-01-06T12:00:00.000Z'
  })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  @ApiProperty({
    description: 'Timestamp when the mapping was last updated',
    example: '2024-01-06T12:00:00.000Z'
  })
  updatedAt: Date;

  constructor(partial: Partial<Omit<ExchangeSymbolMap, 'id' | 'createdAt' | 'updatedAt'>>) {
    Object.assign(this, partial);
  }
}
