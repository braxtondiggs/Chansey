import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from '../../users/users.entity';
import { ColumnNumericTransformer } from '../../utils/transformers';
import { OpportunitySellDecision, OpportunitySellPlan } from '../interfaces/opportunity-selling.interface';

/**
 * Persists the result of each opportunity sell evaluation for auditing and analysis.
 * Records both approved and rejected evaluations so users can review the system's decisions.
 */
@Entity('opportunity_sell_evaluations')
@Index('IDX_opp_sell_user_evaluated', ['userId', 'evaluatedAt'])
@Index('IDX_opp_sell_decision', ['decision'])
@Index('IDX_opp_sell_buy_coin', ['buySignalCoinId'])
export class OpportunitySellEvaluation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  /** Coin ID of the buy signal that triggered this evaluation */
  @Column({ type: 'varchar', length: 100 })
  buySignalCoinId: string;

  /** Confidence level of the buy signal (0-1) */
  @Column({
    type: 'decimal',
    precision: 5,
    scale: 4,
    transformer: new ColumnNumericTransformer()
  })
  buySignalConfidence: number;

  /** Amount of cash needed beyond what was available */
  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: new ColumnNumericTransformer()
  })
  shortfall: number;

  /** Cash available at evaluation time */
  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: new ColumnNumericTransformer()
  })
  availableCash: number;

  /** Total portfolio value at evaluation time */
  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: new ColumnNumericTransformer()
  })
  portfolioValue: number;

  /** Total estimated proceeds from planned sells */
  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: new ColumnNumericTransformer()
  })
  projectedProceeds: number;

  /** Evaluation outcome */
  @Column({
    type: 'enum',
    enum: OpportunitySellDecision
  })
  decision: OpportunitySellDecision;

  /** Human-readable reason for the decision */
  @Column({ type: 'text' })
  reason: string;

  /** Full evaluation details including scored positions and sell orders */
  @Column({ type: 'jsonb' })
  evaluationDetails: OpportunitySellPlan;

  /** Whether this evaluation was from a backtest (not live trading) */
  @Column({ type: 'boolean', default: false })
  isBacktest: boolean;

  /** Optional backtest ID if this evaluation was from a backtest */
  @Column({ type: 'uuid', nullable: true })
  backtestId?: string;

  @CreateDateColumn({ type: 'timestamptz' })
  evaluatedAt: Date;
}
