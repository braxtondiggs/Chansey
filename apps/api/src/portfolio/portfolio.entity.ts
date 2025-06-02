import { ApiProperty } from '@nestjs/swagger';

import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { PortfolioType } from './portfolio-type.enum';

import { Coin } from '../coin/coin.entity';
import { User } from '../users/users.entity';

@Entity()
@Index(['coin', 'user', 'type'], { unique: true })
@Index(['id', 'user'], { unique: true })
export class Portfolio {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique identifier for the portfolio item',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @Column({
    type: 'enum',
    enum: PortfolioType,
    default: PortfolioType.MANUAL
  })
  @ApiProperty({
    description: 'Type of the portfolio item',
    example: PortfolioType.MANUAL,
    enum: PortfolioType
  })
  type: string;

  @CreateDateColumn({ type: 'timestamptz', select: false })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', select: false })
  updatedAt: Date;

  @Index('portfolio_coinId_index')
  @ManyToOne(() => Coin, (coin) => coin.portfolios, {
    nullable: false,
    onDelete: 'CASCADE',
    eager: true
  })
  @ApiProperty({
    description: 'Coin associated with this portfolio item',
    type: () => Coin
  })
  coin: Coin;

  @Index('portfolio_userId_index')
  @ManyToOne(() => User, (user) => user.portfolios, {
    nullable: false,
    onDelete: 'CASCADE',
    eager: true
  })
  @ApiProperty({
    description: 'User who owns this portfolio item',
    type: () => User
  })
  user: User;

  constructor(partial: Partial<Portfolio>) {
    Object.assign(this, partial);
  }
}

export enum PortfolioRelations {
  COIN = 'coin',
  USER = 'user'
}
