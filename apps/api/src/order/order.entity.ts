import { Transform } from 'class-transformer';
import { Decimal } from 'decimal.js';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn
} from 'typeorm';

import type { TradeExecution } from '@chansey/api-interfaces';
import { OrderSide, OrderStatus, OrderType, TrailingType } from '@chansey/api-interfaces';

import { AlgorithmActivation } from '../algorithm/algorithm-activation.entity';
import { Coin } from '../coin/coin.entity';
import { Exchange } from '../exchange/exchange.entity';
import { User } from '../users/users.entity';
import { NUMERIC_TRANSFORMER } from '../utils/transformers';

export { OrderSide, OrderStatus, OrderType, TrailingType } from '@chansey/api-interfaces';
export type { TradeExecution } from '@chansey/api-interfaces';

@Entity()
@Index('IDX_order_userId', ['user'])
@Index('IDX_order_baseCoinId', ['baseCoin'])
@Index('IDX_order_quoteCoinId', ['quoteCoin'])
@Index('IDX_order_status_type', ['status', 'type'])
@Index('IDX_order_symbol_side_createdat', ['symbol', 'side', 'createdAt'])
@Index('IDX_order_basecoin_quotecoin', ['baseCoin', 'quoteCoin'])
@Index('IDX_order_user_status', ['user', 'status'])
@Index('IDX_order_user_side', ['user', 'side'])
@Index('IDX_order_exchange_status', ['exchange', 'status'])
@Index('IDX_order_user_status_slippage', ['user', 'status', 'actualSlippageBps'])
@Index('IDX_order_algo_trade_created', ['isAlgorithmicTrade', 'createdAt'])
@Index('IDX_order_algo_trade_slippage', ['isAlgorithmicTrade', 'actualSlippageBps'], {
  where: '"actualSlippageBps" IS NOT NULL'
})
@Index('IDX_order_daily_loss_gate', ['user', 'isAlgorithmicTrade', 'status', 'side', 'createdAt'], {
  where: '"gainLoss" < 0'
})
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 20 })
  symbol: string;

  @Column({ length: 50 })
  orderId: string;

  @Column({ length: 50 })
  clientOrderId: string;

  @Column({ type: 'timestamptz' })
  @Transform(({ value }) => new Date(Number(value)))
  transactTime: Date;

  @Column({ type: 'decimal', precision: 20, scale: 8, transformer: NUMERIC_TRANSFORMER })
  quantity: number;

  @Column({ type: 'decimal', precision: 20, scale: 8, transformer: NUMERIC_TRANSFORMER })
  price: number;

  @Column({ type: 'decimal', precision: 20, scale: 8, transformer: NUMERIC_TRANSFORMER, default: 0 })
  executedQuantity: number;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: NUMERIC_TRANSFORMER,
    nullable: true,
    default: null
  })
  cost?: number;

  @Column({ type: 'decimal', precision: 18, scale: 8, transformer: NUMERIC_TRANSFORMER, default: 0, nullable: false })
  fee: number;

  @Column({ type: 'decimal', precision: 18, scale: 8, transformer: NUMERIC_TRANSFORMER, default: 0, nullable: false })
  commission: number;

  @Column({ type: 'varchar', length: 10, nullable: true })
  feeCurrency?: string;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: NUMERIC_TRANSFORMER,
    nullable: true,
    default: null
  })
  gainLoss?: number;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: NUMERIC_TRANSFORMER,
    nullable: true,
    default: null
  })
  averagePrice?: number;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: NUMERIC_TRANSFORMER,
    nullable: true,
    default: null
  })
  expectedPrice?: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, transformer: NUMERIC_TRANSFORMER, nullable: true, default: null })
  actualSlippageBps?: number;

  @Column({ type: 'enum', enum: OrderStatus, enumName: 'order_status_enum' })
  status: OrderStatus;

  @Column({ type: 'enum', enum: OrderSide, enumName: 'order_side_enum' })
  side: OrderSide;

  @Column({ type: 'enum', enum: OrderType, enumName: 'order_type_enum' })
  type: OrderType;

  @ManyToOne('User', 'orders', { nullable: false, onDelete: 'CASCADE' })
  user: Relation<User>;

  @ManyToOne('Coin', 'baseOrders', { nullable: true, onDelete: 'SET NULL' })
  baseCoin?: Relation<Coin>;

  @ManyToOne('Coin', 'quoteOrders', { nullable: true, onDelete: 'SET NULL' })
  quoteCoin?: Relation<Coin>;

  @ManyToOne('Exchange', { nullable: true, onDelete: 'SET NULL' })
  exchange?: Relation<Exchange>;

  @Column({ type: 'uuid', nullable: true })
  @Index('IDX_order_algorithmActivationId')
  algorithmActivationId?: string;

  @ManyToOne('AlgorithmActivation', { nullable: true, onDelete: 'SET NULL' })
  algorithmActivation?: Relation<AlgorithmActivation>;

  @Column({ type: 'uuid', nullable: true })
  @Index('IDX_order_strategyConfigId')
  strategyConfigId?: string;

  @Column({ name: 'is_algorithmic_trade', type: 'boolean', default: false })
  isAlgorithmicTrade: boolean;

  @Column({ name: 'is_manual', type: 'boolean', default: false })
  isManual: boolean;

  @Column({ name: 'exchange_key_id', type: 'uuid', nullable: true })
  exchangeKeyId?: string;

  @Column({
    type: 'decimal',
    name: 'trailing_amount',
    precision: 20,
    scale: 8,
    transformer: NUMERIC_TRANSFORMER,
    nullable: true
  })
  trailingAmount?: number;

  @Column({ type: 'enum', name: 'trailing_type', enum: TrailingType, enumName: 'trailing_type_enum', nullable: true })
  trailingType?: TrailingType;

  @Column({ name: 'oco_linked_order_id', type: 'uuid', nullable: true })
  ocoLinkedOrderId?: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  timeInForce?: string;

  @Column({ type: 'decimal', precision: 20, scale: 8, transformer: NUMERIC_TRANSFORMER, nullable: true })
  stopPrice?: number;

  @Column({ type: 'decimal', precision: 20, scale: 8, transformer: NUMERIC_TRANSFORMER, nullable: true })
  triggerPrice?: number;

  @Column({ type: 'decimal', precision: 20, scale: 8, transformer: NUMERIC_TRANSFORMER, nullable: true })
  takeProfitPrice?: number;

  @Column({ type: 'decimal', precision: 20, scale: 8, transformer: NUMERIC_TRANSFORMER, nullable: true })
  stopLossPrice?: number;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: NUMERIC_TRANSFORMER,
    nullable: true,
    default: null
  })
  remaining?: number;

  @Column({ type: 'boolean', nullable: true })
  postOnly?: boolean;

  @Column({ type: 'boolean', nullable: true })
  reduceOnly?: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastTradeTimestamp?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastUpdateTimestamp?: Date;

  @Column({ type: 'jsonb', nullable: true })
  trades?: TradeExecution[];

  @Column({ type: 'jsonb', nullable: true })
  info?: Record<string, unknown>;

  @Column({ type: 'varchar', length: 10, default: 'spot' })
  @Index('IDX_order_market_type')
  marketType: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  positionSide?: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, transformer: NUMERIC_TRANSFORMER, nullable: true })
  leverage?: number;

  @Column({ type: 'decimal', precision: 20, scale: 8, transformer: NUMERIC_TRANSFORMER, nullable: true })
  liquidationPrice?: number;

  @Column({ type: 'decimal', precision: 20, scale: 8, transformer: NUMERIC_TRANSFORMER, nullable: true })
  marginAmount?: number;

  @Column({ type: 'varchar', length: 10, nullable: true })
  marginMode?: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  getTotalValue(): number {
    return new Decimal(this.quantity).times(this.price).toNumber();
  }

  isFilled(): boolean {
    return this.status === OrderStatus.FILLED;
  }

  isActive(): boolean {
    return [OrderStatus.NEW, OrderStatus.PARTIALLY_FILLED].includes(this.status);
  }

  getRemainingQuantity(): number {
    return new Decimal(this.quantity).minus(this.executedQuantity).toNumber();
  }

  getFillPercentage(): number {
    return this.quantity > 0 ? new Decimal(this.executedQuantity).div(this.quantity).times(100).toNumber() : 0;
  }

  constructor(partial: Partial<Order>) {
    Object.assign(this, partial);
  }
}
