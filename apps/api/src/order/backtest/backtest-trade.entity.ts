import { ApiProperty } from '@nestjs/swagger';

import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation } from 'typeorm';

import type { Backtest } from './backtest.entity';

import { Coin } from '../../coin/coin.entity';
import { ColumnNumericTransformer } from '../../utils/transformers';

export enum TradeType {
  BUY = 'BUY',
  SELL = 'SELL'
}

export enum TradeStatus {
  EXECUTED = 'EXECUTED',
  FAILED = 'FAILED'
}

@Entity('backtest_trades')
@Index(['backtest', 'executedAt'])
@Index(['baseCoin', 'quoteCoin'])
export class BacktestTrade {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique identifier for the trade' })
  id: string;

  @IsEnum(TradeType)
  @IsNotEmpty()
  @Column({ type: 'enum', enum: TradeType, enumName: 'backtest_trade_type_enum' })
  @ApiProperty({ description: 'Type of trade', enum: TradeType })
  type: TradeType;

  @IsEnum(TradeStatus)
  @IsNotEmpty()
  @Column({ type: 'enum', enum: TradeStatus, enumName: 'backtest_trade_status_enum', default: TradeStatus.EXECUTED })
  @ApiProperty({ description: 'Status of the trade', enum: TradeStatus })
  status: TradeStatus;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 25, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Quantity of base asset traded' })
  quantity: number;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 25, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Price per unit of base asset' })
  price: number;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 25, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Total value of the trade (quantity * price)' })
  totalValue: number;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 25, scale: 8, default: 0, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Trading fee paid' })
  fee: number;

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 25, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Realized profit/loss in quote currency (only for SELL trades)', required: false })
  realizedPnL?: number;

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Realized P&L as percentage (e.g., 0.05 = 5% gain)', required: false })
  realizedPnLPercent?: number;

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 25, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Average cost basis at time of trade (entry price for position)', required: false })
  costBasis?: number;

  @Column({ type: 'timestamptz' })
  @ApiProperty({ description: 'When the trade was executed' })
  executedAt: Date;

  @IsString()
  @IsOptional()
  @Column({ nullable: true })
  @ApiProperty({ description: 'Reason for the trade (signal that triggered it)', required: false })
  signal?: string;

  @IsString()
  @IsOptional()
  @Column({ type: 'varchar', length: 10, nullable: true })
  @ApiProperty({ description: 'Position side: long or short', required: false })
  positionSide?: string;

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Leverage used for this trade', required: false })
  leverage?: number;

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Liquidation price at time of trade', required: false })
  liquidationPrice?: number;

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Margin amount used for this trade', required: false })
  marginUsed?: number;

  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({ description: 'Additional trade metadata', required: false })
  metadata?: Record<string, any>;

  @ManyToOne('Backtest', 'trades', { onDelete: 'CASCADE' })
  @JoinColumn()
  @ApiProperty({ description: 'Backtest this trade belongs to' })
  backtest: Relation<Backtest>;

  @ManyToOne('Coin', { nullable: false })
  @JoinColumn()
  @ApiProperty({ description: 'Base coin being traded' })
  baseCoin: Relation<Coin>;

  @ManyToOne('Coin', { nullable: false })
  @JoinColumn()
  @ApiProperty({ description: 'Quote coin (usually USD/USDT)' })
  quoteCoin: Relation<Coin>;

  constructor(partial: Partial<BacktestTrade>) {
    Object.assign(this, partial);
  }
}
