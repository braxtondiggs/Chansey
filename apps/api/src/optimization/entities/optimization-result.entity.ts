import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation
} from 'typeorm';

import type { OptimizationRun } from './optimization-run.entity';

/**
 * Window result within an optimization result
 */
export interface WindowResult {
  windowIndex: number;
  trainScore: number;
  testScore: number;
  degradation: number;
  overfitting: boolean;
  trainStartDate: string;
  trainEndDate: string;
  testStartDate: string;
  testEndDate: string;
}

/**
 * OptimizationResult entity
 * Represents the result of testing a single parameter combination
 */
@Entity('optimization_results')
@Index(['optimizationRunId', 'rank'])
@Index(['avgTestScore'])
export class OptimizationResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  optimizationRunId: string;

  @ManyToOne('OptimizationRun', 'results', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'optimizationRunId' })
  optimizationRun: Relation<OptimizationRun>;

  @Column({ type: 'int' })
  combinationIndex: number;

  @Column({ type: 'jsonb' })
  parameters: Record<string, unknown>;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 4,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => (value ? parseFloat(value) : 0)
    }
  })
  avgTrainScore: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 4,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => (value ? parseFloat(value) : 0)
    }
  })
  avgTestScore: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 4,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => (value ? parseFloat(value) : 0)
    }
  })
  avgDegradation: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 4,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => (value ? parseFloat(value) : 0)
    },
    comment: 'Score from 0-100 indicating consistency across windows'
  })
  consistencyScore: number;

  @Column({ type: 'int' })
  overfittingWindows: number;

  @Column({ type: 'jsonb' })
  windowResults: WindowResult[];

  @Column({ type: 'int', nullable: true, comment: 'Rank based on test score (1 = best)' })
  rank: number;

  @Column({ type: 'boolean', default: false })
  isBaseline: boolean;

  @Column({ type: 'boolean', default: false })
  isBest: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
