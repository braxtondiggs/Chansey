import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index } from 'typeorm';

import { AuditEventType } from '@chansey/api-interfaces';

import { User } from '../../users/users.entity';

@Entity('audit_logs')
@Index(['entityType', 'entityId', 'timestamp'])
@Index(['eventType', 'timestamp'])
@Index(['correlationId'])
@Index(['timestamp'])
@Index(['userId', 'timestamp'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: AuditEventType,
    comment: 'Type of audit event'
  })
  eventType: AuditEventType;

  @Column({
    type: 'varchar',
    length: 100,
    comment: 'Entity type (strategy, deployment, backtest, etc.)'
  })
  entityType: string;

  @Column({
    type: 'uuid',
    comment: 'ID of affected entity'
  })
  entityId: string;

  @Column({
    type: 'uuid',
    nullable: true,
    comment: 'User who triggered event (nullable for system events)'
  })
  userId?: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user?: User | null;

  @CreateDateColumn({
    type: 'timestamptz',
    comment: 'Event timestamp (immutable)'
  })
  timestamp: Date;

  @Column({
    type: 'jsonb',
    nullable: true,
    comment: 'State before change (JSON, nullable)'
  })
  beforeState?: Record<string, any> | null;

  @Column({
    type: 'jsonb',
    nullable: true,
    comment: 'State after change (JSON, nullable)'
  })
  afterState?: Record<string, any> | null;

  @Column({
    type: 'jsonb',
    nullable: true,
    comment: 'Additional event metadata (JSON)'
  })
  metadata?: Record<string, any> | null;

  @Column({
    type: 'uuid',
    nullable: true,
    comment: 'ID linking related events'
  })
  correlationId?: string | null;

  @Column({
    type: 'varchar',
    length: 64,
    comment: 'SHA-256 hash for tamper detection'
  })
  integrity: string;

  @Column({
    type: 'varchar',
    length: 64,
    nullable: true,
    comment: 'Blockchain-style chain hash linking to previous entry'
  })
  chainHash?: string | null;

  @Column({
    type: 'varchar',
    length: 45,
    nullable: true,
    comment: 'Client IP address (nullable)'
  })
  ipAddress?: string | null;

  @Column({
    type: 'text',
    nullable: true,
    comment: 'Client user agent (nullable)'
  })
  userAgent?: string | null;
}
