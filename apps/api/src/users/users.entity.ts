import { createCipheriv, createDecipheriv, randomBytes, scrypt, scryptSync } from 'crypto';
import { promisify } from 'util';

import { Exclude, Expose } from 'class-transformer';
import {
  BeforeUpdate,
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
  Timestamp,
  UpdateDateColumn
} from 'typeorm';

import { Order } from '../order/order.entity';
import { Portfolio } from '../portfolio/portfolio.entity';

@Entity()
export default class User {
  @PrimaryColumn({ unique: true })
  id: string;

  given_name: string;
  family_name: string;
  email: string;

  @Exclude()
  id_token: string;

  @Exclude()
  expires_in: number;

  @Exclude()
  @Column({ nullable: true })
  binance: string;

  @Exclude()
  @Column({ nullable: true })
  binanceSecret: string;

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

  @CreateDateColumn({ select: false })
  createdAt: Timestamp;

  @UpdateDateColumn({ select: false })
  updatedAt: Timestamp;

  @OneToMany(() => Portfolio, (portfolio) => portfolio.user, { onDelete: 'CASCADE' })
  portfolios: Portfolio[];

  @OneToMany(() => Order, (order) => order.user, { onDelete: 'CASCADE' })
  orders: Order[];

  constructor(partial: Partial<User>) {
    Object.assign(this, partial);
  }
}
