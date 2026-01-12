import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { Order, OrderStatus } from '../order.entity';

/**
 * Reason codes for order status transitions
 */
export enum OrderTransitionReason {
  EXCHANGE_SYNC = 'exchange_sync',
  USER_CANCEL = 'user_cancel',
  TRADE_EXECUTION = 'trade_execution',
  PARTIAL_FILL = 'partial_fill',
  ORDER_EXPIRED = 'order_expired',
  MARKET_CLOSE = 'market_close',
  SYSTEM_CANCEL = 'system_cancel',
  EXCHANGE_REJECT = 'exchange_reject'
}

/**
 * Tracks all order status transitions with reasons and metadata.
 * Provides an audit trail for order lifecycle events.
 */
@Entity('order_status_history')
@Index('IDX_order_status_history_order_time', ['orderId', 'transitionedAt'])
@Index('IDX_order_status_history_time', ['transitionedAt'])
@Index('IDX_order_status_history_transitions', ['fromStatus', 'toStatus'])
export class OrderStatusHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: Order;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    nullable: true,
    comment: 'Previous status (null for initial creation)'
  })
  fromStatus: OrderStatus | null;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    comment: 'New status after transition'
  })
  toStatus: OrderStatus;

  @CreateDateColumn({
    type: 'timestamptz',
    comment: 'When the transition occurred'
  })
  transitionedAt: Date;

  @Column({
    type: 'enum',
    enum: OrderTransitionReason,
    comment: 'Reason code for the status change'
  })
  reason: OrderTransitionReason;

  @Column({
    type: 'jsonb',
    nullable: true,
    comment: 'Additional context (exchange data, error messages, etc.)'
  })
  metadata?: Record<string, unknown> | null;
}
