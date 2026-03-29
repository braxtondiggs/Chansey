import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation } from 'typeorm';

import type { ExchangeKeyErrorCategory, ExchangeKeyHealthStatus } from '@chansey/api-interfaces';

import { ExchangeKey } from './exchange-key.entity';

@Entity()
export class ExchangeKeyHealthLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ExchangeKey, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exchangeKeyId' })
  exchangeKey: Relation<ExchangeKey>;

  @Column({ type: 'uuid' })
  exchangeKeyId: string;

  @Column({ type: 'varchar', length: 20 })
  status: ExchangeKeyHealthStatus;

  @Column({ type: 'varchar', length: 30, nullable: true })
  errorCategory: ExchangeKeyErrorCategory | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'int', nullable: true })
  responseTimeMs: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  checkedAt: Date;
}
