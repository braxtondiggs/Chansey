import { ApiProperty } from '@nestjs/swagger';

import { IsNumber, Min } from 'class-validator';
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation } from 'typeorm';

import { PaperTradingSession } from './paper-trading-session.entity';

import { ColumnNumericTransformer } from '../../../utils/transformers';

export interface SnapshotHolding {
  quantity: number;
  value: number;
  price: number;
  averageCost?: number;
  unrealizedPnL?: number;
  unrealizedPnLPercent?: number;
}

@Entity('paper_trading_snapshots')
@Index(['session'])
@Index(['session', 'timestamp'])
export class PaperTradingSnapshot {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique identifier for the snapshot' })
  id: string;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Total portfolio value at this point' })
  portfolioValue: number;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Cash balance (quote currency)' })
  cashBalance: number;

  @Column({ type: 'jsonb' })
  @ApiProperty({ description: 'Holdings breakdown by asset' })
  holdings: Record<string, SnapshotHolding>;

  @IsNumber()
  @Column({ type: 'decimal', precision: 8, scale: 4, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Cumulative return from initial capital up to this point' })
  cumulativeReturn: number;

  @IsNumber()
  @Column({ type: 'decimal', precision: 8, scale: 4, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Drawdown from peak at this point' })
  drawdown: number;

  @IsNumber()
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Unrealized P&L at this point', required: false })
  unrealizedPnL?: number;

  @IsNumber()
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Realized P&L at this point', required: false })
  realizedPnL?: number;

  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({ description: 'Prices of assets at this snapshot time', required: false })
  prices?: Record<string, number>;

  @Column({ type: 'timestamptz' })
  @ApiProperty({ description: 'Timestamp of this snapshot' })
  timestamp: Date;

  // Relations
  @ManyToOne(() => PaperTradingSession, (session) => session.snapshots, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  @ApiProperty({ description: 'Paper trading session this snapshot belongs to' })
  session: Relation<PaperTradingSession>;

  constructor(partial: Partial<PaperTradingSnapshot>) {
    Object.assign(this, partial);
  }
}
