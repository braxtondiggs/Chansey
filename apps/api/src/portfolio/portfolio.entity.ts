import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinTable,
  ManyToOne,
  PrimaryGeneratedColumn,
  Timestamp,
  UpdateDateColumn
} from 'typeorm';

import { Coin } from '../coin/coin.entity';
import { User } from '../users/users.entity';

@Entity()
@Index(['coin', 'user'], { unique: true })
@Index(['id', 'user'], { unique: true })
export class Portfolio {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @Column({ default: 'manual' })
  @ApiProperty()
  type: string;

  @CreateDateColumn({ select: false })
  createdAt: Timestamp;

  @UpdateDateColumn({ select: false })
  updatedAt: Timestamp;

  @Index('portfolio_coinId_index')
  @ManyToOne(() => Coin, (coin) => coin.portfolios)
  @JoinTable()
  @ApiProperty({ type: Coin })
  coin: Coin;

  @Index('portfolio_userId_index')
  @ManyToOne(() => User, (user) => user.portfolios)
  @JoinTable()
  user: User;

  constructor(partial: Partial<Portfolio>) {
    Object.assign(this, partial);
  }
}
