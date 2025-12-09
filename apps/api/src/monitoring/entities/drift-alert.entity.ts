import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { Deployment } from '../../strategy/entities/deployment.entity';

/**
 * DriftAlert Entity
 *
 * Records detected performance drift instances for deployed strategies.
 *
 * Drift occurs when live performance significantly deviates from backtest
 * expectations across key metrics (Sharpe, returns, drawdown, win rate, volatility).
 *
 * Alerts trigger notifications and may lead to automatic demotion if severe.
 */
@Entity('drift_alerts')
@Index(['deploymentId', 'createdAt'])
@Index(['severity'])
@Index(['resolved'])
export class DriftAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', comment: 'FK to deployments' })
  deploymentId: string;

  @ManyToOne(() => Deployment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deploymentId' })
  deployment: Deployment;

  // Alert Classification
  @Column({
    type: 'varchar',
    length: 50,
    comment: 'Type of drift detected (sharpe, return, drawdown, winrate, volatility, correlation)'
  })
  driftType: string;

  @Column({
    type: 'varchar',
    length: 20,
    comment: 'Severity level (low, medium, high, critical)'
  })
  severity: 'low' | 'medium' | 'high' | 'critical';

  // Drift Metrics
  @Column({ type: 'decimal', precision: 10, scale: 4, comment: 'Expected value from backtest' })
  expectedValue: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, comment: 'Actual observed value' })
  actualValue: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, comment: 'Percentage deviation from expected' })
  deviationPercent: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, comment: 'Threshold that triggered this alert' })
  threshold: number;

  // Context
  @Column({ type: 'text', comment: 'Human-readable description of the drift' })
  message: string;

  @Column({ type: 'jsonb', nullable: true, comment: 'Additional drift analysis data' })
  metadata: Record<string, any> | null;

  // Resolution
  @Column({ type: 'boolean', default: false, comment: 'Whether this alert has been resolved' })
  resolved: boolean;

  @Column({ type: 'timestamptz', nullable: true, comment: 'When alert was resolved' })
  resolvedAt: Date | null;

  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: 'How alert was resolved (manual, auto-demotion, ignored)'
  })
  resolutionType: string | null;

  @Column({ type: 'text', nullable: true, comment: 'Notes about resolution' })
  resolutionNotes: string | null;

  // Timestamps
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  // Computed Properties
  get isActive(): boolean {
    return !this.resolved;
  }

  get isCritical(): boolean {
    return this.severity === 'critical';
  }

  get daysOpen(): number {
    const now = new Date();
    const created = new Date(this.createdAt);
    const diff = now.getTime() - created.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }
}
