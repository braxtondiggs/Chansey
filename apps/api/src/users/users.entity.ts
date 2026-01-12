import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn
} from 'typeorm';

import { ExchangeKey } from '../exchange/exchange-key/exchange-key.entity';
import { Order } from '../order/order.entity';
import { Portfolio } from '../portfolio/portfolio.entity';
import { Risk } from '../risk/risk.entity';

@Entity()
export class User {
  @PrimaryColumn({ unique: true })
  id: string;

  @Column()
  given_name: string;

  @Column()
  family_name: string;

  @Column()
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

  @Column({ nullable: true, select: false })
  @Exclude()
  emailVerificationToken?: string;

  @Column({ type: 'timestamptz', nullable: true, select: false })
  @Exclude()
  emailVerificationTokenExpiresAt?: Date;

  // OTP/2FA Fields
  @Column({ nullable: true, select: false })
  @Exclude()
  otpHash?: string;

  @Column({ type: 'timestamptz', nullable: true, select: false })
  @Exclude()
  otpExpiresAt?: Date;

  @Column({ default: false })
  otpEnabled: boolean;

  @Column({ default: 0 })
  otpFailedAttempts: number;

  // Password Reset Fields
  @Column({ nullable: true, select: false })
  @Exclude()
  passwordResetToken?: string;

  @Column({ type: 'timestamptz', nullable: true, select: false })
  @Exclude()
  passwordResetTokenExpiresAt?: Date;

  // Roles (moved from Authorizer to local)
  @Column({ type: 'simple-array', default: 'user' })
  roles: string[];

  // Account Security
  @Column({ default: 0 })
  failedLoginAttempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt?: Date;

  @Column({ default: false })
  hide_balance: boolean;

  // Algorithmic trading enrollment
  @Column({ default: false })
  algoTradingEnabled: boolean;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
    comment: 'Percentage of free balance allocated to algo trading (e.g., 25.50 = 25.5%)'
  })
  algoCapitalAllocationPercentage?: number;

  @Column({ type: 'timestamptz', nullable: true })
  algoEnrolledAt?: Date;

  // Runtime-only fields (not persisted to database)
  rememberMe: boolean;
  token: string;

  @CreateDateColumn({ select: false, type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ select: false, type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => Portfolio, (portfolio) => portfolio.user, {
    cascade: true
  })
  portfolios: Portfolio[];

  @OneToMany(() => Order, (order) => order.user, { cascade: true })
  orders: Order[];

  @ManyToOne(() => Risk, (risk) => risk.users, {
    eager: true
  })
  @JoinColumn({ name: 'risk' })
  risk: Risk;

  exchanges: ExchangeKey[];

  constructor(partial: Partial<User>) {
    Object.assign(this, partial);
  }
}
