import { ApiProperty } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
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

import { AlgorithmActivation } from '../algorithm/algorithm-activation.entity';
import { Coin } from '../coin/coin.entity';
import { Exchange } from '../exchange/exchange.entity';
import { User } from '../users/users.entity';
import { ColumnNumericTransformer } from '../utils/transformers';

export enum OrderType {
  MARKET = 'market',
  LIMIT = 'limit',
  STOP_LOSS = 'stop_loss',
  STOP_LIMIT = 'stop_limit',
  TRAILING_STOP = 'trailing_stop',
  TAKE_PROFIT = 'take_profit',
  OCO = 'oco'
}

export enum TrailingType {
  AMOUNT = 'amount',
  PERCENTAGE = 'percentage'
}

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL'
}

export enum OrderStatus {
  CANCELED = 'CANCELED',
  EXPIRED = 'EXPIRED',
  FILLED = 'FILLED',
  NEW = 'NEW',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  PENDING_CANCEL = 'PENDING_CANCEL',
  REJECTED = 'REJECTED'
}

/**
 * Individual trade execution data from exchange
 */
export interface TradeExecution {
  id: string;
  timestamp: number;
  price: number;
  amount: number;
  cost: number;
  fee?: {
    cost: number;
    currency: string;
  };
  side?: string;
  takerOrMaker?: string;
}

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
@Index('IDX_order_algo_trade_slippage', ['isAlgorithmicTrade', 'actualSlippageBps'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  @IsUUID()
  @ApiProperty({
    description: 'Unique identifier for the order',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @Column({ length: 20 })
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'Trading pair symbol (e.g., BTC/USDT)',
    example: 'BTC/USDT'
  })
  symbol: string;

  @Column({ length: 50 })
  @IsString()
  @ApiProperty({
    description: 'Exchange-specific order ID',
    example: '123456789012345678',
    type: String
  })
  orderId: string;

  @Column({ length: 50 })
  @IsString()
  @ApiProperty({
    description: 'Client-specified order ID for tracking',
    example: 'client-12345'
  })
  clientOrderId: string;

  @Column({ type: 'timestamptz' })
  @IsDate()
  @Transform(({ value }) => new Date(Number(value)))
  @ApiProperty({
    description: 'Transaction time',
    example: '2024-04-23T18:25:43.511Z',
    type: Date
  })
  transactTime: Date;

  @Column({ type: 'decimal', precision: 20, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({
    description: 'Quantity of the order',
    example: 0.5
  })
  quantity: number;

  @Column({ type: 'decimal', precision: 20, scale: 8, transformer: new ColumnNumericTransformer() })
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Price of the order',
    example: 35000.5
  })
  price: number;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: new ColumnNumericTransformer(),
    default: 0
  })
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Executed quantity of the order',
    example: 0.3
  })
  executedQuantity: number;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: new ColumnNumericTransformer(),
    nullable: true,
    default: null
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Total cost of the order (price * quantity)',
    example: 17500.25,
    required: false
  })
  cost?: number;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 8,
    transformer: new ColumnNumericTransformer(),
    default: 0,
    nullable: false
  })
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Fee paid for the order',
    example: 0.001
  })
  fee: number;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 8,
    transformer: new ColumnNumericTransformer(),
    default: 0,
    nullable: false
  })
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Commission paid for the order',
    example: 0.0015
  })
  commission: number;

  @Column({
    type: 'varchar',
    length: 10,
    nullable: true
  })
  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Currency of the fee',
    example: 'BNB',
    required: false
  })
  feeCurrency?: string;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: new ColumnNumericTransformer(),
    nullable: true,
    default: null
  })
  @IsNumber()
  @IsOptional()
  @ApiProperty({
    description: 'Calculated gain or loss for this order',
    example: 125.5,
    required: false
  })
  gainLoss?: number;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: new ColumnNumericTransformer(),
    nullable: true,
    default: null
  })
  @IsNumber()
  @IsOptional()
  @ApiProperty({
    description: 'Average execution price for partially filled orders',
    example: 35125.75,
    required: false
  })
  averagePrice?: number;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: new ColumnNumericTransformer(),
    nullable: true,
    default: null
  })
  @IsNumber()
  @IsOptional()
  @ApiProperty({
    description: 'Expected execution price captured before order submission (for slippage calculation)',
    example: 35000.5,
    required: false
  })
  expectedPrice?: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 4,
    transformer: new ColumnNumericTransformer(),
    nullable: true,
    default: null
  })
  @IsNumber()
  @IsOptional()
  @ApiProperty({
    description:
      'Actual slippage in basis points (positive = unfavorable, paid more for buy or received less for sell)',
    example: 15.5,
    required: false
  })
  actualSlippageBps?: number;

  @Column({
    type: 'enum',
    enum: OrderStatus
  })
  @IsEnum(OrderStatus)
  @IsNotEmpty()
  @ApiProperty({
    description: 'Current status of the order',
    enum: OrderStatus,
    example: OrderStatus.NEW
  })
  status: OrderStatus;

  @Column({
    type: 'enum',
    enum: OrderSide
  })
  @ApiProperty({
    description: 'Side of the order',
    enum: OrderSide,
    example: OrderSide.BUY
  })
  side: OrderSide;

  @Column({
    type: 'enum',
    enum: OrderType
  })
  @ApiProperty({
    description: 'Type of the order',
    enum: OrderType,
    example: OrderType.LIMIT
  })
  type: OrderType;

  @ManyToOne('User', 'orders', {
    nullable: false,
    onDelete: 'CASCADE'
  })
  @ApiProperty({
    description: 'User who placed the order',
    type: () => User
  })
  user: Relation<User>;

  @ManyToOne('Coin', 'baseOrders', {
    nullable: true,
    onDelete: 'SET NULL'
  })
  @ApiProperty({
    description: 'Base coin of the trading pair (the coin being bought/sold)',
    type: () => Coin,
    required: false
  })
  baseCoin?: Relation<Coin>;

  @ManyToOne('Coin', 'quoteOrders', {
    nullable: true,
    onDelete: 'SET NULL'
  })
  @ApiProperty({
    description: 'Quote coin of the trading pair (the coin used as payment)',
    type: () => Coin,
    required: false
  })
  quoteCoin?: Relation<Coin>;

  @ManyToOne('Exchange', { nullable: true, onDelete: 'SET NULL' })
  @ApiProperty({
    description: 'Exchange where the order was placed',
    type: () => Exchange,
    required: false
  })
  exchange?: Relation<Exchange>;

  @Column({ type: 'uuid', nullable: true })
  @IsUUID()
  @IsOptional()
  @Index('IDX_order_algorithmActivationId')
  @ApiProperty({
    description: 'Algorithm activation that generated this order',
    example: 'd6ee401g-1eh2-6111-2235-dfh7h9876335',
    required: false
  })
  algorithmActivationId?: string;

  @ManyToOne('AlgorithmActivation', { nullable: true, onDelete: 'SET NULL' })
  @ApiProperty({
    description: 'Algorithm activation that generated this order',
    type: () => AlgorithmActivation,
    required: false
  })
  algorithmActivation?: Relation<AlgorithmActivation>;

  @Column({ type: 'uuid', nullable: true })
  @IsUUID()
  @IsOptional()
  @Index('IDX_order_strategyConfigId')
  @ApiProperty({
    description: 'Strategy configuration that generated this algorithmic order (for robo-advisor)',
    example: 'e5f6g7h8-i9j0-k1l2-m3n4-o5p6q7r8s9t0',
    required: false
  })
  strategyConfigId?: string;

  @Column({ name: 'is_algorithmic_trade', type: 'boolean', default: false })
  @ApiProperty({
    description: 'Whether this order was placed by the automated algo trading system',
    example: false,
    default: false
  })
  isAlgorithmicTrade: boolean;

  @Column({ name: 'is_manual', type: 'boolean', default: false })
  @ApiProperty({
    description: 'Whether this order was placed manually by the user',
    example: true,
    default: false
  })
  isManual: boolean;

  @Column({ name: 'exchange_key_id', type: 'uuid', nullable: true })
  @IsUUID()
  @IsOptional()
  @ApiProperty({
    description: 'Exchange key used for this order',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    required: false
  })
  exchangeKeyId?: string;

  @Column({
    type: 'decimal',
    name: 'trailing_amount',
    precision: 20,
    scale: 8,
    transformer: new ColumnNumericTransformer(),
    nullable: true
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Trailing amount for trailing stop orders',
    example: 100.0,
    required: false
  })
  trailingAmount?: number;

  @Column({
    type: 'enum',
    name: 'trailing_type',
    enum: TrailingType,
    nullable: true
  })
  @IsEnum(TrailingType)
  @IsOptional()
  @ApiProperty({
    description: 'Trailing type (amount or percentage) for trailing stop orders',
    enum: TrailingType,
    required: false
  })
  trailingType?: TrailingType;

  @Column({ name: 'oco_linked_order_id', type: 'uuid', nullable: true })
  @IsUUID()
  @IsOptional()
  @ApiProperty({
    description: 'Linked order ID for OCO (One-Cancels-Other) orders',
    example: 'b1c2d3e4-f5g6-7890-h123-i45678901234',
    required: false
  })
  ocoLinkedOrderId?: string;

  @Column({
    type: 'varchar',
    length: 10,
    nullable: true
  })
  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Time in force policy (GTC, IOC, FOK)',
    example: 'GTC',
    required: false
  })
  timeInForce?: string;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: new ColumnNumericTransformer(),
    nullable: true
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Stop price for stop orders',
    example: 34000.0,
    required: false
  })
  stopPrice?: number;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: new ColumnNumericTransformer(),
    nullable: true
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Trigger price for conditional orders',
    example: 34500.0,
    required: false
  })
  triggerPrice?: number;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: new ColumnNumericTransformer(),
    nullable: true
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Take profit price',
    example: 36000.0,
    required: false
  })
  takeProfitPrice?: number;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: new ColumnNumericTransformer(),
    nullable: true
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Stop loss price',
    example: 32000.0,
    required: false
  })
  stopLossPrice?: number;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: new ColumnNumericTransformer(),
    nullable: true,
    default: null
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Remaining unfilled quantity',
    example: 0.2,
    required: false
  })
  remaining?: number;

  @Column({
    type: 'boolean',
    nullable: true
  })
  @IsOptional()
  @ApiProperty({
    description: 'Whether the order is post-only (maker-only)',
    example: false,
    required: false
  })
  postOnly?: boolean;

  @Column({
    type: 'boolean',
    nullable: true
  })
  @IsOptional()
  @ApiProperty({
    description: 'Whether the order is reduce-only (position management)',
    example: false,
    required: false
  })
  reduceOnly?: boolean;

  @Column({
    type: 'timestamptz',
    nullable: true
  })
  @IsDate()
  @IsOptional()
  @ApiProperty({
    description: 'Timestamp of the last trade execution',
    example: '2024-04-23T18:25:43.511Z',
    required: false,
    type: Date
  })
  lastTradeTimestamp?: Date;

  @Column({
    type: 'timestamptz',
    nullable: true
  })
  @IsDate()
  @IsOptional()
  @ApiProperty({
    description: 'Timestamp when the order was last updated',
    example: '2024-04-23T18:25:43.511Z',
    required: false,
    type: Date
  })
  lastUpdateTimestamp?: Date;

  @Column({
    type: 'jsonb',
    nullable: true
  })
  @IsOptional()
  @ApiProperty({
    description: 'Individual trade executions data',
    example: [
      {
        id: 'trade123',
        timestamp: 1640995200000,
        price: 35000.5,
        amount: 0.1,
        cost: 3500.05,
        fee: { cost: 3.5, currency: 'USDT' }
      }
    ],
    required: false
  })
  trades?: TradeExecution[];

  @Column({
    type: 'jsonb',
    nullable: true
  })
  @IsOptional()
  @ApiProperty({
    description: 'Raw exchange order data for advanced analysis',
    example: {
      orderId: 123456789,
      executedQty: '0.10000000',
      cummulativeQuoteQty: '3500.05000000',
      status: 'FILLED',
      timeInForce: 'GTC',
      type: 'MARKET'
    },
    required: false
  })
  info?: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  @ApiProperty({
    description: 'Timestamp when the order was created',
    example: '2024-04-23T18:25:43.511Z'
  })
  createdAt: Date;

  @UpdateDateColumn()
  @ApiProperty({
    description: 'Timestamp when the order was last updated',
    example: '2024-04-23T18:25:43.511Z'
  })
  updatedAt: Date;

  /**
   * Calculate the total value of the order (quantity * price)
   */
  getTotalValue(): number {
    return this.quantity * this.price;
  }

  /**
   * Check if the order is completely filled
   */
  isFilled(): boolean {
    return this.status === OrderStatus.FILLED;
  }

  /**
   * Check if the order is still active (can be filled)
   */
  isActive(): boolean {
    return [OrderStatus.NEW, OrderStatus.PARTIALLY_FILLED].includes(this.status);
  }

  /**
   * Get the remaining quantity to be filled
   */
  getRemainingQuantity(): number {
    return this.quantity - this.executedQuantity;
  }

  /**
   * Get the fill percentage
   */
  getFillPercentage(): number {
    return this.quantity > 0 ? (this.executedQuantity / this.quantity) * 100 : 0;
  }

  constructor(partial: Partial<Order>) {
    Object.assign(this, partial);
  }
}
