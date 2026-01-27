import { ApiProperty } from '@nestjs/swagger';

import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn
} from 'typeorm';

import { ExchangeKey } from '../../exchange/exchange-key/exchange-key.entity';
import { OptimizationRun } from '../../optimization/entities/optimization-run.entity';
import { Backtest } from '../../order/backtest/backtest.entity';
import { PaperTradingSession } from '../../order/paper-trading/entities/paper-trading-session.entity';
import { StrategyConfig } from '../../strategy/entities/strategy-config.entity';
import { User } from '../../users/users.entity';
import {
  DeploymentRecommendation,
  PipelineProgressionRules,
  PipelineStage,
  PipelineStageConfig,
  PipelineStageResults,
  PipelineStatus,
  PipelineSummaryReport
} from '../interfaces';

@Entity('pipelines')
@Index(['user', 'status'])
@Index(['strategyConfigId'])
@Index(['status'])
@Index(['currentStage'])
@Index(['createdAt'])
export class Pipeline {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique identifier for the pipeline' })
  id: string;

  @IsString()
  @IsNotEmpty()
  @Column({ length: 255 })
  @ApiProperty({ description: 'Name of the pipeline' })
  name: string;

  @IsString()
  @IsOptional()
  @Column({ type: 'text', nullable: true })
  @ApiProperty({ description: 'Description of the pipeline', required: false })
  description?: string;

  @IsEnum(PipelineStatus)
  @Column({ type: 'enum', enum: PipelineStatus, default: PipelineStatus.PENDING })
  @ApiProperty({ description: 'Current status of the pipeline', enum: PipelineStatus })
  status: PipelineStatus;

  @IsEnum(PipelineStage)
  @Column({ type: 'enum', enum: PipelineStage, default: PipelineStage.OPTIMIZE })
  @ApiProperty({ description: 'Current stage in the pipeline', enum: PipelineStage })
  currentStage: PipelineStage;

  @IsUUID()
  @Column({ type: 'uuid' })
  @ApiProperty({ description: 'Strategy configuration being evaluated' })
  strategyConfigId: string;

  @ManyToOne(() => StrategyConfig, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'strategyConfigId' })
  @ApiProperty({ description: 'Strategy configuration entity' })
  strategyConfig: StrategyConfig;

  @IsUUID()
  @Column({ type: 'uuid' })
  @ApiProperty({ description: 'Exchange key for live replay and paper trading' })
  exchangeKeyId: string;

  @ManyToOne(() => ExchangeKey, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exchangeKeyId' })
  @ApiProperty({ description: 'Exchange key entity' })
  exchangeKey: Relation<ExchangeKey>;

  @IsUUID()
  @IsOptional()
  @Column({ type: 'uuid', nullable: true })
  @Index('idx_pipelines_optimization_run', { where: '"optimizationRunId" IS NOT NULL' })
  @ApiProperty({ description: 'Link to optimization run', required: false })
  optimizationRunId?: string;

  @ManyToOne(() => OptimizationRun, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'optimizationRunId' })
  @ApiProperty({ description: 'Optimization run entity', required: false })
  optimizationRun?: OptimizationRun;

  @IsUUID()
  @IsOptional()
  @Column({ type: 'uuid', nullable: true })
  @Index('idx_pipelines_historical_backtest', { where: '"historicalBacktestId" IS NOT NULL' })
  @ApiProperty({ description: 'Link to historical backtest', required: false })
  historicalBacktestId?: string;

  @ManyToOne(() => Backtest, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'historicalBacktestId' })
  @ApiProperty({ description: 'Historical backtest entity', required: false })
  historicalBacktest?: Backtest;

  @IsUUID()
  @IsOptional()
  @Column({ type: 'uuid', nullable: true })
  @Index('idx_pipelines_live_replay_backtest', { where: '"liveReplayBacktestId" IS NOT NULL' })
  @ApiProperty({ description: 'Link to live replay backtest', required: false })
  liveReplayBacktestId?: string;

  @ManyToOne(() => Backtest, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'liveReplayBacktestId' })
  @ApiProperty({ description: 'Live replay backtest entity', required: false })
  liveReplayBacktest?: Backtest;

  @IsUUID()
  @IsOptional()
  @Column({ type: 'uuid', nullable: true })
  @Index('idx_pipelines_paper_trading', { where: '"paperTradingSessionId" IS NOT NULL' })
  @ApiProperty({ description: 'Link to paper trading session', required: false })
  paperTradingSessionId?: string;

  @ManyToOne(() => PaperTradingSession, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'paperTradingSessionId' })
  @ApiProperty({ description: 'Paper trading session entity', required: false })
  paperTradingSession?: PaperTradingSession;

  @Column({ type: 'jsonb' })
  @ApiProperty({ description: 'Configuration for each pipeline stage' })
  stageConfig: PipelineStageConfig;

  @Column({ type: 'jsonb' })
  @ApiProperty({ description: 'Metric thresholds for stage progression' })
  progressionRules: PipelineProgressionRules;

  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({ description: 'Best parameters from optimization stage', required: false })
  optimizedParameters?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({ description: 'Results from each completed stage', required: false })
  stageResults?: PipelineStageResults;

  @IsEnum(DeploymentRecommendation)
  @IsOptional()
  @Column({ type: 'enum', enum: DeploymentRecommendation, nullable: true })
  @ApiProperty({ description: 'Final deployment recommendation', enum: DeploymentRecommendation, required: false })
  recommendation?: DeploymentRecommendation;

  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({ description: 'Comprehensive final summary report', required: false })
  summaryReport?: PipelineSummaryReport;

  @IsString()
  @IsOptional()
  @Column({ type: 'text', nullable: true })
  @ApiProperty({ description: 'Reason for failure if status is FAILED', required: false })
  failureReason?: string;

  @CreateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: 'When the pipeline was created' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: 'When the pipeline was last updated' })
  updatedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiProperty({ description: 'When the pipeline was started', required: false })
  startedAt?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiProperty({ description: 'When the pipeline completed', required: false })
  completedAt?: Date;

  // Relations
  @ManyToOne('User', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  @ApiProperty({ description: 'User who created the pipeline' })
  user: Relation<User>;

  constructor(partial: Partial<Pipeline>) {
    Object.assign(this, partial);
  }
}
