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

import { PaperTradingSession } from './paper-trading-session.entity';

import { NUMERIC_TRANSFORMER } from '../../../utils/transformers';

export interface PaperTradingSymbolBreakdown {
  symbol: string;
  orderCount: number;
  totalVolume: number;
  totalPnL: number;
}

@Entity('paper_trading_session_summaries')
@Index(['computedAt'])
export class PaperTradingSessionSummary {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  sessionId: string;

  @OneToOne(() => PaperTradingSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session: Relation<PaperTradingSession>;

  @Column({ type: 'int', default: 0 })
  totalOrders: number;

  @Column({ type: 'int', default: 0 })
  buyCount: number;

  @Column({ type: 'int', default: 0 })
  sellCount: number;

  @Column({ type: 'decimal', precision: 25, scale: 8, default: 0, transformer: NUMERIC_TRANSFORMER })
  totalVolume: number;

  @Column({ type: 'decimal', precision: 25, scale: 8, default: 0, transformer: NUMERIC_TRANSFORMER })
  totalFees: number;

  @Column({ type: 'decimal', precision: 25, scale: 8, default: 0, transformer: NUMERIC_TRANSFORMER })
  totalPnL: number;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true, transformer: NUMERIC_TRANSFORMER })
  avgSlippageBps: number | null;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0, transformer: NUMERIC_TRANSFORMER })
  slippageSumBps: number;

  @Column({ type: 'int', default: 0 })
  slippageCount: number;

  @Column({ type: 'int', default: 0 })
  totalSignals: number;

  @Column({ type: 'int', default: 0 })
  processedCount: number;

  @Column({ type: 'decimal', precision: 25, scale: 8, default: 0, transformer: NUMERIC_TRANSFORMER })
  confidenceSum: number;

  @Column({ type: 'int', default: 0 })
  confidenceCount: number;

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  ordersBySymbol: PaperTradingSymbolBreakdown[];

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  signalsByType: Record<string, number>;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  signalsByDirection: Record<string, number>;

  @Column({ type: 'timestamptz' })
  computedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  constructor(partial: Partial<PaperTradingSessionSummary> = {}) {
    Object.assign(this, partial);
  }
}
