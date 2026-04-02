import { ApiProperty } from '@nestjs/swagger';

import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation } from 'typeorm';

import type { BacktestSignal } from './backtest-signal.entity';
import type { Backtest } from './backtest.entity';

import { ColumnNumericTransformer } from '../../utils/transformers';

export enum SimulatedOrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP = 'STOP',
  STOP_LIMIT = 'STOP_LIMIT'
}

export enum SimulatedOrderStatus {
  FILLED = 'FILLED',
  PARTIAL = 'PARTIAL',
  CANCELLED = 'CANCELLED'
}

@Entity('simulated_order_fills')
@Index(['backtest', 'executionTimestamp'])
@Index(['backtest', 'instrument'])
export class SimulatedOrderFill {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique identifier for the simulated fill' })
  id: string;

  @IsEnum(SimulatedOrderType)
  @Column({ type: 'enum', enum: SimulatedOrderType, enumName: 'simulated_order_type_enum' })
  @ApiProperty({ description: 'Simulated order type', enum: SimulatedOrderType })
  orderType: SimulatedOrderType;

  @IsEnum(SimulatedOrderStatus)
  @Column({ type: 'enum', enum: SimulatedOrderStatus, enumName: 'simulated_order_status_enum' })
  @ApiProperty({ description: 'Fill completion status', enum: SimulatedOrderStatus })
  status: SimulatedOrderStatus;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 25, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Quantity executed during the simulation' })
  filledQuantity: number;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 25, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Average price achieved by the simulated fill' })
  averagePrice: number;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 25, scale: 8, default: 0, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Estimated fees charged for the fill' })
  fees: number;

  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Slippage captured in basis points', required: false })
  slippageBps?: number;

  @Column({ type: 'timestamptz' })
  @ApiProperty({ description: 'Timestamp recorded for the simulated execution' })
  executionTimestamp: Date;

  @IsString()
  @IsOptional()
  @Column({ nullable: true })
  @ApiProperty({ description: 'Instrument or symbol related to the fill', required: false })
  instrument?: string;

  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({ description: 'Additional metadata captured during simulation', required: false })
  metadata?: Record<string, any>;

  @ManyToOne('Backtest', 'simulatedFills', { onDelete: 'CASCADE' })
  @JoinColumn()
  @ApiProperty({ description: 'Backtest run associated with this simulated fill' })
  backtest: Relation<Backtest>;

  @ManyToOne('BacktestSignal', 'simulatedFills', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn()
  @ApiProperty({ description: 'Source signal that triggered this fill', required: false })
  signal?: Relation<BacktestSignal>;

  constructor(partial: Partial<SimulatedOrderFill>) {
    Object.assign(this, partial);
  }
}
