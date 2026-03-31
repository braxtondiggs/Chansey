import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation
} from 'typeorm';

import { LiveTradingSignalAction, SignalReasonCode, SignalSource, SignalStatus } from '@chansey/api-interfaces';

import { StrategyConfig } from './strategy-config.entity';

import { AlgorithmActivation } from '../../algorithm/algorithm-activation.entity';
import { Order } from '../../order/order.entity';
import { User } from '../../users/users.entity';
import { ColumnNumericTransformer } from '../../utils/transformers';

export { LiveTradingSignalAction } from '@chansey/api-interfaces';

@Entity('live_trading_signals')
@Index(['createdAt'])
@Index(['status', 'createdAt'])
@Index(['userId', 'createdAt'])
@Index(['strategyConfigId', 'createdAt'])
@Index(['algorithmActivationId', 'createdAt'])
export class LiveTradingSignal {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique identifier for the live signal outcome' })
  id: string;

  @Column({ type: 'uuid' })
  @ApiProperty({ description: 'User ID associated with the signal outcome' })
  userId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: Relation<User>;

  @Column({ type: 'uuid', nullable: true })
  @ApiPropertyOptional({ description: 'Strategy config ID for robo-advisor live trading signals' })
  strategyConfigId?: string | null;

  @ManyToOne(() => StrategyConfig, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'strategyConfigId' })
  strategyConfig?: Relation<StrategyConfig> | null;

  @Column({ type: 'uuid', nullable: true })
  @ApiPropertyOptional({ description: 'Algorithm activation ID for trade-execution signals' })
  algorithmActivationId?: string | null;

  @ManyToOne(() => AlgorithmActivation, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'algorithmActivationId' })
  algorithmActivation?: Relation<AlgorithmActivation> | null;

  @Column({ type: 'enum', enum: SignalSource, default: SignalSource.LIVE_TRADING })
  @ApiProperty({ description: 'Signal source', enum: SignalSource, default: SignalSource.LIVE_TRADING })
  source: SignalSource;

  @Column({ type: 'enum', enum: LiveTradingSignalAction })
  @ApiProperty({ description: 'Signal action', enum: LiveTradingSignalAction })
  action: LiveTradingSignalAction;

  @Column({ type: 'varchar', length: 50 })
  @ApiProperty({ description: 'Target instrument/symbol for the signal' })
  symbol: string;

  @Column({ type: 'decimal', precision: 25, scale: 8, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Requested trade quantity' })
  quantity: number;

  @Column({ type: 'decimal', precision: 25, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiPropertyOptional({ description: 'Reference price used for the trade decision' })
  price?: number | null;

  @Column({ type: 'decimal', precision: 5, scale: 4, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiPropertyOptional({ description: 'Signal confidence score (0-1)' })
  confidence?: number | null;

  @Column({ type: 'enum', enum: SignalStatus })
  @ApiProperty({ description: 'Final signal outcome status', enum: SignalStatus })
  status: SignalStatus;

  @Column({ type: 'enum', enum: SignalReasonCode, nullable: true })
  @ApiPropertyOptional({
    description: 'Machine-readable reason code for blocks/failures/adjustments',
    enum: SignalReasonCode
  })
  reasonCode?: SignalReasonCode | null;

  @Column({ type: 'text', nullable: true })
  @ApiPropertyOptional({ description: 'Human-readable explanation for the signal outcome' })
  reason?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  @ApiPropertyOptional({ description: 'Additional context about the signal outcome' })
  metadata?: Record<string, unknown> | null;

  @Column({ type: 'uuid', nullable: true })
  @ApiPropertyOptional({ description: 'Order ID created from the signal when applicable' })
  orderId?: string | null;

  @ManyToOne(() => Order, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'orderId' })
  order?: Relation<Order> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: 'When the signal outcome was recorded' })
  createdAt: Date;

  constructor(partial: Partial<LiveTradingSignal>) {
    Object.assign(this, partial);
  }
}
