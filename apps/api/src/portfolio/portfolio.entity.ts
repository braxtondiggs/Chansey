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

import { Coin } from '../coin/coin.entity';
import User from '../users/users.entity';

@Entity()
export class Portfolio {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: 'manual' })
  type: string;

  @CreateDateColumn({ select: false })
  createdAt: Timestamp;

  @UpdateDateColumn({ select: false })
  updatedAt: Timestamp;

  @ManyToOne(() => Coin, (coin) => coin.portfolios)
  @JoinTable()
  coin: Coin;

  @ManyToOne(() => User, (user) => user.portfolios)
  @JoinTable()
  user: User;
}
