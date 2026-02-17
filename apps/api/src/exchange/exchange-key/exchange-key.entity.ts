import { ApiProperty } from '@nestjs/swagger';

import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn
} from 'typeorm';

import { createCipheriv, createDecipheriv, randomBytes, scrypt, scryptSync } from 'crypto';
import { promisify } from 'util';

import type { User } from '../../users/users.entity';
import type { Exchange } from '../exchange.entity';

@Entity()
export class ExchangeKey {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique identifier for the exchange key',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @ManyToOne('User', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  @ApiProperty({
    description: 'User that owns this exchange key'
  })
  user: Relation<User>;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne('Exchange', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exchangeId' })
  @ApiProperty({
    description: 'Exchange this key belongs to'
  })
  exchange: Relation<Exchange>;

  @Column({ nullable: true })
  exchangeId: string;

  @Column({ nullable: true })
  apiKey?: string;

  @Column({ nullable: true })
  secretKey?: string;

  @Column({ default: true })
  @ApiProperty({
    description: 'Whether this exchange key is active',
    example: true
  })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  name: string;
  slug: string;

  constructor(partial: Partial<ExchangeKey>) {
    Object.assign(this, partial);
  }

  @BeforeInsert()
  @BeforeUpdate()
  async encryptApiKey() {
    if (!this.apiKey || this.apiKey === this.decryptedApiKey) return;
    const iv = randomBytes(16);
    const salt = randomBytes(16);
    const key = (await promisify(scrypt)(process.env.JWT_SECRET ?? '', salt, 32)) as Buffer;
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    this.apiKey = `${iv.toString('hex')}:${salt.toString('hex')}:${Buffer.concat([
      cipher.update(this.apiKey),
      cipher.final()
    ]).toString('hex')}`;
  }

  @BeforeInsert()
  @BeforeUpdate()
  async encryptSecretKey() {
    if (!this.secretKey || this.secretKey === this.decryptedSecretKey) return;
    const iv = randomBytes(16);
    const salt = randomBytes(16);
    const key = (await promisify(scrypt)(process.env.JWT_SECRET ?? '', salt, 32)) as Buffer;
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    this.secretKey = `${iv.toString('hex')}:${salt.toString('hex')}:${Buffer.concat([
      cipher.update(this.secretKey),
      cipher.final()
    ]).toString('hex')}`;
  }

  get decryptedApiKey() {
    if (!this.apiKey || !this.apiKey.includes(':')) return;
    const [ivs, salts, apiKey] = this.apiKey.split(':');
    const iv = Buffer.from(ivs, 'hex');
    const salt = Buffer.from(salts, 'hex');
    const key = scryptSync(process.env.JWT_SECRET ?? '', salt, 32);

    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(apiKey, 'hex'), decipher.final()]).toString();
  }

  get decryptedSecretKey() {
    if (!this.secretKey || !this.secretKey.includes(':')) return;
    const [ivs, salts, secretKey] = this.secretKey.split(':');
    const iv = Buffer.from(ivs, 'hex');
    const salt = Buffer.from(salts, 'hex');
    const key = scryptSync(process.env.JWT_SECRET ?? '', salt, 32);

    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(secretKey, 'hex'), decipher.final()]).toString();
  }
}
