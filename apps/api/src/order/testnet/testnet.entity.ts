import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinTable,
  ManyToOne,
  PrimaryGeneratedColumn,
  Timestamp
} from 'typeorm';

import { ColumnNumericTransformer } from './../../utils/transformers';
import { Algorithm } from '../../algorithm/algorithm.entity';
import { Coin } from '../../coin/coin.entity';
import { OrderSide } from '../order.entity';

@Entity()
export class Testnet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'decimal', transformer: new ColumnNumericTransformer() })
  quantity: number;

  @Column({ type: 'decimal', transformer: new ColumnNumericTransformer() })
  price: number;

  @Column({
    type: 'enum',
    enum: [OrderSide.BUY, OrderSide.SELL]
  })
  side: OrderSide;

  @Column()
  symbol: string;

  @Index()
  @CreateDateColumn({ select: false })
  createdAt: Timestamp;

  @Index('testnet_coinId_index')
  @ManyToOne(() => Coin, { nullable: false, onDelete: 'CASCADE' })
  @JoinTable()
  coin: Coin;

  @Index('testnet_algorithmId_index')
  @ManyToOne(() => Algorithm, { nullable: false, onDelete: 'CASCADE' })
  @JoinTable()
  algorithm: Algorithm;

  constructor(partial: Partial<Testnet>) {
    Object.assign(this, partial);
  }
}
