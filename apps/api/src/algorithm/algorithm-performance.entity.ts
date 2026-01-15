import { ApiProperty } from '@nestjs/swagger';

import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { AlgorithmActivation } from './algorithm-activation.entity';

import { User } from '../users/users.entity';
import { ColumnNumericTransformer } from '../utils/transformers/columnNumeric.transformer';

/**
 * AlgorithmPerformance Entity
 *
 * Stores cached performance metrics and rankings for algorithm activations.
 * Updated by performance-ranking cron job every 5 minutes.
 */
@Entity('algorithm_performances')
@Index(['algorithmActivationId', 'calculatedAt']) // Time-series queries
@Index(['userId', 'rank']) // Ranking queries
@Index(['calculatedAt']) // Cleanup old records
export class AlgorithmPerformance {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique identifier for the performance record',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @Column({ type: 'uuid' })
  @ApiProperty({
    description: 'Algorithm activation ID',
    example: 'b4cc289e-9cf0-4999-0013-bdf5f7654113'
  })
  algorithmActivationId: string;

  @ManyToOne(() => AlgorithmActivation, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'algorithmActivationId' })
  @ApiProperty({
    description: 'Algorithm activation this performance belongs to'
  })
  algorithmActivation: AlgorithmActivation;

  @Column({ type: 'uuid' })
  @ApiProperty({
    description: 'User ID who owns this algorithm activation',
    example: 'c5dd390f-0dg1-5000-1124-ceg6g8765224'
  })
  userId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  @ApiProperty({
    description: 'User who owns this algorithm activation'
  })
  user: User;

  // Performance Metrics

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
    nullable: true
  })
  @ApiProperty({
    description: 'Return on Investment (%)',
    example: 2.5,
    required: false
  })
  roi?: number;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 4,
    transformer: new ColumnNumericTransformer(),
    nullable: true
  })
  @ApiProperty({
    description: 'Win rate as decimal (0.0-1.0), e.g., 0.65 = 65%',
    example: 0.65,
    required: false
  })
  winRate?: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 4,
    transformer: new ColumnNumericTransformer(),
    nullable: true
  })
  @ApiProperty({
    description: 'Sharpe ratio (risk-adjusted return metric)',
    example: 1.2,
    required: false
  })
  sharpeRatio?: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
    nullable: true
  })
  @ApiProperty({
    description: 'Maximum drawdown (%)',
    example: 15.3,
    required: false
  })
  maxDrawdown?: number;

  @Column({ type: 'integer', default: 0 })
  @ApiProperty({
    description: 'Total number of trades executed',
    example: 150
  })
  totalTrades: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 4,
    transformer: new ColumnNumericTransformer(),
    nullable: true
  })
  @ApiProperty({
    description: 'Risk-adjusted return metric',
    example: 0.85,
    required: false
  })
  riskAdjustedReturn?: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 4,
    transformer: new ColumnNumericTransformer(),
    nullable: true
  })
  @ApiProperty({
    description: 'Standard deviation of returns (volatility)',
    example: 0.15,
    required: false
  })
  volatility?: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 4,
    transformer: new ColumnNumericTransformer(),
    nullable: true
  })
  @ApiProperty({
    description: 'Excess return vs market benchmark (alpha)',
    example: 0.02,
    required: false
  })
  alpha?: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 4,
    transformer: new ColumnNumericTransformer(),
    nullable: true
  })
  @ApiProperty({
    description: 'Market correlation coefficient (beta)',
    example: 0.8,
    required: false
  })
  beta?: number;

  @Column({ type: 'integer', nullable: true })
  @ApiProperty({
    description: "Ranking among user's algorithms (1 = best)",
    example: 1,
    required: false
  })
  rank?: number;

  @Column({ type: 'timestamptz' })
  @ApiProperty({
    description: 'Timestamp when metrics were calculated',
    example: '2025-09-30T12:10:00Z'
  })
  calculatedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  @ApiProperty({
    description: 'Date when the performance record was created',
    example: '2025-09-30T12:10:00Z'
  })
  createdAt: Date;

  constructor(partial: Partial<AlgorithmPerformance>) {
    Object.assign(this, partial);
  }

  /**
   * Check if this is the top-ranked algorithm for the user
   */
  isTopRanked(): boolean {
    return this.rank === 1;
  }

  /**
   * Check if performance metrics meet minimum thresholds
   * Win rate threshold: 50% (0.5 in decimal format)
   */
  meetsPerformanceThreshold(): boolean {
    return this.totalTrades >= 10 && (this.roi ?? 0) > 0 && (this.winRate ?? 0) >= 0.5;
  }

  /**
   * Get risk-adjusted score combining multiple metrics
   */
  getRiskAdjustedScore(): number {
    const roiWeight = 0.4;
    const sharpeWeight = 0.3;
    const winRateWeight = 0.3;

    const normalizedRoi = Math.min((this.roi ?? 0) / 100, 1);
    const normalizedSharpe = Math.min((this.sharpeRatio ?? 0) / 3, 1);
    const normalizedWinRate = Math.min(this.winRate ?? 0, 1);

    return normalizedRoi * roiWeight + normalizedSharpe * sharpeWeight + normalizedWinRate * winRateWeight;
  }
}
