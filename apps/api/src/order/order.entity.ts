import { Column, Entity, Index, JoinTable, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { Coin } from '../coin/coin.entity';
import { User } from '../users/users.entity';
import { ColumnNumericTransformer } from '../utils/transformers';

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

  @Column()
  symbol: string;

  @Column({ type: 'bigint' })
  orderId: string;

  @Column()
  clientOrderId: string;

  @Column({ type: 'bigint' })
  transactTime: string;

  @Column({ type: 'decimal', transformer: new ColumnNumericTransformer() })
  quantity: number;

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
    ]
  })
  status: OrderStatus;

  @Column({
    type: 'enum',
    enum: [OrderSide.BUY, OrderSide.SELL]
  })
  side: OrderSide;

  @Column({
    type: 'enum',
    enum: [OrderType.LIMIT, OrderType.MARKET]
  })
  type: OrderType;

  @Index('order_userId_index')
  @ManyToOne(() => User, (user) => user.orders, { nullable: false, onDelete: 'CASCADE' })
  @JoinTable()
  user: User;

  @Index('order_coinId_index')
  @ManyToOne(() => Coin, { nullable: false, onDelete: 'RESTRICT' })
  @JoinTable()
  coin: Coin;

  constructor(partial: Partial<Order>) {
    Object.assign(this, partial);
  }
}
