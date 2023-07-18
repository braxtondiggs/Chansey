import {
  Column,
  CreateDateColumn,
  Entity,
  JoinTable,
  ManyToOne,
  PrimaryGeneratedColumn,
  Timestamp,
  UpdateDateColumn
} from 'typeorm';

import { Algorithm } from '../../algorithm/algorithm.entity';
import { Coin } from '../../coin/coin.entity';
import { OrderSide } from '../order.entity';

@Entity()
export class Testnet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false })
  quantity: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  price: number;

  @Column({
    type: 'enum',
    enum: [OrderSide.BUY, OrderSide.SELL],
    nullable: false
  })
  side: OrderSide;

  @CreateDateColumn({ select: false })
  createdAt: Timestamp;

  @UpdateDateColumn({ select: false })
  updatedAt: Timestamp;

  @ManyToOne(() => Coin)
  @JoinTable()
  coin: Coin;

  @ManyToOne(() => Algorithm)
  @JoinTable()
  algorithm: Algorithm;

  constructor(partial: Partial<Testnet>) {
    Object.assign(this, partial);
  }
}
