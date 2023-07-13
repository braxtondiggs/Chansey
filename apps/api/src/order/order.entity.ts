import { Column, Entity, JoinTable, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import User from '../users/users.entity';

export const enum OrderType {
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

export const enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL'
}

export const enum OrderStatus {
  CANCELED = 'CANCELED',
  EXPIRED = 'EXPIRED',
  FILLED = 'FILLED',
  NEW = 'NEW',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  PENDING_CANCEL = 'PENDING_CANCEL',
  REJECTED = 'REJECTED'
}

@Entity()
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false })
  symbol: string;

  @Column({ nullable: false, type: 'bigint' })
  orderId: string;

  @Column({ nullable: false })
  clientOrderId: string;

  @Column({ nullable: false, type: 'bigint' })
  transactTime: string;

  @Column({ nullable: false })
  quantity: string;

  @Column({
    type: 'enum',
    enum: [
      OrderStatus.CANCELED,
      OrderStatus.EXPIRED,
      OrderStatus.FILLED,
      OrderStatus.NEW,
      OrderStatus.PARTIALLY_FILLED,
      OrderStatus.PENDING_CANCEL,
      OrderStatus.REJECTED
    ],
    nullable: false
  })
  status: OrderStatus;

  @Column({
    type: 'enum',
    enum: [OrderSide.BUY, OrderSide.SELL],
    nullable: false
  })
  side: OrderSide;

  @Column({
    type: 'enum',
    enum: [OrderType.LIMIT, OrderType.MARKET],
    nullable: false
  })
  type: OrderType;

  @ManyToOne(() => User, (user) => user.orders)
  @JoinTable()
  user: User;

  constructor(partial: Partial<Order>) {
    Object.assign(this, partial);
  }
}
