import { ApiProperty } from '@nestjs/swagger';

import { IsArray, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn
} from 'typeorm';

import { BacktestCheckpointState } from './backtest-checkpoint.interface';
import { LiveReplayState } from './backtest-pacing.interface';
import { BacktestPerformanceSnapshot } from './backtest-performance-snapshot.entity';
import { BacktestSignal } from './backtest-signal.entity';
import { BacktestTrade } from './backtest-trade.entity';
import { MarketDataSet } from './market-data-set.entity';
import { SimulatedOrderFill } from './simulated-order-fill.entity';

import { Algorithm } from '../../algorithm/algorithm.entity';
import { User } from '../../users/users.entity';
import { ColumnNumericTransformer } from '../../utils/transformers';

export interface BacktestConfigSnapshot {
  coinSymbolFilter?: string[];
  [key: string]: any;
}

export enum BacktestStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

export enum BacktestType {
  HISTORICAL = 'HISTORICAL',
  LIVE_REPLAY = 'LIVE_REPLAY',
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
  @Column({ type: 'enum', enum: BacktestType, enumName: 'backtest_type_enum' })
  @ApiProperty({ description: 'Type of backtest', enum: BacktestType })
  type: BacktestType;

  @IsEnum(BacktestStatus)
  @IsNotEmpty()
  @Column({ type: 'enum', enum: BacktestStatus, enumName: 'backtest_status_enum', default: BacktestStatus.PENDING })
  @Index()
  @ApiProperty({ description: 'Current status of the backtest', enum: BacktestStatus })
  status: BacktestStatus;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 25, scale: 8, transformer: new ColumnNumericTransformer() })
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
  @Column({ type: 'decimal', precision: 25, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Final portfolio value', required: false })
  finalValue?: number;

  @IsNumber()
  @Column({ type: 'decimal', precision: 25, scale: 4, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Total return percentage', required: false })
  totalReturn?: number;

  @IsNumber()
  @Column({ type: 'decimal', precision: 25, scale: 4, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Annualized return percentage', required: false })
  annualizedReturn?: number;

  @IsNumber()
  @Column({ type: 'decimal', precision: 25, scale: 4, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Sharpe ratio', required: false })
  sharpeRatio?: number;

  @IsNumber()
  @Column({ type: 'decimal', precision: 25, scale: 4, nullable: true, transformer: new ColumnNumericTransformer() })
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
  @Column({ type: 'decimal', precision: 25, scale: 4, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Win rate as decimal (0.0-1.0), e.g., 0.65 = 65%', required: false })
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

  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({
    description:
      'Snapshot of configuration parameters (algorithm version, dataset, execution window). May include system-managed fields added during orchestration or recovery.',
    required: false
  })
  configSnapshot?: BacktestConfigSnapshot;

  @IsString()
  @IsOptional()
  @Column({ nullable: true })
  @ApiProperty({ description: 'Deterministic seed used to reproduce the run', required: false })
  deterministicSeed?: string;

  @IsArray()
  @Column({ type: 'text', array: true, default: () => 'ARRAY[]::text[]' })
  @ApiProperty({ description: 'Warnings generated during the run', type: [String], required: false })
  warningFlags: string[];

  @Column({ type: 'varchar', length: 20, default: 'spot' })
  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'Market type: spot or futures', default: 'spot' })
  marketType: string;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(10)
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Leverage multiplier for futures backtests', required: false })
  leverage?: number;

  @CreateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: 'When the backtest was created' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: 'When the backtest was last updated' })
  updatedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiProperty({ description: 'When the backtest completed', required: false })
  completedAt?: Date;

  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({ description: 'Checkpoint state for resume capability', required: false })
  checkpointState?: BacktestCheckpointState;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiProperty({ description: 'When the last checkpoint was saved', required: false })
  lastCheckpointAt?: Date;

  @IsNumber()
  @Column({ type: 'integer', default: 0 })
  @ApiProperty({ description: 'Number of timestamps processed so far', default: 0 })
  processedTimestampCount: number;

  @IsNumber()
  @Column({ type: 'integer', default: 0 })
  @ApiProperty({ description: 'Total number of timestamps to process', default: 0 })
  totalTimestampCount: number;

  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({ description: 'Live replay state for pause/resume and pacing configuration', required: false })
  liveReplayState?: LiveReplayState;

  @Index('backtest_userId_index')
  @ManyToOne('User', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn()
  @ApiProperty({ description: 'User who created the backtest' })
  user: Relation<User>;

  @Index('backtest_algorithmId_index')
  @ManyToOne('Algorithm', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn()
  @ApiProperty({ description: 'Algorithm used for the backtest' })
  algorithm: Relation<Algorithm>;

  @IsOptional()
  @ManyToOne('MarketDataSet', 'backtests', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn()
  @ApiProperty({ description: 'Market data set leveraged for the run', required: false, type: () => MarketDataSet })
  marketDataSet?: Relation<MarketDataSet>;

  @OneToMany('BacktestTrade', 'backtest', { cascade: true })
  @ApiProperty({ description: 'Trades executed during the backtest', type: () => [BacktestTrade] })
  trades: BacktestTrade[];

  @OneToMany('BacktestPerformanceSnapshot', 'backtest', { cascade: true })
  @ApiProperty({ description: 'Performance snapshots over time', type: () => [BacktestPerformanceSnapshot] })
  performanceSnapshots: BacktestPerformanceSnapshot[];

  @OneToMany('BacktestSignal', 'backtest', { cascade: true })
  @ApiProperty({ description: 'Signals emitted during the run', type: () => [BacktestSignal] })
  signals: BacktestSignal[];

  @OneToMany('SimulatedOrderFill', 'backtest', { cascade: true })
  @ApiProperty({
    description: 'Simulated order fills captured during replay/backtest',
    type: () => [SimulatedOrderFill]
  })
  simulatedFills: SimulatedOrderFill[];

  constructor(partial: Partial<Backtest>) {
    Object.assign(this, partial);
  }
}
