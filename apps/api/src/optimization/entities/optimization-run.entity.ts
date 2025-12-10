import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn
} from 'typeorm';

import { StrategyConfig } from '../../strategy/entities/strategy-config.entity';
import { OptimizationConfig, ParameterSpace } from '../interfaces';

/**
 * Optimization run status
 */
export enum OptimizationStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

/**
 * Progress details for tracking optimization progress
 */
export interface OptimizationProgressDetails {
  currentCombination: number;
  currentWindow: number;
  totalWindows: number;
  estimatedTimeRemaining: number; // seconds
  lastUpdated: Date;
  currentBestScore?: number;
  currentBestParams?: Record<string, unknown>;
}

/**
 * OptimizationRun entity
 * Represents a single parameter optimization run for a strategy
 */
@Entity('optimization_runs')
@Index(['strategyConfigId', 'status'])
@Index(['createdAt'])
export class OptimizationRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  strategyConfigId: string;

  @ManyToOne(() => StrategyConfig, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'strategyConfigId' })
  strategyConfig: StrategyConfig;

  @Column({
    type: 'enum',
    enum: OptimizationStatus,
    default: OptimizationStatus.PENDING
  })
  status: OptimizationStatus;

  @Column({ type: 'jsonb' })
  config: OptimizationConfig;

  @Column({ type: 'jsonb' })
  parameterSpace: ParameterSpace;

  @Column({ type: 'jsonb', nullable: true })
  baselineParameters: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  bestParameters: Record<string, unknown>;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 4,
    nullable: true,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => (value ? parseFloat(value) : null)
    }
  })
  baselineScore: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 4,
    nullable: true,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => (value ? parseFloat(value) : null)
    }
  })
  bestScore: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 4,
    nullable: true,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => (value ? parseFloat(value) : null)
    },
    comment: 'Percentage improvement over baseline'
  })
  improvement: number;

  @Column({ type: 'int', default: 0 })
  combinationsTested: number;

  @Column({ type: 'int', default: 0 })
  totalCombinations: number;

  @Column({ type: 'int', nullable: true })
  windowsProcessed: number;

  @Column({ type: 'jsonb', nullable: true })
  progressDetails: OptimizationProgressDetails;

  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date;

  @OneToMany('OptimizationResult', 'optimizationRun')
  results: import('./optimization-result.entity').OptimizationResult[];
}
