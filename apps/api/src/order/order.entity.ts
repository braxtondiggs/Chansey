import { ApiProperty } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { Coin } from '../coin/coin.entity';
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
export class Order {
  @PrimaryGeneratedColumn('uuid')
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

  @Column({ type: 'bigint' })
  @ApiProperty({
    description: 'Unique order ID',
    example: '123456789012345678',
    type: String // bigint is represented as string in JSON
  })
  orderId: string;

  @Column()
  @ApiProperty({
    description: 'Client-specified order ID',
    example: 'client-12345'
  })
  clientOrderId: string;

  @Column({ type: 'bigint' })
  @ApiProperty({
    description: 'Transaction time in milliseconds since epoch',
    example: '1622547800000',
    type: String // bigint is represented as string in JSON
  })
  transactTime: string;

  @Column({ type: 'decimal', precision: 20, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({
    description: 'Quantity of the order',
    example: 0.5
  })
  quantity: number;

  @Column({
    type: 'enum',
    enum: OrderStatus
  })
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
    onDelete: 'RESTRICT'
  })
  @ApiProperty({
    description: 'Coin associated with the order',
    type: () => Coin
  })
  coin: Coin;

  @CreateDateColumn()
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
