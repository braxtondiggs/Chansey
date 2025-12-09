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

import { StrategyConfig } from './strategy-config.entity';

import { User } from '../../users/users.entity';

/**
 * UserStrategyPosition entity
 * Tracks positions held by each user for each strategy
 * Enables per-strategy position tracking and P&L calculation
 */
@Entity('user_strategy_positions')
@Index(['userId', 'strategyConfigId', 'symbol'], { unique: true })
@Index(['userId'])
@Index(['strategyConfigId'])
export class UserStrategyPosition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'uuid',
    comment: 'User who owns this position'
  })
  userId: string;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({
    type: 'uuid',
    comment: 'Strategy that created and manages this position'
  })
  strategyConfigId: string;

  @ManyToOne(() => StrategyConfig, { eager: true })
  @JoinColumn({ name: 'strategyConfigId' })
  strategyConfig: StrategyConfig;

  @Column({
    type: 'varchar',
    length: 20,
    comment: 'Trading pair (e.g., BTCUSDT, ETHUSDT)'
  })
  symbol: string;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    comment: 'Current quantity held'
  })
  quantity: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    comment: 'Average entry price (cost basis)'
  })
  avgEntryPrice: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
    comment: 'Unrealized profit/loss (current position)'
  })
  unrealizedPnL: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
    comment: 'Realized profit/loss (closed trades)'
  })
  realizedPnL: number;

  @CreateDateColumn({
    type: 'timestamptz',
    comment: 'When this position was first opened'
  })
  createdAt: Date;

  @UpdateDateColumn({
    type: 'timestamptz',
    comment: 'Last time this position was updated'
  })
  updatedAt: Date;
}
