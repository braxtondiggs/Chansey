import { createCipheriv, createDecipheriv, randomBytes, scrypt, scryptSync } from 'crypto';
import { promisify } from 'util';

import {
  AfterLoad,
  BeforeUpdate,
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
  Timestamp,
  UpdateDateColumn
} from 'typeorm';

import { Portfolio } from '../portfolio/portfolio.entity';

@Entity()
export default class User {
  @PrimaryColumn({ unique: true })
  id: string;

  @Column({ nullable: true })
  private binance: string;

  private binanceAPIKey: string;

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

  @AfterLoad()
  async decryptBinance() {
    if (!this.binance) return;
    const [ivs, salts, binance] = this.binance.split(':');
    const iv = Buffer.from(ivs, 'hex');
    const salt = Buffer.from(salts, 'hex');
    const key = scryptSync(process.env.JWT_SECRET, salt, 32);

    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    // console.log(Buffer.concat([decipher.update(this.binance, 'hex'), decipher.final()]).toString());
    this.binanceAPIKey = Buffer.concat([decipher.update(binance, 'hex'), decipher.final()]).toString();
  }

  @CreateDateColumn({ select: false })
  createdAt: Timestamp;

  @UpdateDateColumn({ select: false })
  updatedAt: Timestamp;

  @OneToMany(() => Portfolio, (portfolio) => portfolio.user, { onDelete: 'CASCADE' })
  portfolios: Portfolio[];
}
