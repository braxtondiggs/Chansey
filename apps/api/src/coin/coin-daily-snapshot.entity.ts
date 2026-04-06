import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  Unique
} from 'typeorm';

import { Coin } from './coin.entity';

import { ColumnNumericTransformer } from '../utils/transformers';

@Entity('coin_daily_snapshots')
@Unique(['coinId', 'snapshotDate'])
@Index(['snapshotDate'])
export class CoinDailySnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Coin, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'coinId' })
  coin: Relation<Coin>;

  @Column({ type: 'uuid' })
  coinId: string;

  @Column({ type: 'date' })
  snapshotDate: string; // YYYY-MM-DD — TypeORM returns DATE columns as strings

  @Column({ type: 'decimal', precision: 38, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  marketCap: number | null;

  @Column({ type: 'decimal', precision: 38, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  totalVolume: number | null;

  @Column({ type: 'decimal', precision: 25, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  currentPrice: number | null;

  @Column({ type: 'decimal', precision: 38, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  circulatingSupply: number | null;

  @Column({ type: 'int', nullable: true })
  marketRank: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
