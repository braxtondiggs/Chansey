import { ApiProperty } from '@nestjs/swagger';

import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min, Max } from 'class-validator';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';

import { ColumnNumericTransformer } from './../../utils/transformers';

import { Algorithm } from '../../algorithm/algorithm.entity';
import { Coin } from '../../coin/coin.entity';
import { User } from '../../users/users.entity';

export enum BacktestStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

export enum BacktestType {
  HISTORICAL = 'HISTORICAL',
  PAPER_TRADING = 'PAPER_TRADING',
  STRATEGY_OPTIMIZATION = 'STRATEGY_OPTIMIZATION'
}

@Entity('backtests')
@Index(['user', 'algorithm', 'status'])
@Index(['startDate', 'endDate'])
export class Backtest {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique identifier for the backtest' })
  id: string;

  @IsString()
  @IsNotEmpty()
  @Column()
  @ApiProperty({ description: 'Name of the backtest run' })
  name: string;

  @IsString()
  @IsOptional()
  @Column({ type: 'text', nullable: true })
  @ApiProperty({ description: 'Description of the backtest strategy', required: false })
  description?: string;

  @IsEnum(BacktestType)
  @IsNotEmpty()
  @Column({ type: 'enum', enum: BacktestType })
  @ApiProperty({ description: 'Type of backtest', enum: BacktestType })
  type: BacktestType;

  @IsEnum(BacktestStatus)
  @IsNotEmpty()
  @Column({ type: 'enum', enum: BacktestStatus, default: BacktestStatus.PENDING })
  @Index()
  @ApiProperty({ description: 'Current status of the backtest', enum: BacktestStatus })
  status: BacktestStatus;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Initial capital for the backtest in USD' })
  initialCapital: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0.001, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Trading fee percentage (e.g., 0.001 = 0.1%)', default: 0.001 })
  tradingFee: number;

  @Column({ type: 'timestamptz' })
  @ApiProperty({ description: 'Start date for historical backtest' })
  startDate: Date;

  @Column({ type: 'timestamptz' })
  @ApiProperty({ description: 'End date for historical backtest' })
  endDate: Date;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Final portfolio value', required: false })
  finalValue?: number;

  @IsNumber()
  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Total return percentage', required: false })
  totalReturn?: number;

  @IsNumber()
  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Annualized return percentage', required: false })
  annualizedReturn?: number;

  @IsNumber()
  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Sharpe ratio', required: false })
  sharpeRatio?: number;

  @IsNumber()
  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Maximum drawdown percentage', required: false })
  maxDrawdown?: number;

  @IsNumber()
  @Column({ type: 'integer', nullable: true })
  @ApiProperty({ description: 'Total number of trades executed', required: false })
  totalTrades?: number;

  @IsNumber()
  @Column({ type: 'integer', nullable: true })
  @ApiProperty({ description: 'Number of winning trades', required: false })
  winningTrades?: number;

  @IsNumber()
  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Win rate percentage', required: false })
  winRate?: number;

  @IsString()
  @IsOptional()
  @Column({ type: 'text', nullable: true })
  @ApiProperty({ description: 'Error message if backtest failed', required: false })
  errorMessage?: string;

  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({ description: 'Additional strategy parameters', required: false })
  strategyParams?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({ description: 'Performance metrics breakdown', required: false })
  performanceMetrics?: Record<string, any>;

  @CreateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: 'When the backtest was created' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: 'When the backtest was last updated' })
  updatedAt: Date;

  @Index('backtest_userId_index')
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn()
  @ApiProperty({ description: 'User who created the backtest' })
  user: User;

  @Index('backtest_algorithmId_index')
  @ManyToOne(() => Algorithm, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn()
  @ApiProperty({ description: 'Algorithm used for the backtest' })
  algorithm: Algorithm;

  @OneToMany(() => BacktestTrade, (trade) => trade.backtest, { cascade: true })
  @ApiProperty({ description: 'Trades executed during the backtest', type: () => [BacktestTrade] })
  trades: BacktestTrade[];

  @OneToMany(() => BacktestPerformanceSnapshot, (snapshot) => snapshot.backtest, { cascade: true })
  @ApiProperty({ description: 'Performance snapshots over time', type: () => [BacktestPerformanceSnapshot] })
  performanceSnapshots: BacktestPerformanceSnapshot[];

  constructor(partial: Partial<Backtest>) {
    Object.assign(this, partial);
  }
}

