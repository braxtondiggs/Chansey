import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn
} from 'typeorm';

import { DeploymentStatus } from '@chansey/api-interfaces';

import type { PerformanceMetric } from './performance-metric.entity';
import type { StrategyConfig } from './strategy-config.entity';

/**
 * Deployment Entity
 *
 * Represents a live trading deployment of a strategy.
 * Tracks allocation, status, risk limits, and lifecycle events.
 *
 * Status Workflow:
 * - pending_approval: Awaiting manual approval
 * - active: Currently trading
 * - paused: Temporarily stopped (manual or drift detection)
 * - demoted: Automatically stopped due to performance/risk
 * - terminated: Permanently stopped
 */
@Entity('deployments')
export class Deployment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', comment: 'FK to strategy_configs' })
  strategyConfigId: string;

  @ManyToOne('StrategyConfig', { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'strategyConfigId' })
  strategyConfig: Relation<StrategyConfig>;

  @OneToMany('PerformanceMetric', 'deployment', { cascade: true })
  performanceMetrics: Relation<PerformanceMetric[]>;

  // Deployment Configuration
  @Column({
    type: 'enum',
    enum: DeploymentStatus,
    default: DeploymentStatus.PENDING_APPROVAL,
    comment: 'Current deployment status'
  })
  status: DeploymentStatus;

  @Column({ type: 'decimal', precision: 5, scale: 2, comment: 'Portfolio allocation percentage (1.0 = 1%)' })
  allocationPercent: number;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
    comment: 'Initial allocation when first deployed'
  })
  initialAllocationPercent: number | null;

  @Column({ type: 'timestamptz', nullable: true, comment: 'When deployment went live' })
  deployedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, comment: 'When deployment was terminated/demoted' })
  terminatedAt: Date | null;

  @Column({ type: 'text', nullable: true, comment: 'Reason for termination/demotion' })
  terminationReason: string | null;

  // Risk Limits (from backtest metrics, adjusted for safety margin)
  @Column({ type: 'decimal', precision: 10, scale: 4, comment: 'Maximum allowed drawdown (decimal, 0.40 = 40%)' })
  maxDrawdownLimit: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, comment: 'Daily loss limit (decimal, 0.05 = 5%)' })
  dailyLossLimit: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, comment: 'Position size limit (decimal, 0.10 = 10%)' })
  positionSizeLimit: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 4,
    nullable: true,
    comment: 'Max leverage allowed (e.g., 2.0 = 2x)'
  })
  maxLeverage: number | null;

  // Live Performance Tracking
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0, comment: 'Total realized P&L in USD' })
  realizedPnl: number;

  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0, comment: 'Total unrealized P&L in USD' })
  unrealizedPnl: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, default: 0, comment: 'Current drawdown (decimal)' })
  currentDrawdown: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, default: 0, comment: 'Maximum drawdown observed (decimal)' })
  maxDrawdownObserved: number;

  @Column({ type: 'integer', default: 0, comment: 'Total number of trades executed' })
  totalTrades: number;

  @Column({ type: 'integer', default: 0, comment: 'Number of winning trades' })
  winningTrades: number;

  @Column({ type: 'integer', default: 0, comment: 'Number of losing trades' })
  losingTrades: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true, comment: 'Live Sharpe ratio (annualized)' })
  liveSharpeRatio: number | null;

  // Drift Monitoring
  @Column({ type: 'integer', default: 0, comment: 'Number of drift alerts triggered' })
  driftAlertCount: number;

  @Column({ type: 'timestamptz', nullable: true, comment: 'Last time drift was detected' })
  lastDriftDetectedAt: Date | null;

  @Column({ type: 'jsonb', nullable: true, comment: 'Latest drift metrics snapshot' })
  driftMetrics: Record<string, any> | null;

  // Approval & Audit
  @Column({ type: 'uuid', nullable: true, comment: 'User ID who approved deployment' })
  approvedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true, comment: 'When deployment was approved' })
  approvedAt: Date | null;

  @Column({ type: 'text', nullable: true, comment: 'Reason for deployment/promotion' })
  promotionReason: string | null;

  @Column({ type: 'jsonb', nullable: true, comment: 'Additional deployment metadata' })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  // Computed Properties
  get winRate(): number {
    if (this.totalTrades === 0) return 0;
    return this.winningTrades / this.totalTrades;
  }

  get totalPnl(): number {
    return Number(this.realizedPnl) + Number(this.unrealizedPnl);
  }

  get isActive(): boolean {
    return this.status === DeploymentStatus.ACTIVE;
  }

  get isPaused(): boolean {
    return this.status === DeploymentStatus.PAUSED;
  }

  get isDemoted(): boolean {
    return this.status === DeploymentStatus.DEMOTED;
  }

  get isTerminated(): boolean {
    return this.status === DeploymentStatus.TERMINATED;
  }

  get daysLive(): number | null {
    if (!this.deployedAt) return null;
    const now = new Date();
    const diff = now.getTime() - this.deployedAt.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }
}
