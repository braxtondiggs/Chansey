import { Exclude, Expose } from 'class-transformer';
import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn
} from 'typeorm';

import { createCipheriv, createDecipheriv, randomBytes, scrypt, scryptSync } from 'crypto';
import { promisify } from 'util';

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

  rememberMe: boolean;
  token: string;

  @Exclude()
  id_token: string;

  @Exclude()
  expires_in: number;

  @Exclude()
  @Column({ nullable: true })
  binance?: string;

  @Exclude()
  @Column({ nullable: true })
  binanceSecret?: string;

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
  @JoinColumn({ name: 'risk_id' })
  risk: Risk;

  constructor(partial: Partial<User>) {
    Object.assign(this, partial);
  }

  @BeforeInsert()
  @BeforeUpdate()
  async encryptBinance() {
    if (!this.binance || this.binance === this.binanceAPIKey) return;
    const iv = randomBytes(16);
    const salt = randomBytes(16);
    const key = (await promisify(scrypt)(process.env.JWT_SECRET, salt, 32)) as Buffer;
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    this.binance = `${iv.toString('hex')}:${salt.toString('hex')}:${Buffer.concat([
      cipher.update(this.binance),
      cipher.final()
    ]).toString('hex')}`;
  }

  @BeforeInsert()
  @BeforeUpdate()
  async encryptBinanceSecret() {
    if (!this.binanceSecret || this.binanceSecret === this.binanceSecretKey) return;
    const iv = randomBytes(16);
    const salt = randomBytes(16);
    const key = (await promisify(scrypt)(process.env.JWT_SECRET, salt, 32)) as Buffer;
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    this.binanceSecret = `${iv.toString('hex')}:${salt.toString('hex')}:${Buffer.concat([
      cipher.update(this.binanceSecret),
      cipher.final()
    ]).toString('hex')}`;
  }

  // We'll no longer try to fetch the Risk directly in the entity
  // This avoids the ConnectionNotFoundError

  @Expose()
  get binanceAPIKey() {
    if (!this.binance || !this.binance.includes(':')) return;
    const [ivs, salts, binance] = this.binance.split(':');
    const iv = Buffer.from(ivs, 'hex');
    const salt = Buffer.from(salts, 'hex');
    const key = scryptSync(process.env.JWT_SECRET, salt, 32);

    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(binance, 'hex'), decipher.final()]).toString();
  }

  @Expose()
  get binanceSecretKey() {
    if (!this.binanceSecret || !this.binanceSecret.includes(':')) return;
    const [ivs, salts, binanceSecret] = this.binanceSecret.split(':');
    const iv = Buffer.from(ivs, 'hex');
    const salt = Buffer.from(salts, 'hex');
    const key = scryptSync(process.env.JWT_SECRET, salt, 32);

    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(binanceSecret, 'hex'), decipher.final()]).toString();
  }
}
