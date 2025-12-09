import { Column, Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index, CreateDateColumn } from 'typeorm';

import { MarketRegimeType, MarketRegimeMetadata } from '@chansey/api-interfaces';

/**
 * MarketRegime entity
 * Tracks detected market regimes based on volatility percentiles
 */
@Entity('market_regimes')
@Index(['asset', 'detectedAt'])
@Index(['regime', 'detectedAt'])
@Index(['asset', 'effectiveUntil'], { where: '"effective_until" IS NULL' })
export class MarketRegime {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'varchar',
    length: 20,
    comment: 'Asset symbol (BTC, ETH, etc.)'
  })
  asset: string;

  @Column({
    type: 'enum',
    enum: MarketRegimeType,
    comment: 'Regime classification based on volatility percentiles'
  })
  regime: MarketRegimeType;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 6,
    comment: 'Realized volatility value'
  })
  volatility: number;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    comment: 'Volatility percentile (0-100)'
  })
  percentile: number;

  @CreateDateColumn({
    type: 'timestamptz'
  })
  detectedAt: Date;

  @Column({
    name: 'effective_until',
    type: 'timestamptz',
    nullable: true,
    comment: 'End of regime period (nullable for current regime)'
  })
  effectiveUntil?: Date | null;

  @Column({
    type: 'uuid',
    nullable: true,
    comment: 'Reference to previous regime (nullable for first regime)'
  })
  previousRegimeId?: string | null;

  @ManyToOne(() => MarketRegime, { nullable: true })
  @JoinColumn({ name: 'previousRegimeId' })
  previousRegime?: MarketRegime | null;

  @Column({
    type: 'jsonb',
    nullable: true,
    comment: 'Additional regime detection metadata'
  })
  metadata?: MarketRegimeMetadata;
}
