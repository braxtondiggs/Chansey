import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn
} from 'typeorm';

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getEffectiveCalculationRisk,
  NotificationPreferences,
  Role
} from '@chansey/api-interfaces';

import type { CoinSelection } from '../coin-selection/coin-selection.entity';
import {
  DEFAULT_OPPORTUNITY_SELLING_CONFIG,
  OpportunitySellingUserConfig
} from '../order/interfaces/opportunity-selling.interface';
import type { Order } from '../order/order.entity';
import type { Risk } from '../risk/risk.entity';

@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  given_name: string;

  @Column()
  family_name: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  middle_name?: string;

  @Column({ nullable: true })
  nickname?: string;

  @Column({ nullable: true })
  birthdate?: string;

  @Column({ nullable: true })
  gender?: string;

  @Column({ nullable: true })
  phone_number?: string;

  @Column({ nullable: true })
  picture?: string;

  // Native Authentication Fields
  @Column({ nullable: true, select: false })
  @Exclude()
  passwordHash?: string;

  @Column({ default: false })
  emailVerified: boolean;

  @Column({ type: 'varchar', nullable: true, select: false })
  @Exclude()
  emailVerificationToken!: string | null;

  @Column({ type: 'timestamptz', nullable: true, select: false })
  @Exclude()
  emailVerificationTokenExpiresAt!: Date | null;

  // OTP/2FA Fields
  @Column({ type: 'varchar', nullable: true, select: false })
  @Exclude()
  otpHash!: string | null;

  @Column({ type: 'timestamptz', nullable: true, select: false })
  @Exclude()
  otpExpiresAt!: Date | null;

  @Column({ default: false })
  otpEnabled: boolean;

  @Column({ default: 0 })
  otpFailedAttempts: number;

  // Password Reset Fields
  @Column({ type: 'varchar', nullable: true, select: false })
  @Exclude()
  passwordResetToken!: string | null;

  @Column({ type: 'timestamptz', nullable: true, select: false })
  @Exclude()
  passwordResetTokenExpiresAt!: Date | null;

  @Column({
    type: 'enum',
    enum: Role,
    array: true,
    default: [Role.USER]
  })
  roles: Role[];

  // Account Security
  @Column({ default: 0 })
  failedLoginAttempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  @Column({ default: false })
  hide_balance: boolean;

  // Algorithmic trading enrollment
  @Column({ default: false })
  algoTradingEnabled: boolean;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 25,
    comment: 'Percentage of free balance allocated to algo trading (e.g., 25.50 = 25.5%)'
  })
  algoCapitalAllocationPercentage: number;

  @Column({ type: 'timestamptz', nullable: true })
  algoEnrolledAt?: Date;

  // Futures trading opt-in
  @Column({ default: false })
  futuresEnabled: boolean;

  // Opportunity selling settings
  @Column({ default: false })
  enableOpportunitySelling: boolean;

  @Column({ type: 'jsonb', default: () => `'${JSON.stringify(DEFAULT_OPPORTUNITY_SELLING_CONFIG)}'` })
  opportunitySellingConfig: OpportunitySellingUserConfig;

  // Notification preferences
  @Column({ type: 'jsonb', default: () => `'${JSON.stringify(DEFAULT_NOTIFICATION_PREFERENCES)}'` })
  notificationPreferences: NotificationPreferences;

  @CreateDateColumn({ select: false, type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ select: false, type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany('CoinSelection', 'user', {
    cascade: true
  })
  coinSelections: Relation<CoinSelection[]>;

  @OneToMany('Order', 'user', { cascade: true })
  orders: Relation<Order[]>;

  @ManyToOne('Risk', 'users', {
    eager: true
  })
  @JoinColumn({ name: 'coin_risk' })
  coinRisk: Relation<Risk>;

  @Column({
    type: 'smallint',
    nullable: true,
    comment: 'Independent trading style level (1-5)'
  })
  calculationRiskLevel: number | null;

  get effectiveCalculationRiskLevel(): number {
    return getEffectiveCalculationRisk(this.coinRisk?.level, this.calculationRiskLevel);
  }

  constructor(partial: Partial<User>) {
    Object.assign(this, partial);
  }
}