export enum TradeType {
  BUY = 'BUY',
  SELL = 'SELL'
}

export enum TradeStatus {
  EXECUTED = 'EXECUTED',
  FAILED = 'FAILED'
}

@Entity('backtest_trades')
@Index(['backtest', 'executedAt'])
@Index(['baseCoin', 'quoteCoin'])
export class BacktestTrade {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique identifier for the trade' })
  id: string;

  @IsEnum(TradeType)
  @IsNotEmpty()
  @Column({ type: 'enum', enum: TradeType })
  @ApiProperty({ description: 'Type of trade', enum: TradeType })
  type: TradeType;

  @IsEnum(TradeStatus)
  @IsNotEmpty()
  @Column({ type: 'enum', enum: TradeStatus, default: TradeStatus.EXECUTED })
  @ApiProperty({ description: 'Status of the trade', enum: TradeStatus })
  status: TradeStatus;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Quantity of base asset traded' })
  quantity: number;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Price per unit of base asset' })
  price: number;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Total value of the trade (quantity * price)' })
  totalValue: number;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Trading fee paid' })
  fee: number;

  @Column({ type: 'timestamptz' })
  @ApiProperty({ description: 'When the trade was executed' })
  executedAt: Date;

  @IsString()
  @IsOptional()
  @Column({ nullable: true })
  @ApiProperty({ description: 'Reason for the trade (signal that triggered it)', required: false })
  signal?: string;

  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({ description: 'Additional trade metadata', required: false })
  metadata?: Record<string, any>;

  @ManyToOne(() => Backtest, (backtest) => backtest.trades, { onDelete: 'CASCADE' })
  @JoinColumn()
  @ApiProperty({ description: 'Backtest this trade belongs to' })
  backtest: Backtest;

  @ManyToOne(() => Coin, { nullable: false })
  @JoinColumn()
  @ApiProperty({ description: 'Base coin being traded' })
  baseCoin: Coin;

  @ManyToOne(() => Coin, { nullable: false })
  @JoinColumn()
  @ApiProperty({ description: 'Quote coin (usually USD/USDT)' })
  quoteCoin: Coin;

  constructor(partial: Partial<BacktestTrade>) {
    Object.assign(this, partial);
  }
}

@Entity('backtest_performance_snapshots')
@Index(['backtest', 'timestamp'])
export class BacktestPerformanceSnapshot {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique identifier for the snapshot' })
  id: string;

  @Column({ type: 'timestamptz' })
  @ApiProperty({ description: 'Timestamp of this performance snapshot' })
  timestamp: Date;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Total portfolio value at this point' })
  portfolioValue: number;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Cash balance (quote currency)' })
  cashBalance: number;

  @Column({ type: 'jsonb' })
  @ApiProperty({ description: 'Holdings breakdown by asset' })
  holdings: Record<string, { quantity: number; value: number; price: number }>;

  @IsNumber()
  @Column({ type: 'decimal', precision: 8, scale: 4, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Return from initial capital up to this point' })
  cumulativeReturn: number;

  @IsNumber()
  @Column({ type: 'decimal', precision: 8, scale: 4, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Drawdown from peak at this point' })
  drawdown: number;

  @ManyToOne(() => Backtest, (backtest) => backtest.performanceSnapshots, { onDelete: 'CASCADE' })
  @JoinColumn()
  @ApiProperty({ description: 'Backtest this snapshot belongs to' })
  backtest: Backtest;

  constructor(partial: Partial<BacktestPerformanceSnapshot>) {
    Object.assign(this, partial);
  }
}
