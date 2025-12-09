import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Index } from 'typeorm';

import { Deployment } from './deployment.entity';

/**
 * PerformanceMetric Entity
 *
 * Daily performance snapshot for deployed strategies.
 * Used for drift detection, reporting, and historical analysis.
 *
 * Records are created at end-of-day or when significant events occur.
 * Enables time-series analysis of strategy performance in production.
 */
@Entity('performance_metrics')
@Index(['deploymentId', 'date'], { unique: true }) // One record per deployment per day
@Index(['date']) // For time-range queries
export class PerformanceMetric {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', comment: 'FK to deployments' })
  deploymentId: string;

  @ManyToOne(() => Deployment, (deployment) => deployment.performanceMetrics, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deploymentId' })
  deployment: Deployment;

  // Time Period
  @Column({ type: 'date', comment: 'Date for this metric snapshot (YYYY-MM-DD)' })
  date: string;

  @Column({ type: 'timestamptz', comment: 'Exact timestamp when snapshot was taken' })
  snapshotAt: Date;

  // Daily Performance
  @Column({ type: 'decimal', precision: 15, scale: 4, comment: 'Daily P&L in USD' })
  dailyPnl: number;

  @Column({ type: 'decimal', precision: 10, scale: 6, comment: 'Daily return (decimal, 0.01 = 1%)' })
  dailyReturn: number;

  @Column({ type: 'decimal', precision: 15, scale: 4, comment: 'Cumulative P&L in USD since deployment' })
  cumulativePnl: number;

  @Column({ type: 'decimal', precision: 10, scale: 6, comment: 'Cumulative return (decimal)' })
  cumulativeReturn: number;

  // Risk Metrics
  @Column({ type: 'decimal', precision: 10, scale: 6, comment: 'Current drawdown (decimal)' })
  drawdown: number;

  @Column({ type: 'decimal', precision: 10, scale: 6, comment: 'Max drawdown since deployment (decimal)' })
  maxDrawdown: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 6,
    nullable: true,
    comment: 'Daily volatility (decimal, annualized)'
  })
  volatility: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true, comment: 'Sharpe ratio (annualized)' })
  sharpeRatio: number | null;

  // Trade Statistics
  @Column({ type: 'integer', default: 0, comment: 'Number of trades executed today' })
  tradesCount: number;

  @Column({ type: 'integer', default: 0, comment: 'Cumulative trades since deployment' })
  cumulativeTradesCount: number;

  @Column({ type: 'integer', default: 0, comment: 'Winning trades today' })
  winningTrades: number;

  @Column({ type: 'integer', default: 0, comment: 'Losing trades today' })
  losingTrades: number;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true, comment: 'Win rate for this period (decimal)' })
  winRate: number | null;

  @Column({ type: 'decimal', precision: 15, scale: 4, nullable: true, comment: 'Average winning trade amount (USD)' })
  avgWinAmount: number | null;

  @Column({ type: 'decimal', precision: 15, scale: 4, nullable: true, comment: 'Average losing trade amount (USD)' })
  avgLossAmount: number | null;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 4,
    nullable: true,
    comment: 'Profit factor (gross profit / gross loss)'
  })
  profitFactor: number | null;

  // Position Information
  @Column({ type: 'integer', default: 0, comment: 'Number of open positions' })
  openPositions: number;

  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0, comment: 'Total value of open positions (USD)' })
  exposureAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 6, default: 0, comment: 'Portfolio utilization (decimal, 0-1)' })
  utilization: number;

  // Benchmark Comparison (optional)
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 6,
    nullable: true,
    comment: 'Benchmark return for comparison (e.g., BTC)'
  })
  benchmarkReturn: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true, comment: 'Alpha vs benchmark (decimal)' })
  alpha: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true, comment: 'Beta vs benchmark' })
  beta: number | null;

  // Drift Detection Flags
  @Column({ type: 'boolean', default: false, comment: 'Whether drift was detected on this date' })
  driftDetected: boolean;

  @Column({ type: 'jsonb', nullable: true, comment: 'Drift detection details if applicable' })
  driftDetails: Record<string, any> | null;

  // Market Context
  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: 'Market regime on this date (LOW/NORMAL/HIGH/EXTREME)'
  })
  marketRegime: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true, comment: 'Market volatility percentile' })
  marketVolatilityPercentile: number | null;

  // Additional Metadata
  @Column({ type: 'jsonb', nullable: true, comment: 'Additional metric details' })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  // Computed Properties
  get returnPercent(): number {
    return Number(this.dailyReturn) * 100;
  }

  get cumulativeReturnPercent(): number {
    return Number(this.cumulativeReturn) * 100;
  }

  get drawdownPercent(): number {
    return Number(this.drawdown) * 100;
  }

  get isProfitable(): boolean {
    return Number(this.dailyPnl) > 0;
  }

  get isLoss(): boolean {
    return Number(this.dailyPnl) < 0;
  }
}
