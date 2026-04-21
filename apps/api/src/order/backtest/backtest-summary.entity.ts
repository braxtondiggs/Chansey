import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  Relation
} from 'typeorm';

import { Backtest } from './backtest.entity';

import { NUMERIC_TRANSFORMER } from '../../utils/transformers';

/**
 * Bucketed histogram payload stored alongside raw aggregate counters.
 *
 * `buckets` is a list of `[lo, hi, count]` triples. The layout (bucket edges) is
 * frozen by `version`, so consumers MUST validate the version before merging or
 * interpolating. If the layout changes, bump the version and backfill.
 */
export interface SummaryHistogram {
  version: number;
  buckets: Array<[number, number, number]>;
  min: number | null;
  max: number | null;
  count: number;
  sum: number;
}

export interface ConfidenceBucketBreakdown {
  bucket: string;
  signalCount: number;
  wins: number;
  losses: number;
  returnSum: number;
  returnCount: number;
}

export interface SignalOutcomeBucket {
  count: number;
  wins: number;
  losses: number;
  returnSum: number;
  returnCount: number;
}

export interface InstrumentSignalBreakdown {
  instrument: string;
  count: number;
  wins: number;
  losses: number;
  returnSum: number;
  returnCount: number;
}

export interface InstrumentTradeBreakdown {
  instrument: string;
  tradeCount: number;
  sellCount: number;
  wins: number;
  losses: number;
  totalVolume: number;
  totalPnL: number;
  returnSum: number;
  returnCount: number;
}

@Entity('backtest_summaries')
@Index(['computedAt'])
export class BacktestSummary {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  backtestId: string;

  @OneToOne(() => Backtest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'backtestId' })
  backtest: Relation<Backtest>;

  // ---- Signals: plain counters ----

  @Column({ type: 'int', default: 0 })
  totalSignals: number;

  @Column({ type: 'int', default: 0 })
  entryCount: number;

  @Column({ type: 'int', default: 0 })
  exitCount: number;

  @Column({ type: 'int', default: 0 })
  adjustmentCount: number;

  @Column({ type: 'int', default: 0 })
  riskControlCount: number;

  @Column({ type: 'decimal', precision: 6, scale: 4, nullable: true, transformer: NUMERIC_TRANSFORMER })
  avgConfidence: number | null;

  @Column({ type: 'decimal', precision: 25, scale: 8, default: 0, transformer: NUMERIC_TRANSFORMER })
  confidenceSum: number;

  @Column({ type: 'int', default: 0 })
  confidenceCount: number;

  // ---- Trades: plain counters ----

  @Column({ type: 'int', default: 0 })
  totalTrades: number;

  @Column({ type: 'int', default: 0 })
  buyCount: number;

  @Column({ type: 'int', default: 0 })
  sellCount: number;

  @Column({ type: 'decimal', precision: 25, scale: 8, default: 0, transformer: NUMERIC_TRANSFORMER })
  totalVolume: number;

  @Column({ type: 'decimal', precision: 25, scale: 8, default: 0, transformer: NUMERIC_TRANSFORMER })
  totalFees: number;

  // ---- Profitability ----

  @Column({ type: 'int', default: 0 })
  winCount: number;

  @Column({ type: 'int', default: 0 })
  lossCount: number;

  @Column({ type: 'decimal', precision: 25, scale: 8, default: 0, transformer: NUMERIC_TRANSFORMER })
  grossProfit: number;

  @Column({ type: 'decimal', precision: 25, scale: 8, default: 0, transformer: NUMERIC_TRANSFORMER })
  grossLoss: number;

  @Column({ type: 'decimal', precision: 25, scale: 8, nullable: true, transformer: NUMERIC_TRANSFORMER })
  largestWin: number | null;

  @Column({ type: 'decimal', precision: 25, scale: 8, nullable: true, transformer: NUMERIC_TRANSFORMER })
  largestLoss: number | null;

  @Column({ type: 'decimal', precision: 25, scale: 8, nullable: true, transformer: NUMERIC_TRANSFORMER })
  avgWin: number | null;

  @Column({ type: 'decimal', precision: 25, scale: 8, nullable: true, transformer: NUMERIC_TRANSFORMER })
  avgLoss: number | null;

  @Column({ type: 'decimal', precision: 25, scale: 8, nullable: true, transformer: NUMERIC_TRANSFORMER })
  totalRealizedPnL: number | null;

  // ---- Hold time (ms) ----

  @Column({ type: 'bigint', nullable: true })
  holdTimeMinMs: string | null;

  @Column({ type: 'bigint', nullable: true })
  holdTimeMaxMs: string | null;

  @Column({ type: 'bigint', nullable: true })
  holdTimeAvgMs: string | null;

  @Column({ type: 'bigint', nullable: true })
  holdTimeMedianMs: string | null;

  @Column({ type: 'int', default: 0 })
  holdTimeCount: number;

  // ---- Slippage (bps) ----

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true, transformer: NUMERIC_TRANSFORMER })
  slippageAvgBps: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true, transformer: NUMERIC_TRANSFORMER })
  slippageMaxBps: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true, transformer: NUMERIC_TRANSFORMER })
  slippageP95Bps: number | null;

  @Column({ type: 'decimal', precision: 25, scale: 8, default: 0, transformer: NUMERIC_TRANSFORMER })
  slippageTotalImpact: number;

  @Column({ type: 'int', default: 0 })
  slippageFillCount: number;

  // ---- JSONB breakdowns (raw counters for exact merge) ----

  @Column({ type: 'jsonb', nullable: true })
  holdTimeHistogram: SummaryHistogram | null;

  @Column({ type: 'jsonb', nullable: true })
  slippageHistogram: SummaryHistogram | null;

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  signalsByConfidenceBucket: ConfidenceBucketBreakdown[];

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  signalsByType: Record<string, SignalOutcomeBucket>;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  signalsByDirection: Record<string, SignalOutcomeBucket>;

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  signalsByInstrument: InstrumentSignalBreakdown[];

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  tradesByInstrument: InstrumentTradeBreakdown[];

  @Column({ type: 'timestamptz' })
  computedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  constructor(partial: Partial<BacktestSummary> = {}) {
    Object.assign(this, partial);
  }
}
