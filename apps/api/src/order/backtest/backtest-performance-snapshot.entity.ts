import { ApiProperty } from '@nestjs/swagger';

import { IsNumber, Min } from 'class-validator';
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation } from 'typeorm';

import type { Backtest } from './backtest.entity';

import { ColumnNumericTransformer } from '../../utils/transformers';

@Entity('backtest_performance_snapshots')
@Index(['backtest', 'timestamp'])
export class BacktestPerformanceSnapshot {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique identifier for the snapshot' })
  id: string;

  @Column({ type: 'timestamptz' })
  @ApiProperty({ description: 'Timestamp of this performance snapshot' })
  timestamp: Date;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 25, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Total portfolio value at this point' })
  portfolioValue: number;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 25, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Cash balance (quote currency)' })
  cashBalance: number;

  @Column({ type: 'jsonb' })
  @ApiProperty({ description: 'Holdings breakdown by asset' })
  holdings: Record<string, { quantity: number; value: number; price: number }>;

  @IsNumber()
  @Column({ type: 'decimal', precision: 18, scale: 4, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Return from initial capital up to this point' })
  cumulativeReturn: number;

  @IsNumber()
  @Column({ type: 'decimal', precision: 18, scale: 4, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Drawdown from peak at this point' })
  drawdown: number;

  @ManyToOne('Backtest', 'performanceSnapshots', { onDelete: 'CASCADE' })
  @JoinColumn()
  @ApiProperty({ description: 'Backtest this snapshot belongs to' })
  backtest: Relation<Backtest>;

  constructor(partial: Partial<BacktestPerformanceSnapshot>) {
    Object.assign(this, partial);
  }
}
