import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';

import { StrategyConfig } from '../../strategy/entities/strategy-config.entity';
import { User } from '../../users/users.entity';
import { ColumnNumericTransformer } from '../../utils/transformers';
import { ExitConfig, PositionExitStatus } from '../interfaces/exit-config.interface';
import { Order } from '../order.entity';

/**
 * Tracks exit orders (stop-loss, take-profit, trailing stop) attached to positions.
 * Links entry orders to their corresponding exit orders and tracks execution state.
 */
@Entity('position_exits')
@Index('IDX_position_exit_position_id', ['positionId'])
@Index('IDX_position_exit_entry_order', ['entryOrder'])
@Index('IDX_position_exit_status', ['status'])
@Index('IDX_position_exit_user_status', ['user', 'status'])
@Index('IDX_position_exit_trailing_active', ['status', 'trailingActivated'])
export class PositionExit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Reference to UserStrategyPosition.id (if from strategy)
   * Can be null for manual orders without strategy
   */
  @Column({ type: 'uuid', name: 'position_id', nullable: true })
  positionId?: string;

  /**
   * The entry order that triggered exit order creation
   */
  @ManyToOne(() => Order, { nullable: false })
  @JoinColumn({ name: 'entry_order_id' })
  entryOrder: Order;

  @Column({ type: 'uuid', name: 'entry_order_id' })
  entryOrderId: string;

  /**
   * Stop loss order (if placed)
   */
  @ManyToOne(() => Order, { nullable: true })
  @JoinColumn({ name: 'stop_loss_order_id' })
  stopLossOrder?: Order;

  @Column({ type: 'uuid', name: 'stop_loss_order_id', nullable: true })
  stopLossOrderId?: string;

  /**
   * Take profit order (if placed)
   */
  @ManyToOne(() => Order, { nullable: true })
  @JoinColumn({ name: 'take_profit_order_id' })
  takeProfitOrder?: Order;

  @Column({ type: 'uuid', name: 'take_profit_order_id', nullable: true })
  takeProfitOrderId?: string;

  /**
   * Trailing stop order (if placed)
   */
  @ManyToOne(() => Order, { nullable: true })
  @JoinColumn({ name: 'trailing_stop_order_id' })
  trailingStopOrder?: Order;

  @Column({ type: 'uuid', name: 'trailing_stop_order_id', nullable: true })
  trailingStopOrderId?: string;

  /**
   * Entry price used for exit calculations
   */
  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: new ColumnNumericTransformer()
  })
  entryPrice: number;

  /**
   * Calculated stop loss price
   */
  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    nullable: true,
    transformer: new ColumnNumericTransformer()
  })
  stopLossPrice?: number;

  /**
   * Calculated take profit price
   */
  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    nullable: true,
    transformer: new ColumnNumericTransformer()
  })
  takeProfitPrice?: number;

  /**
   * Current trailing stop price (updates as price moves favorably)
   */
  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    nullable: true,
    transformer: new ColumnNumericTransformer()
  })
  currentTrailingStopPrice?: number;

  /**
   * Highest price reached since entry (for long positions)
   * Used to calculate trailing stop level
   */
  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    nullable: true,
    transformer: new ColumnNumericTransformer()
  })
  trailingHighWaterMark?: number;

  /**
   * Lowest price reached since entry (for short positions)
   * Used to calculate trailing stop level
   */
  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    nullable: true,
    transformer: new ColumnNumericTransformer()
  })
  trailingLowWaterMark?: number;

  /**
   * Whether trailing stop has been activated
   */
  @Column({ type: 'boolean', default: false })
  trailingActivated: boolean;

  /**
   * Whether SL and TP are linked as OCO (one-cancels-other)
   */
  @Column({ type: 'boolean', default: false })
  ocoLinked: boolean;

  /**
   * Full exit configuration used for this position
   */
  @Column({ type: 'jsonb' })
  exitConfig: ExitConfig;

  /**
   * Current status of the exit orders
   */
  @Column({
    type: 'enum',
    enum: PositionExitStatus,
    default: PositionExitStatus.ACTIVE
  })
  status: PositionExitStatus;

  /**
   * Trading pair symbol (e.g., BTC/USDT)
   */
  @Column({ type: 'varchar', length: 20 })
  symbol: string;

  /**
   * Position quantity for exit orders
   */
  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: new ColumnNumericTransformer()
  })
  quantity: number;

  /**
   * Position side (BUY = long position, SELL = short position)
   */
  @Column({ type: 'varchar', length: 4 })
  side: 'BUY' | 'SELL';

  /**
   * User who owns this position
   */
  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  /**
   * Strategy configuration (if from automated strategy)
   */
  @ManyToOne(() => StrategyConfig, { nullable: true })
  @JoinColumn({ name: 'strategy_config_id' })
  strategyConfig?: StrategyConfig;

  @Column({ type: 'uuid', name: 'strategy_config_id', nullable: true })
  strategyConfigId?: string;

  /**
   * Exchange key used for placing orders
   */
  @Column({ type: 'uuid', nullable: true })
  exchangeKeyId?: string;

  /**
   * ATR value at time of entry (for ATR-based stops)
   */
  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    nullable: true,
    transformer: new ColumnNumericTransformer()
  })
  entryAtr?: number;

  /**
   * Timestamp when exit was triggered (SL/TP/trailing filled)
   */
  @Column({ type: 'timestamptz', nullable: true })
  triggeredAt?: Date;

  /**
   * Exit price when triggered
   */
  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    nullable: true,
    transformer: new ColumnNumericTransformer()
  })
  exitPrice?: number;

  /**
   * P&L realized from this exit (in quote currency)
   */
  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    nullable: true,
    transformer: new ColumnNumericTransformer()
  })
  realizedPnL?: number;

  /**
   * Warnings or notes from exit order placement
   */
  @Column({ type: 'jsonb', nullable: true })
  warnings?: string[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
