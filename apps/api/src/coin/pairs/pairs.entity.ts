import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsNotEmpty, Length } from 'class-validator';
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

import { Coin } from '../coin.entity';

export enum PairStatus {
  TRADING = 'TRADING',
  BREAK = 'BREAK',
  DELISTED = 'DELISTED'
}

@Entity()
@Unique(['baseAsset', 'quoteAsset'])
@Index(['symbol'])
export class CoinPairs {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique identifier for the trading pair',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  id: string;

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

  @Column({ type: 'enum', enum: PairStatus, default: PairStatus.TRADING })
  @IsEnum(PairStatus)
  @IsNotEmpty()
  @ApiProperty({
    description: 'Status of the trading pair',
    enum: PairStatus,
    example: PairStatus.TRADING,
    default: PairStatus.TRADING
  })
  status: PairStatus;

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

  @BeforeInsert()
  @BeforeUpdate()
  generateSymbol() {
    if (this.baseAsset && this.quoteAsset) {
      this.symbol = `${this.baseAsset.symbol}${this.quoteAsset.symbol}`.toUpperCase();
    }
  }

  @CreateDateColumn({ type: 'timestamptz', select: false })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', select: false })
  updatedAt: Date;

  constructor(partial: Partial<CoinPairs>) {
    Object.assign(this, partial);
  }
}
