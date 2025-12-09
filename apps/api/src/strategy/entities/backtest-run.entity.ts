import {
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Index
} from 'typeorm';

import { BacktestRunStatus, BacktestConfiguration, BacktestResults } from '@chansey/api-interfaces';

import { StrategyConfig } from './strategy-config.entity';

/**
 * BacktestRun entity
 * Records a complete backtesting execution including configuration and results
 */
@Entity('backtest_runs')
@Index(['strategyConfigId', 'createdAt'])
@Index(['status'])
export class BacktestRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'uuid'
  })
  strategyConfigId: string;

  @ManyToOne(() => StrategyConfig)
  @JoinColumn({ name: 'strategyConfigId' })
  strategyConfig: StrategyConfig;

  @Column({
    type: 'timestamptz'
  })
  startedAt: Date;

  @Column({
    type: 'timestamptz',
    nullable: true
  })
  completedAt?: Date | null;

  @Column({
    type: 'enum',
    enum: BacktestRunStatus,
    default: BacktestRunStatus.PENDING
  })
  status: BacktestRunStatus;

  @Column({
    type: 'jsonb',
    comment: 'Complete configuration used for the run'
  })
  config: BacktestConfiguration;

  @Column({
    type: 'varchar',
    length: 64,
    comment: 'SHA-256 hash of dataset for reproducibility'
  })
  datasetChecksum: string;

  @Column({
    type: 'int',
    default: 0
  })
  windowCount: number;

  @Column({
    type: 'jsonb',
    nullable: true,
    comment: 'Aggregated results JSON'
  })
  results?: BacktestResults | null;

  @Column({
    type: 'text',
    nullable: true
  })
  errorMessage?: string | null;

  @Column({
    type: 'int',
    nullable: true,
    comment: 'Total execution time in milliseconds'
  })
  executionTimeMs?: number | null;

  @CreateDateColumn({
    type: 'timestamptz'
  })
  createdAt: Date;

  @UpdateDateColumn({
    type: 'timestamptz'
  })
  updatedAt: Date;
}
