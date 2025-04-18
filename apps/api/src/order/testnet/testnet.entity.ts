import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
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

export enum TestnetStatus {
  PENDING = 'PENDING',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED'
}

@Entity()
@Index(['algorithm', 'coin']) // Composite index for better query performance
export class Testnet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @IsString()
  @IsOptional()
  @Column({ nullable: true })
  orderId: string;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, transformer: new ColumnNumericTransformer() })
  quantity: number;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, transformer: new ColumnNumericTransformer() })
  price: number;

  @IsEnum(OrderSide)
  @IsNotEmpty()
  @Column({
    type: 'enum',
    enum: OrderSide
  })
  side: OrderSide;

  @IsEnum(TestnetStatus)
  @IsNotEmpty()
  @Column({
    type: 'enum',
    enum: TestnetStatus,
    default: TestnetStatus.PENDING
  })
  @Index()
  status: TestnetStatus;

  @IsNumber()
  @Min(0)
  @Column({
    type: 'decimal',
    precision: 18,
    scale: 8,
    default: 0,
    transformer: new ColumnNumericTransformer()
  })
  fee: number;

  @IsNumber()
  @Min(0)
  @Column({
    type: 'decimal',
    precision: 18,
    scale: 8,
    default: 0,
    transformer: new ColumnNumericTransformer()
  })
  commission: number;

  @Column()
  symbol: string;

  @Index()
  @CreateDateColumn({ select: false })
  createdAt: Timestamp;

  @Column({
    type: 'timestamp',
    nullable: true,
    default: null,
    onUpdate: 'CURRENT_TIMESTAMP'
  })
  @Index()
  updatedAt: Timestamp;

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
