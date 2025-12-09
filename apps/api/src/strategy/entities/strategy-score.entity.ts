import { Column, Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index } from 'typeorm';

import { ComponentScores, StrategyGrade } from '@chansey/api-interfaces';

import { StrategyConfig } from './strategy-config.entity';

/**
 * StrategyScore entity
 * Comprehensive scoring and ranking of strategies based on multi-factor evaluation
 */
@Entity('strategy_scores')
@Index(['strategyConfigId', 'effectiveDate'])
@Index(['percentile'])
export class StrategyScore {
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
    type: 'decimal',
    precision: 5,
    scale: 2,
    comment: 'Weighted composite score (0-100)'
  })
  overallScore: number;

  @Column({
    type: 'jsonb',
    comment: 'Individual metric scores JSON'
  })
  componentScores: ComponentScores;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    comment: 'Rank percentile among all strategies'
  })
  percentile: number;

  @Column({
    type: 'varchar',
    length: 2,
    comment: 'Letter grade (A-F)'
  })
  grade: StrategyGrade;

  @Column({
    type: 'boolean',
    default: false
  })
  promotionEligible: boolean;

  @Column({
    type: 'text',
    array: true,
    default: () => 'ARRAY[]::text[]'
  })
  warnings: string[];

  @Column({
    type: 'timestamptz',
    default: () => 'now()'
  })
  calculatedAt: Date;

  @Column({
    type: 'date'
  })
  effectiveDate: string;

  @Column({
    type: 'uuid',
    array: true,
    default: () => 'ARRAY[]::uuid[]',
    comment: 'Array of BacktestRun IDs used'
  })
  backtestRunIds: string[];
}
