import { ApiProperty } from '@nestjs/swagger';

import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Relation
} from 'typeorm';

import { PaperTradingOrder } from './paper-trading-order.entity';
import { PaperTradingSession } from './paper-trading-session.entity';

import { ColumnNumericTransformer } from '../../../utils/transformers';

export enum PaperTradingSignalType {
  ENTRY = 'ENTRY',
  EXIT = 'EXIT',
  ADJUSTMENT = 'ADJUSTMENT',
  RISK_CONTROL = 'RISK_CONTROL'
}

export enum PaperTradingSignalDirection {
  LONG = 'LONG',
  SHORT = 'SHORT',
  FLAT = 'FLAT'
}

@Entity('paper_trading_signals')
@Index(['session'])
@Index(['session', 'processed'])
export class PaperTradingSignal {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique identifier for the signal' })
  id: string;

  @IsEnum(PaperTradingSignalType)
  @Column({ type: 'enum', enum: PaperTradingSignalType })
  @ApiProperty({ description: 'Type of signal', enum: PaperTradingSignalType })
  signalType: PaperTradingSignalType;

  @IsEnum(PaperTradingSignalDirection)
  @Column({ type: 'enum', enum: PaperTradingSignalDirection })
  @ApiProperty({ description: 'Direction of the signal', enum: PaperTradingSignalDirection })
  direction: PaperTradingSignalDirection;

  @IsString()
  @Column({ type: 'varchar', length: 50 })
  @ApiProperty({ description: 'Instrument/symbol the signal targets (e.g., BTC/USD)' })
  instrument: string;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Quantity or exposure requested by the signal' })
  quantity: number;

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Reference price when applicable', required: false })
  price?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  @Column({ type: 'decimal', precision: 5, scale: 4, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Confidence score on a 0-1 scale', required: false })
  confidence?: number;

  @IsString()
  @IsOptional()
  @Column({ type: 'text', nullable: true })
  @ApiProperty({ description: 'Human-readable explanation for the signal', required: false })
  reason?: string;

  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({ description: 'Custom metadata payload emitted with the signal', required: false })
  payload?: Record<string, any>;

  @IsBoolean()
  @Column({ type: 'boolean', default: false })
  @ApiProperty({ description: 'Whether the signal has been processed', default: false })
  processed: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiProperty({ description: 'When the signal was processed', required: false })
  processedAt?: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: 'When the signal was created' })
  createdAt: Date;

  // Relations
  @ManyToOne(() => PaperTradingSession, (session) => session.signals, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  @ApiProperty({ description: 'Paper trading session this signal belongs to' })
  session: Relation<PaperTradingSession>;

  @OneToMany(() => PaperTradingOrder, (order) => order.signal, { cascade: true })
  @ApiProperty({ description: 'Orders created from this signal', type: () => [PaperTradingOrder] })
  orders: PaperTradingOrder[];

  constructor(partial: Partial<PaperTradingSignal>) {
    Object.assign(this, partial);
  }
}
