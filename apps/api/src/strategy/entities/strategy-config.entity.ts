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

import { StrategyStatus } from '@chansey/api-interfaces';

import { Algorithm } from '../../algorithm/algorithm.entity';
import { Risk } from '../../risk/risk.entity';
import { User } from '../../users/users.entity';

/**
 * StrategyConfig entity
 * Represents a variation/configuration of an existing algorithm for automated evaluation
 * Links to Algorithm entity via algorithmId foreign key
 */
@Entity('strategy_configs')
@Index(['status'])
@Index(['algorithmId'])
export class StrategyConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'varchar',
    length: 255
  })
  name: string;

  @Column({
    type: 'uuid',
    comment: 'Foreign key to algorithms table - references existing algorithm implementation'
  })
  algorithmId: string;

  @ManyToOne(() => Algorithm, { eager: true })
  @JoinColumn({ name: 'algorithmId' })
  algorithm: Algorithm;

  @Column({
    type: 'jsonb',
    comment: 'Strategy-specific parameters that override algorithm defaults'
  })
  parameters: Record<string, any>;

  @Column({
    type: 'varchar',
    length: 50
  })
  version: string;

  @Column({
    type: 'enum',
    enum: StrategyStatus,
    default: StrategyStatus.DRAFT
  })
  status: StrategyStatus;

  // Risk pool assignment - links to existing Risk entity
  @Column({
    type: 'uuid',
    nullable: true,
    comment: 'Foreign key to risk table - which risk pool this strategy is assigned to'
  })
  riskPoolId?: string | null;

  @ManyToOne(() => Risk, { nullable: true, eager: true })
  @JoinColumn({ name: 'riskPoolId' })
  riskPool?: Risk | null;

  // Shadow trading status for promotion workflow
  @Column({
    type: 'enum',
    enum: ['testing', 'shadow', 'live', 'retired'],
    default: 'testing',
    comment:
      'Lifecycle status: testing (backtest only), shadow (paper trading), live (real money), retired (removed from pools)'
  })
  shadowStatus: 'testing' | 'shadow' | 'live' | 'retired';

  @Column({
    type: 'uuid',
    nullable: true,
    comment: 'Reference to parent strategy for version tracking'
  })
  parentId?: string | null;

  @ManyToOne(() => StrategyConfig, { nullable: true })
  @JoinColumn({ name: 'parentId' })
  parent?: StrategyConfig | null;

  @Column({
    type: 'uuid',
    nullable: true
  })
  createdBy?: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'createdBy' })
  creator?: User | null;

  @CreateDateColumn({
    type: 'timestamptz'
  })
  createdAt: Date;

  @UpdateDateColumn({
    type: 'timestamptz'
  })
  updatedAt: Date;
}
