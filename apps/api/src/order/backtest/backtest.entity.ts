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

import { ColumnNumericTransformer } from './../../utils/transformers';
import { MarketDataSet } from './market-data-set.entity';

import { Algorithm } from '../../algorithm/algorithm.entity';
import { Coin } from '../../coin/coin.entity';
import { User } from '../../users/users.entity';

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

  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({
    description: 'Immutable snapshot of configuration parameters (algorithm version, dataset, execution window)',
    required: false
  })
  configSnapshot?: Record<string, any>;

  @IsString()
  @IsOptional()
  @Column({ nullable: true })
  @ApiProperty({ description: 'Deterministic seed used to reproduce the run', required: false })
  deterministicSeed?: string;

  @IsArray()
  @Column({ type: 'text', array: true, default: () => 'ARRAY[]::text[]' })
  @ApiProperty({ description: 'Warnings generated during the run', type: [String], required: false })
  warningFlags: string[];

  @CreateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: 'When the backtest was created' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: 'When the backtest was last updated' })
  updatedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiProperty({ description: 'When the backtest completed', required: false })
  completedAt?: Date;

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

  @OneToMany(() => BacktestTrade, (trade) => trade.backtest, { cascade: true })
  @ApiProperty({ description: 'Trades executed during the backtest', type: () => [BacktestTrade] })
  trades: BacktestTrade[];

  @OneToMany(() => BacktestPerformanceSnapshot, (snapshot) => snapshot.backtest, { cascade: true })
  @ApiProperty({ description: 'Performance snapshots over time', type: () => [BacktestPerformanceSnapshot] })
  performanceSnapshots: BacktestPerformanceSnapshot[];

  @OneToMany(() => BacktestSignal, (signal) => signal.backtest, { cascade: true })
  @ApiProperty({ description: 'Signals emitted during the run', type: () => [BacktestSignal] })
  signals: BacktestSignal[];

  @OneToMany(() => SimulatedOrderFill, (fill) => fill.backtest, { cascade: true })
  @ApiProperty({
    description: 'Simulated order fills captured during replay/backtest',
    type: () => [SimulatedOrderFill]
  })
  simulatedFills: SimulatedOrderFill[];

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

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Realized profit/loss in quote currency (only for SELL trades)', required: false })
  realizedPnL?: number;

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Realized P&L as percentage (e.g., 0.05 = 5% gain)', required: false })
  realizedPnLPercent?: number;

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Average cost basis at time of trade (entry price for position)', required: false })
  costBasis?: number;

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

  @ManyToOne('Coin', { nullable: false })
  @JoinColumn()
  @ApiProperty({ description: 'Base coin being traded' })
  baseCoin: Relation<Coin>;

  @ManyToOne('Coin', { nullable: false })
  @JoinColumn()
  @ApiProperty({ description: 'Quote coin (usually USD/USDT)' })
  quoteCoin: Relation<Coin>;

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

export enum SignalType {
  ENTRY = 'ENTRY',
  EXIT = 'EXIT',
  ADJUSTMENT = 'ADJUSTMENT',
  RISK_CONTROL = 'RISK_CONTROL'
}

export enum SignalDirection {
  LONG = 'LONG',
  SHORT = 'SHORT',
  FLAT = 'FLAT'
}

@Entity('backtest_signals')
@Index(['backtest', 'timestamp'])
export class BacktestSignal {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique identifier for the signal' })
  id: string;

  @Column({ type: 'timestamptz' })
  @ApiProperty({ description: 'Market timestamp when the signal was generated' })
  timestamp: Date;

  @IsEnum(SignalType)
  @Column({ type: 'enum', enum: SignalType })
  @ApiProperty({ description: 'Signal classification', enum: SignalType })
  signalType: SignalType;

  @IsString()
  @Column()
  @ApiProperty({ description: 'Instrument or symbol the signal targets' })
  instrument: string;

  @IsEnum(SignalDirection)
  @Column({ type: 'enum', enum: SignalDirection })
  @ApiProperty({ description: 'Directional intent of the signal', enum: SignalDirection })
  direction: SignalDirection;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Quantity or exposure requested by the signal' })
  quantity: number;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Reference price when applicable', required: false })
  price?: number;

  @IsString()
  @IsOptional()
  @Column({ type: 'text', nullable: true })
  @ApiProperty({ description: 'Human-readable explanation for the signal', required: false })
  reason?: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  @Column({ type: 'decimal', precision: 5, scale: 4, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Confidence score on a 0-1 scale', required: false })
  confidence?: number;

  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({ description: 'Custom metadata payload emitted with the signal', required: false })
  payload?: Record<string, any>;

  @ManyToOne(() => Backtest, (backtest) => backtest.signals, { onDelete: 'CASCADE' })
  @JoinColumn()
  @ApiProperty({ description: 'Backtest run that produced the signal' })
  backtest: Backtest;

  @OneToMany(() => SimulatedOrderFill, (fill) => fill.signal, { cascade: true })
  @ApiProperty({ description: 'Simulated fills linked to this signal', type: () => [SimulatedOrderFill] })
  simulatedFills: SimulatedOrderFill[];

  constructor(partial: Partial<BacktestSignal>) {
    Object.assign(this, partial);
  }
}

export enum SimulatedOrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP = 'STOP',
  STOP_LIMIT = 'STOP_LIMIT'
}

export enum SimulatedOrderStatus {
  FILLED = 'FILLED',
  PARTIAL = 'PARTIAL',
  CANCELLED = 'CANCELLED'
}

@Entity('simulated_order_fills')
@Index(['backtest', 'executionTimestamp'])
export class SimulatedOrderFill {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique identifier for the simulated fill' })
  id: string;

  @IsEnum(SimulatedOrderType)
  @Column({ type: 'enum', enum: SimulatedOrderType })
  @ApiProperty({ description: 'Simulated order type', enum: SimulatedOrderType })
  orderType: SimulatedOrderType;

  @IsEnum(SimulatedOrderStatus)
  @Column({ type: 'enum', enum: SimulatedOrderStatus })
  @ApiProperty({ description: 'Fill completion status', enum: SimulatedOrderStatus })
  status: SimulatedOrderStatus;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Quantity executed during the simulation' })
  filledQuantity: number;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Average price achieved by the simulated fill' })
  averagePrice: number;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Estimated fees charged for the fill' })
  fees: number;

  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Slippage captured in basis points', required: false })
  slippageBps?: number;

  @Column({ type: 'timestamptz' })
  @ApiProperty({ description: 'Timestamp recorded for the simulated execution' })
  executionTimestamp: Date;

  @IsString()
  @IsOptional()
  @Column({ nullable: true })
  @ApiProperty({ description: 'Instrument or symbol related to the fill', required: false })
  instrument?: string;

  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({ description: 'Additional metadata captured during simulation', required: false })
  metadata?: Record<string, any>;

  @ManyToOne(() => Backtest, (backtest) => backtest.simulatedFills, { onDelete: 'CASCADE' })
  @JoinColumn()
  @ApiProperty({ description: 'Backtest run associated with this simulated fill' })
  backtest: Backtest;

  @ManyToOne(() => BacktestSignal, (signal) => signal.simulatedFills, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn()
  @ApiProperty({ description: 'Source signal that triggered this fill', required: false })
  signal?: BacktestSignal;

  constructor(partial: Partial<SimulatedOrderFill>) {
    Object.assign(this, partial);
  }
}
