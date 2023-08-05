import { ApiProperty } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { Coin } from '../coin/coin.entity';
import { ColumnNumericTransformer } from '../utils/transformers';

@Entity()
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

  @Column({ type: 'timestamptz' })
  @ApiProperty()
  geckoLastUpdatedAt: Date;

  @ManyToOne(() => Coin, (coin) => coin.prices, { nullable: false })
  coin: Coin;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  coinId: string;
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
