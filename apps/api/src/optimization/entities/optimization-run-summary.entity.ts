import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  Relation
} from 'typeorm';

import { OptimizationRun } from './optimization-run.entity';

import { NUMERIC_TRANSFORMER } from '../../utils/transformers';

@Entity('optimization_run_summaries')
@Index(['computedAt'])
export class OptimizationRunSummary {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  optimizationRunId: string;

  @OneToOne(() => OptimizationRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'optimizationRunId' })
  optimizationRun: Relation<OptimizationRun>;

  @Column({ type: 'int', default: 0 })
  combinationsTested: number;

  @Column({ type: 'int', default: 0 })
  resultCount: number;

  @Column({ type: 'int', default: 0 })
  overfittingCount: number;

  @Column({ type: 'decimal', precision: 18, scale: 4, nullable: true, transformer: NUMERIC_TRANSFORMER })
  bestScore: number | null;

  @Column({ type: 'decimal', precision: 18, scale: 4, nullable: true, transformer: NUMERIC_TRANSFORMER })
  improvement: number | null;

  @Column({ type: 'decimal', precision: 18, scale: 4, nullable: true, transformer: NUMERIC_TRANSFORMER })
  avgTrainScore: number | null;

  @Column({ type: 'decimal', precision: 18, scale: 4, nullable: true, transformer: NUMERIC_TRANSFORMER })
  avgTestScore: number | null;

  @Column({ type: 'decimal', precision: 18, scale: 4, nullable: true, transformer: NUMERIC_TRANSFORMER })
  avgDegradation: number | null;

  @Column({ type: 'decimal', precision: 18, scale: 4, nullable: true, transformer: NUMERIC_TRANSFORMER })
  avgConsistency: number | null;

  @Column({ type: 'decimal', precision: 6, scale: 4, nullable: true, transformer: NUMERIC_TRANSFORMER })
  overfittingRate: number | null;

  @Column({ type: 'timestamptz' })
  computedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  constructor(partial: Partial<OptimizationRunSummary> = {}) {
    Object.assign(this, partial);
  }
}
