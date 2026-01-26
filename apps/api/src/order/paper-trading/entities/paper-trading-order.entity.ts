import { ApiProperty } from '@nestjs/swagger';

import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn
} from 'typeorm';

import { PaperTradingSession } from './paper-trading-session.entity';
import { PaperTradingSignal } from './paper-trading-signal.entity';

import { ColumnNumericTransformer } from '../../../utils/transformers';

export enum PaperTradingOrderSide {
  BUY = 'BUY',
  SELL = 'SELL'
}

export enum PaperTradingOrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP = 'STOP',
  STOP_LIMIT = 'STOP_LIMIT'
}

export enum PaperTradingOrderStatus {
  PENDING = 'PENDING',
  FILLED = 'FILLED',
  PARTIAL = 'PARTIAL',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED'
}

@Entity('paper_trading_orders')
@Index(['session'])
@Index(['session', 'status'])
@Index(['executedAt'], { where: '"executedAt" IS NOT NULL' })
export class PaperTradingOrder {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique identifier for the order' })
  id: string;

  @IsEnum(PaperTradingOrderSide)
  @Column({ type: 'enum', enum: PaperTradingOrderSide })
  @ApiProperty({ description: 'Order side', enum: PaperTradingOrderSide })
  side: PaperTradingOrderSide;

  @IsEnum(PaperTradingOrderType)
  @Column({ type: 'enum', enum: PaperTradingOrderType, default: PaperTradingOrderType.MARKET })
  @ApiProperty({ description: 'Order type', enum: PaperTradingOrderType, default: 'MARKET' })
  orderType: PaperTradingOrderType;

  @IsEnum(PaperTradingOrderStatus)
  @Column({ type: 'enum', enum: PaperTradingOrderStatus, default: PaperTradingOrderStatus.PENDING })
  @ApiProperty({ description: 'Order status', enum: PaperTradingOrderStatus, default: 'PENDING' })
  status: PaperTradingOrderStatus;

  @IsString()
  @Column({ type: 'varchar', length: 50 })
  @ApiProperty({ description: 'Trading pair symbol (e.g., BTC/USD)' })
  symbol: string;

  @IsString()
  @Column({ type: 'varchar', length: 20 })
  @ApiProperty({ description: 'Base currency (e.g., BTC)' })
  baseCurrency: string;

  @IsString()
  @Column({ type: 'varchar', length: 20 })
  @ApiProperty({ description: 'Quote currency (e.g., USD)' })
  quoteCurrency: string;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Requested quantity' })
  requestedQuantity: number;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Filled quantity', default: 0 })
  filledQuantity: number;

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Requested price (for limit orders)', required: false })
  requestedPrice?: number;

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Executed price (for market orders)', required: false })
  executedPrice?: number;

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Average execution price (for partial fills)', required: false })
  averagePrice?: number;

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Slippage in basis points', required: false })
  slippageBps?: number;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Trading fee paid', default: 0 })
  fee: number;

  @IsString()
  @IsOptional()
  @Column({ type: 'varchar', length: 20, nullable: true })
  @ApiProperty({ description: 'Asset in which fee was paid', required: false })
  feeAsset?: string;

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Total value of the trade (quantity * price)', required: false })
  totalValue?: number;

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Realized profit/loss (for SELL orders)', required: false })
  realizedPnL?: number;

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Realized P&L as percentage', required: false })
  realizedPnLPercent?: number;

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Cost basis at time of trade', required: false })
  costBasis?: number;

  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({ description: 'Additional order metadata', required: false })
  metadata?: Record<string, any>;

  @CreateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: 'When the order was created' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: 'When the order was last updated' })
  updatedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiProperty({ description: 'When the order was executed', required: false })
  executedAt?: Date;

  // Relations
  @ManyToOne(() => PaperTradingSession, (session) => session.orders, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  @ApiProperty({ description: 'Paper trading session this order belongs to' })
  session: Relation<PaperTradingSession>;

  @ManyToOne(() => PaperTradingSignal, (signal) => signal.orders, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'signalId' })
  @ApiProperty({ description: 'Signal that triggered this order', required: false })
  signal?: Relation<PaperTradingSignal>;

  constructor(partial: Partial<PaperTradingOrder>) {
    Object.assign(this, partial);
  }
}
