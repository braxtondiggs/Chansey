import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * TradingState Entity
 *
 * Singleton-pattern entity that stores the global trading state.
 * Only one row should exist in this table (enforced by application logic).
 *
 * This is the authoritative source for whether the system should execute trades.
 * State persists across server restarts.
 */
@Entity('trading_state')
export class TradingState {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'boolean',
    default: true,
    comment: 'Whether trading is currently enabled system-wide'
  })
  tradingEnabled: boolean;

  @Column({
    type: 'timestamptz',
    nullable: true,
    comment: 'When trading was last halted'
  })
  haltedAt: Date | null;

  @Column({
    type: 'uuid',
    nullable: true,
    comment: 'User ID who halted trading'
  })
  haltedBy: string | null;

  @Column({
    type: 'text',
    nullable: true,
    comment: 'Reason for halting trading'
  })
  haltReason: string | null;

  @Column({
    type: 'timestamptz',
    nullable: true,
    comment: 'When trading was last resumed'
  })
  resumedAt: Date | null;

  @Column({
    type: 'uuid',
    nullable: true,
    comment: 'User ID who resumed trading'
  })
  resumedBy: string | null;

  @Column({
    type: 'text',
    nullable: true,
    comment: 'Reason/notes for resuming trading'
  })
  resumeReason: string | null;

  @Column({
    type: 'integer',
    default: 0,
    comment: 'Count of times trading has been halted'
  })
  haltCount: number;

  @Column({
    type: 'jsonb',
    nullable: true,
    comment: 'Additional metadata (source, circuit breaker trigger, etc.)'
  })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  // Computed properties
  get isHalted(): boolean {
    return !this.tradingEnabled;
  }

  get haltDuration(): number | null {
    if (!this.haltedAt || this.tradingEnabled) return null;
    return Date.now() - this.haltedAt.getTime();
  }
}
