import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Timestamp,
  UpdateDateColumn
} from 'typeorm';

import { Portfolio } from '../portfolio/portfolio.entity';
import { Price } from '../price/price.entity';

@Entity()
export class Coin {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @Column({ unique: true })
  @ApiProperty()
  slug: string;

  @Column({ unique: true })
  @ApiProperty()
  name: string;

  @Column()
  @ApiProperty()
  symbol: string;

  @Column({ nullable: true })
  @ApiProperty()
  description?: string;

  @Column({ nullable: true })
  @ApiProperty()
  image?: string;

  @Column({ type: 'date', nullable: true })
  @ApiProperty()
  genesis?: Date;

  @Column({ nullable: true })
  @ApiProperty()
  marketRank?: number;

  @Column({ nullable: true })
  @ApiProperty()
  geckoRank?: number;

  @Column({ type: 'decimal', nullable: true })
  @ApiProperty()
  developerScore?: number;

  @Column({ type: 'decimal', nullable: true })
  @ApiProperty()
  communityScore?: number;

  @Column({ type: 'decimal', nullable: true })
  @ApiProperty()
  liquidityScore?: number;

  @Column({ type: 'decimal', nullable: true })
  @ApiProperty()
  publicInterestScore?: number;

  @Column({ type: 'decimal', nullable: true })
  @ApiProperty()
  sentiment_up?: number;

  @Column({ type: 'decimal', nullable: true })
  @ApiProperty()
  sentiment_down?: number;

  @CreateDateColumn({ select: false })
  createdAt: Timestamp;

  @UpdateDateColumn({ select: false })
  updatedAt: Timestamp;

  @OneToMany(() => Portfolio, (portfolio) => portfolio.coin)
  @ApiProperty({
    type: Portfolio,
    isArray: true
  })
  portfolios: Portfolio[];

  @OneToMany(() => Price, (price) => price.coin)
  @ApiProperty({
    type: Price,
    isArray: true
  })
  prices: Price[];

  constructor(partial: Partial<Coin>) {
    Object.assign(this, partial);
  }
}
