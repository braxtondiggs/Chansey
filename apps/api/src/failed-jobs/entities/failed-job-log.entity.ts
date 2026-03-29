import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from '../../users/users.entity';

export enum FailedJobStatus {
  PENDING = 'pending',
  REVIEWED = 'reviewed',
  RETRIED = 'retried',
  DISMISSED = 'dismissed'
}

export enum FailedJobSeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low'
}

@Entity('failed_job_logs')
@Index(['queueName', 'createdAt'])
@Index(['status', 'createdAt'])
@Index(['severity', 'createdAt'])
@Index(['userId', 'createdAt'])
export class FailedJobLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  queueName: string;

  @Column({ type: 'varchar', length: 255 })
  jobId: string;

  @Column({ type: 'varchar', length: 255 })
  jobName: string;

  @Column({ type: 'jsonb', nullable: true })
  jobData?: Record<string, any> | null;

  @Column({ type: 'text' })
  errorMessage: string;

  @Column({ type: 'text', nullable: true })
  stackTrace?: string | null;

  @Column({ type: 'int', default: 0 })
  attemptsMade: number;

  @Column({ type: 'int', default: 0 })
  maxAttempts: number;

  @Column({ type: 'uuid', nullable: true })
  userId?: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user?: User | null;

  @Column({ type: 'enum', enum: FailedJobStatus, default: FailedJobStatus.PENDING })
  status: FailedJobStatus;

  @Column({ type: 'enum', enum: FailedJobSeverity, default: FailedJobSeverity.LOW })
  severity: FailedJobSeverity;

  @Column({ type: 'text', nullable: true })
  adminNotes?: string | null;

  @Column({ type: 'uuid', nullable: true })
  reviewedBy?: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reviewedBy' })
  reviewer?: User | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt?: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  context?: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
