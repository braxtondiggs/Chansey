import { ApiProperty } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { Coin } from '../coin/coin.entity';
import { Exchange } from '../exchange/exchange.entity';
import { User } from '../users/users.entity';
import { ColumnNumericTransformer } from '../utils/transformers';

export enum OrderType {
  LIMIT = 'LIMIT',
  LIMIT_MAKER = 'LIMIT_MAKER',
  MARKET = 'MARKET',
  STOP = 'STOP',
  STOP_MARKET = 'STOP_MARKET',
  STOP_LOSS_LIMIT = 'STOP_LOSS_LIMIT',
  TAKE_PROFIT_LIMIT = 'TAKE_PROFIT_LIMIT',
  TAKE_PROFIT_MARKET = 'TAKE_PROFIT_MARKET',
  TRAILING_STOP_MARKET = 'TRAILING_STOP_MARKET'
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

@Entity()
@Index('IDX_order_userId', ['user'])
@Index('IDX_order_coinId', ['coin'])
@Index('IDX_order_status_type', ['status', 'type'])
@Index('IDX_order_symbol_side_createdat', ['symbol', 'side', 'createdAt'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  @IsUUID()
  @ApiProperty({
    description: 'Unique identifier for the order',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @Column()
  @ApiProperty({
    description: 'Unique identifier for the order',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  symbol: string;

  @Column()
  @ApiProperty({
    description: 'Unique order ID',
    example: '123456789012345678',
    type: String
  })
  orderId: string;

  @Column()
  @ApiProperty({
    description: 'Client-specified order ID',
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

  @ManyToOne(() => User, (user) => user.orders, {
    nullable: false,
    onDelete: 'CASCADE'
  })
  @ApiProperty({
    description: 'User who placed the order',
    type: () => User
  })
  user: User;

  @ManyToOne(() => Coin, (coin) => coin.orders, {
    nullable: false,
    onDelete: 'CASCADE'
  })
  @ApiProperty({
    description: 'Coin associated with the order',
    type: () => Coin
  })
  coin: Coin;

  @ManyToOne(() => Exchange, { nullable: true, onDelete: 'SET NULL' })
  @ApiProperty({
    description: 'Exchange where the order was placed',
    type: () => Exchange,
    required: false
  })
  exchange?: Exchange;

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

  constructor(partial: Partial<Order>) {
    Object.assign(this, partial);
  }
}
