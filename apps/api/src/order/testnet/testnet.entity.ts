import { Column, CreateDateColumn, Entity, JoinTable, ManyToOne, PrimaryGeneratedColumn, Timestamp } from 'typeorm';

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

  @CreateDateColumn({ select: false })
  createdAt: Timestamp;

  @ManyToOne(() => Coin, { nullable: false })
  @JoinTable()
  coin: Coin;

  @ManyToOne(() => Algorithm, { nullable: false })
  @JoinTable()
  algorithm: Algorithm;

  constructor(partial: Partial<Testnet>) {
    Object.assign(this, partial);
  }
}
