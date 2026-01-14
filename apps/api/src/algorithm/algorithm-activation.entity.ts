import { ApiProperty } from '@nestjs/swagger';

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

import type { Algorithm } from './algorithm.entity';
import { AlgorithmConfig } from './algorithm.entity';

import type { ExchangeKey } from '../exchange/exchange-key/exchange-key.entity';
import type { User } from '../users/users.entity';

/**
 * AlgorithmActivation Entity
 *
 * Represents user-specific algorithm activation state and configuration.
 * Junction table between User and Algorithm with activation metadata.
 */
@Entity('algorithm_activations')
@Index(['userId', 'algorithmId'], { unique: true }) // User can activate algorithm once
@Index(['userId', 'isActive']) // Query active algorithms
@Index(['exchangeKeyId']) // Query by exchange
export class AlgorithmActivation {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique identifier for the algorithm activation',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @Column({ type: 'uuid' })
  @ApiProperty({
    description: 'User ID who activated the algorithm',
    example: 'b4cc289e-9cf0-4999-0013-bdf5f7654113'
  })
  userId: string;

  @ManyToOne('User', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  @ApiProperty({
    description: 'User who activated the algorithm'
  })
  user: Relation<User>;

  @Column({ type: 'uuid' })
  @ApiProperty({
    description: 'Algorithm ID that is activated',
    example: 'c5dd390f-0dg1-5000-1124-ceg6g8765224'
  })
  algorithmId: string;

  @ManyToOne('Algorithm', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'algorithmId' })
  @ApiProperty({
    description: 'Algorithm that is activated'
  })
  algorithm: Relation<Algorithm>;

  @Column({ type: 'uuid' })
  @ApiProperty({
    description: 'Exchange key ID to use for trading',
    example: 'd6ee401g-1eh2-6111-2235-dfh7h9876335'
  })
  exchangeKeyId: string;

  @ManyToOne('ExchangeKey', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exchangeKeyId' })
  @ApiProperty({
    description: 'Exchange key to use for trading'
  })
  exchangeKey: Relation<ExchangeKey>;

  @Column({ type: 'boolean', default: false })
  @ApiProperty({
    description: 'Whether the algorithm is currently active',
    example: true
  })
  isActive: boolean;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 1.0 })
  @ApiProperty({
    description: 'Percentage of portfolio per trade (dynamically adjusted by ranking)',
    example: 1.5,
    minimum: 0.01,
    maximum: 100.0
  })
  allocationPercentage: number;

  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({
    description: 'User-specific algorithm configuration overrides',
    example: {
      parameters: {
        period: 20,
        multiplier: 2.0
      }
    },
    required: false
  })
  config?: AlgorithmConfig;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiProperty({
    description: 'Timestamp when the algorithm was activated',
    example: '2025-09-30T12:00:00Z',
    required: false
  })
  activatedAt?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiProperty({
    description: 'Timestamp when the algorithm was deactivated',
    example: '2025-09-30T14:30:00Z',
    required: false
  })
  deactivatedAt?: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  @ApiProperty({
    description: 'Date when the activation record was created',
    example: '2025-09-30T12:00:00Z'
  })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  @ApiProperty({
    description: 'Date when the activation record was last updated',
    example: '2025-09-30T12:00:00Z'
  })
  updatedAt: Date;

  constructor(partial: Partial<AlgorithmActivation>) {
    Object.assign(this, partial);
  }

  /**
   * Activate the algorithm
   */
  activate(): void {
    this.isActive = true;
    this.activatedAt = new Date();
    this.deactivatedAt = null;
  }

  /**
   * Deactivate the algorithm
   */
  deactivate(): void {
    this.isActive = false;
    this.deactivatedAt = new Date();
  }

  /**
   * Update allocation percentage based on performance ranking
   */
  updateAllocation(percentage: number): void {
    if (percentage < 0.01 || percentage > 100.0) {
      throw new Error('Allocation percentage must be between 0.01 and 100.00');
    }
    this.allocationPercentage = percentage;
  }
}
