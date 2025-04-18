import { ApiProperty } from '@nestjs/swagger';

import { IsDate, IsNotEmpty, IsNumber, Min } from 'class-validator';
import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { Coin } from '../coin/coin.entity';
import { ColumnNumericTransformer } from '../utils/transformers';

@Entity()
@Index(['coin', 'createdAt'], { unique: true })
export class Price {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique identifier for the price entry',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: new ColumnNumericTransformer(),
    nullable: false
  })
  @ApiProperty({
    description: 'Current price of the coin',
    example: 45000.12345678
  })
  @IsNumber()
  @Min(0)
  price: number;

  @Column({
    type: 'decimal',
    precision: 30,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
    default: 0,
    nullable: false
  })
  @ApiProperty({
    description: 'Market capitalization of the coin',
    example: 850000000000.0
  })
  @IsNumber()
  @Min(0)
  marketCap: number;

  @Column({
    type: 'decimal',
    precision: 30,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
    default: 0,
    nullable: false
  })
  @ApiProperty({
    description: 'Total trading volume of the coin',
    example: 35000000000.0
  })
  totalVolume: number;

  @Column({
    type: 'timestamptz',
    nullable: false
  })
  @ApiProperty({
    description: 'Timestamp when CoinGecko last updated this price',
    example: '2024-04-23T18:25:43.511Z'
  })
  @IsDate()
  @IsNotEmpty()
  geckoLastUpdatedAt: Date;

  @Index('price_coinId_index')
  @ManyToOne(() => Coin, (coin) => coin.prices, {
    nullable: false,
    onDelete: 'CASCADE'
  })
  @ApiProperty({
    description: 'The coin associated with this price',
    type: () => Coin
  })
  coin: Coin;

  @CreateDateColumn()
  @ApiProperty({
    description: 'Timestamp when the price entry was created',
    example: '2024-04-23T18:25:43.511Z'
  })
  createdAt: Date;

  @Column()
  coinId: string;

  calculatePriceChange(previousPrice: Price): number {
    return ((this.price - previousPrice.price) / previousPrice.price) * 100;
  }

  isHigherThan(otherPrice: Price): boolean {
    return this.price > otherPrice.price;
  }

  constructor(partial: Partial<Omit<Price, 'id' | 'createdAt'>>) {
    Object.assign(this, partial);
  }
}

export interface PriceSummary {
  readonly avg: number;
  readonly coin: string;
  readonly date: Date;
  readonly high: number;
  readonly low: number;
}

export type PriceSummaryByPeriod = {
  [key: string]: PriceSummary[];
};

export type PriceSummaryByDay = PriceSummaryByPeriod;
export type PriceSummaryByHour = PriceSummaryByPeriod;
