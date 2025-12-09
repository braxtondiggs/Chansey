import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index } from 'typeorm';

import { WindowMetrics } from '@chansey/api-interfaces';

import { BacktestRun } from './backtest-run.entity';

/**
 * WalkForwardWindow entity
 * Represents a single train/test window within a walk-forward analysis
 */
@Entity('walk_forward_windows')
@Index(['backtestRunId', 'windowIndex'])
export class WalkForwardWindow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'uuid'
  })
  backtestRunId: string;

  @ManyToOne(() => BacktestRun)
  @JoinColumn({ name: 'backtestRunId' })
  backtestRun: BacktestRun;

  @Column({
    type: 'int'
  })
  windowIndex: number;

  @Column({
    type: 'date'
  })
  trainStartDate: string;

  @Column({
    type: 'date'
  })
  trainEndDate: string;

  @Column({
    type: 'date'
  })
  testStartDate: string;

  @Column({
    type: 'date'
  })
  testEndDate: string;

  @Column({
    type: 'jsonb',
    comment: 'Training period performance metrics'
  })
  trainMetrics: WindowMetrics;

  @Column({
    type: 'jsonb',
    comment: 'Test period performance metrics'
  })
  testMetrics: WindowMetrics;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 4,
    comment: 'Percentage performance degradation from train to test'
  })
  degradation: number;

  @CreateDateColumn({
    type: 'timestamptz'
  })
  createdAt: Date;
}
