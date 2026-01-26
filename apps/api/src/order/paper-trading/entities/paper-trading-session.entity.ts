import { ApiProperty } from '@nestjs/swagger';

import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
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

import { PaperTradingAccount } from './paper-trading-account.entity';
import { PaperTradingOrder } from './paper-trading-order.entity';
import { PaperTradingSignal } from './paper-trading-signal.entity';
import { PaperTradingSnapshot } from './paper-trading-snapshot.entity';

import { Algorithm } from '../../../algorithm/algorithm.entity';
import { ExchangeKey } from '../../../exchange/exchange-key/exchange-key.entity';
import { User } from '../../../users/users.entity';
import { ColumnNumericTransformer } from '../../../utils/transformers';

export enum PaperTradingStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  STOPPED = 'STOPPED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

export interface StopConditions {
  maxDrawdown?: number; // Stop if drawdown exceeds (e.g., 0.15 = 15%)
  targetReturn?: number; // Stop if target reached (e.g., 0.20 = 20%)
}

@Entity('paper_trading_sessions')
@Index(['user', 'status'])
@Index(['algorithm'])
@Index(['status'])
export class PaperTradingSession {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique identifier for the paper trading session' })
  id: string;

  @IsString()
  @IsNotEmpty()
  @Column({ length: 255 })
  @ApiProperty({ description: 'Name of the paper trading session' })
  name: string;

  @IsString()
  @IsOptional()
  @Column({ type: 'text', nullable: true })
  @ApiProperty({ description: 'Description of the paper trading session', required: false })
  description?: string;

  @IsEnum(PaperTradingStatus)
  @Column({ type: 'enum', enum: PaperTradingStatus, default: PaperTradingStatus.ACTIVE })
  @ApiProperty({ description: 'Current status of the session', enum: PaperTradingStatus })
  status: PaperTradingStatus;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Initial capital for the paper trading session' })
  initialCapital: number;

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Current portfolio value', required: false })
  currentPortfolioValue?: number;

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Peak portfolio value (for drawdown calculation)', required: false })
  peakPortfolioValue?: number;

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Maximum drawdown percentage', required: false })
  maxDrawdown?: number;

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Total return percentage', required: false })
  totalReturn?: number;

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Sharpe ratio', required: false })
  sharpeRatio?: number;

  @IsNumber()
  @IsOptional()
  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Win rate as decimal (0.0-1.0)', required: false })
  winRate?: number;

  @IsNumber()
  @Column({ type: 'integer', default: 0 })
  @ApiProperty({ description: 'Total number of trades executed', default: 0 })
  totalTrades: number;

  @IsNumber()
  @Column({ type: 'integer', default: 0 })
  @ApiProperty({ description: 'Number of winning trades', default: 0 })
  winningTrades: number;

  @IsNumber()
  @Column({ type: 'integer', default: 0 })
  @ApiProperty({ description: 'Number of losing trades', default: 0 })
  losingTrades: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0.001, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Trading fee percentage (e.g., 0.001 = 0.1%)', default: 0.001 })
  tradingFee: number;

  // Pipeline integration fields (Issue #136)
  @IsString()
  @IsOptional()
  @Column({ type: 'uuid', nullable: true })
  @Index('idx_paper_trading_sessions_pipeline', { where: '"pipelineId" IS NOT NULL' })
  @ApiProperty({
    description: 'FK to Pipeline entity for pipeline integration (nullable for standalone)',
    required: false
  })
  pipelineId?: string;

  @IsString()
  @IsOptional()
  @Column({ type: 'varchar', length: 50, nullable: true })
  @ApiProperty({ description: 'Auto-stop duration (e.g., 7d, 30d, 3m)', required: false })
  duration?: string;

  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({ description: 'Stop conditions: maxDrawdown, targetReturn', required: false })
  stopConditions?: StopConditions;

  @IsString()
  @IsOptional()
  @Column({ type: 'varchar', length: 100, nullable: true })
  @ApiProperty({ description: 'Reason why session stopped', required: false })
  stoppedReason?: string;

  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({ description: 'Algorithm configuration/optimized parameters', required: false })
  algorithmConfig?: Record<string, any>;

  @IsString()
  @IsOptional()
  @Column({ type: 'text', nullable: true })
  @ApiProperty({ description: 'Error message if session failed', required: false })
  errorMessage?: string;

  @IsNumber()
  @Column({ type: 'integer', default: 30000 })
  @ApiProperty({ description: 'Interval between market data ticks in milliseconds', default: 30000 })
  tickIntervalMs: number;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiProperty({ description: 'Timestamp of last tick processed', required: false })
  lastTickAt?: Date;

  @IsNumber()
  @Column({ type: 'integer', default: 0 })
  @ApiProperty({ description: 'Number of ticks processed', default: 0 })
  tickCount: number;

  @IsNumber()
  @Column({ type: 'integer', default: 0 })
  @ApiProperty({ description: 'Count of consecutive errors (for auto-pause)', default: 0 })
  consecutiveErrors: number;

  @CreateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: 'When the session was created' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: 'When the session was last updated' })
  updatedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiProperty({ description: 'When the session was started', required: false })
  startedAt?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiProperty({ description: 'When the session was paused', required: false })
  pausedAt?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiProperty({ description: 'When the session was stopped', required: false })
  stoppedAt?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiProperty({ description: 'When the session completed', required: false })
  completedAt?: Date;

  // Relations
  @ManyToOne('User', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  @ApiProperty({ description: 'User who created the session' })
  user: Relation<User>;

  @ManyToOne('Algorithm', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'algorithmId' })
  @ApiProperty({ description: 'Algorithm used for trading' })
  algorithm: Relation<Algorithm>;

  @ManyToOne('ExchangeKey', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exchangeKeyId' })
  @ApiProperty({ description: 'Exchange key for market data access' })
  exchangeKey: Relation<ExchangeKey>;

  @OneToMany(() => PaperTradingAccount, (account) => account.session, { cascade: true })
  @ApiProperty({ description: 'Virtual account balances', type: () => [PaperTradingAccount] })
  accounts: PaperTradingAccount[];

  @OneToMany(() => PaperTradingOrder, (order) => order.session, { cascade: true })
  @ApiProperty({ description: 'Paper trading orders', type: () => [PaperTradingOrder] })
  orders: PaperTradingOrder[];

  @OneToMany(() => PaperTradingSignal, (signal) => signal.session, { cascade: true })
  @ApiProperty({ description: 'Algorithm signals received', type: () => [PaperTradingSignal] })
  signals: PaperTradingSignal[];

  @OneToMany(() => PaperTradingSnapshot, (snapshot) => snapshot.session, { cascade: true })
  @ApiProperty({ description: 'Portfolio snapshots for charting', type: () => [PaperTradingSnapshot] })
  snapshots: PaperTradingSnapshot[];

  constructor(partial: Partial<PaperTradingSession>) {
    Object.assign(this, partial);
  }
}
