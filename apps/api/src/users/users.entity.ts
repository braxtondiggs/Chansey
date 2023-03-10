import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

import {
  AfterLoad,
  BeforeUpdate,
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Timestamp,
  UpdateDateColumn
} from 'typeorm';

import { Portfolio } from '../portfolio/portfolio.entity';

const key = createHash('sha256').update('Nixnogen').digest();
const iv = randomBytes(16);

@Entity()
export default class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  name: string;

  @Column()
  password: string;

  @Column({ nullable: true })
  private binance: string;

  private binanceAPIKey: string;

  @BeforeUpdate()
  async encryptBinance() {
    if (!this.binance) return;
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    this.binance = Buffer.concat([cipher.update(this.binance), cipher.final()]).toString('hex');
  }

  @AfterLoad()
  async decryptBinance() {
    if (!this.binance) return;
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    this.binanceAPIKey = Buffer.concat([decipher.update(this.binance, 'hex'), decipher.final()]).toString();
  }

  @CreateDateColumn({ select: false })
  createdAt: Timestamp;

  @UpdateDateColumn({ select: false })
  updatedAt: Timestamp;

  @OneToMany(() => Portfolio, (portfolio) => portfolio.user)
  portfolios: Portfolio[];
}
