import { ApiProperty } from '@nestjs/swagger';

import { IsEnum, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, Relation } from 'typeorm';

import type { Backtest } from './backtest.entity';
import { SimulatedOrderFill } from './simulated-order-fill.entity';

import { ColumnNumericTransformer } from '../../utils/transformers';

export enum SignalType {
  ENTRY = 'ENTRY',
  EXIT = 'EXIT',
  ADJUSTMENT = 'ADJUSTMENT',
  RISK_CONTROL = 'RISK_CONTROL'
}

export enum SignalDirection {
  LONG = 'LONG',
  SHORT = 'SHORT',
  FLAT = 'FLAT'
}

@Entity('backtest_signals')
@Index(['backtest', 'timestamp'])
@Index(['backtest', 'instrument'])
export class BacktestSignal {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique identifier for the signal' })
  id: string;

  @Column({ type: 'timestamptz' })
  @ApiProperty({ description: 'Market timestamp when the signal was generated' })
  timestamp: Date;

  @IsEnum(SignalType)
  @Column({ type: 'enum', enum: SignalType, enumName: 'backtest_signal_type_enum' })
  @ApiProperty({ description: 'Signal classification', enum: SignalType })
  signalType: SignalType;

  @IsString()
  @Column()
  @ApiProperty({ description: 'Instrument or symbol the signal targets' })
  instrument: string;

  @IsEnum(SignalDirection)
  @Column({ type: 'enum', enum: SignalDirection, enumName: 'backtest_signal_direction_enum' })
  @ApiProperty({ description: 'Directional intent of the signal', enum: SignalDirection })
  direction: SignalDirection;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 25, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Quantity or exposure requested by the signal' })
  quantity: number;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 25, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Reference price when applicable', required: false })
  price?: number;

  @IsString()
  @IsOptional()
  @Column({ type: 'text', nullable: true })
  @ApiProperty({ description: 'Human-readable explanation for the signal', required: false })
  reason?: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  @Column({ type: 'decimal', precision: 5, scale: 4, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Confidence score on a 0-1 scale', required: false })
  confidence?: number;

  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({ description: 'Custom metadata payload emitted with the signal', required: false })
  payload?: Record<string, any>;

  @ManyToOne('Backtest', 'signals', { onDelete: 'CASCADE' })
  @JoinColumn()
  @ApiProperty({ description: 'Backtest run that produced the signal' })
  backtest: Relation<Backtest>;

  @OneToMany('SimulatedOrderFill', 'signal', { cascade: true })
  @ApiProperty({ description: 'Simulated fills linked to this signal', type: () => [SimulatedOrderFill] })
  simulatedFills: SimulatedOrderFill[];

  constructor(partial: Partial<BacktestSignal>) {
    Object.assign(this, partial);
  }
}
