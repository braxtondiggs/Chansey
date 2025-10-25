import { ApiProperty } from '@nestjs/swagger';

import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { Backtest } from './backtest.entity';

export enum MarketDataSource {
  EXCHANGE_STREAM = 'EXCHANGE_STREAM',
  VENDOR_FEED = 'VENDOR_FEED',
  INTERNAL_CAPTURE = 'INTERNAL_CAPTURE'
}

export enum MarketDataTimeframe {
  TICK = 'TICK',
  SECOND = 'SECOND',
  MINUTE = 'MINUTE',
  HOUR = 'HOUR',
  DAY = 'DAY'
}

@Entity('market_data_sets')
@Index(['source', 'timeframe'])
@Index(['startAt', 'endAt'])
export class MarketDataSet {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique identifier for the dataset' })
  id: string;

  @IsString()
  @IsNotEmpty()
  @Column()
  @ApiProperty({ description: 'Human-friendly dataset label' })
  label: string;

  @IsEnum(MarketDataSource)
  @Column({ type: 'enum', enum: MarketDataSource })
  @ApiProperty({ description: 'Origin of the dataset', enum: MarketDataSource })
  source: MarketDataSource;

  @Column({ type: 'text', array: true, default: () => 'ARRAY[]::text[]' })
  @ApiProperty({ description: 'Universe of instruments included', type: [String] })
  instrumentUniverse: string[];

  @IsEnum(MarketDataTimeframe)
  @Column({ type: 'enum', enum: MarketDataTimeframe })
  @ApiProperty({ description: 'Granularity of the dataset', enum: MarketDataTimeframe })
  timeframe: MarketDataTimeframe;

  @Column({ type: 'timestamptz' })
  @ApiProperty({ description: 'Start timestamp covered by the dataset' })
  startAt: Date;

  @Column({ type: 'timestamptz' })
  @ApiProperty({ description: 'End timestamp covered by the dataset' })
  endAt: Date;

  @IsInt()
  @Min(0)
  @Max(100)
  @Column({ type: 'int' })
  @ApiProperty({ description: 'Data integrity score (0-100)' })
  integrityScore: number;

  @IsString()
  @Column()
  @ApiProperty({ description: 'Checksum for tamper detection' })
  checksum: string;

  @IsString()
  @Column()
  @ApiProperty({ description: 'Storage location (path or URI) for the dataset' })
  storageLocation: string;

  @IsBoolean()
  @Column({ default: false })
  @ApiProperty({ description: 'Flag indicating suitability for live replay streaming', default: false })
  replayCapable: boolean;

  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({ description: 'Supplemental metadata or documentation references', required: false })
  metadata?: Record<string, any>;

  @CreateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: 'Dataset creation timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: 'Last time dataset metadata was updated' })
  updatedAt: Date;

  @OneToMany(() => Backtest, (backtest) => backtest.marketDataSet)
  @ApiProperty({ description: 'Backtests referencing this dataset', type: () => [Backtest] })
  backtests: Backtest[];
}
