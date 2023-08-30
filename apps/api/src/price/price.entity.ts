import { ApiProperty } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { Coin } from '../coin/coin.entity';
import { ColumnNumericTransformer } from '../utils/transformers';

@Entity()
@Index(['coin', 'createdAt'], { unique: true })
export class Price {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @Column({ type: 'decimal', transformer: new ColumnNumericTransformer() })
  @ApiProperty()
  price: number;

  @Column({ type: 'decimal', default: 0, transformer: new ColumnNumericTransformer() })
  @ApiProperty()
  marketCap: number;

  @Column({ type: 'decimal', default: 0, transformer: new ColumnNumericTransformer() })
  @ApiProperty()
  totalVolume: number;

  @Column({ type: 'timestamptz' })
  @ApiProperty()
  geckoLastUpdatedAt: Date;

  @Index('price_coinId_index')
  @ManyToOne(() => Coin, (coin) => coin.prices, { nullable: false, onDelete: 'CASCADE' })
  coin: Coin;

  @CreateDateColumn()
  createdAt: Date;

  @Column()
  coinId: string;

  constructor(partial: Partial<Price>) {
    Object.assign(this, partial);
  }
}

export interface PriceSummary {
  avg: number;
  coin: string;
  date: Date;
  high: number;
  low: number;
}

export interface PriceSummaryByDay {
  [key: string]: PriceSummary[];
}

export interface PriceSummaryByHour {
  [key: string]: PriceSummary[];
}
