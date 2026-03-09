import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn
} from 'typeorm';

import { User } from '../../users/users.entity';

@Entity('push_subscription')
export class PushSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('User', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: Relation<User>;

  @Column()
  userId: string;

  @Column({ type: 'text', unique: true })
  endpoint: string;

  @Column({ type: 'text' })
  p256dh: string;

  @Column({ type: 'text' })
  auth: string;

  @Column({ type: 'varchar', nullable: true })
  userAgent: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  constructor(partial?: Partial<PushSubscription>) {
    if (partial) Object.assign(this, partial);
  }
}
