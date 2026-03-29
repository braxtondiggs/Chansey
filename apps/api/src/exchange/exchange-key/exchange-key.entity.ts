import { ApiProperty } from '@nestjs/swagger';

import { Exclude } from 'class-transformer';
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

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

import type { ExchangeKeyErrorCategory, ExchangeKeyHealthStatus } from '@chansey/api-interfaces';

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
  @Exclude()
  apiKey?: string;

  @Column({ nullable: true })
  @Exclude()
  secretKey?: string;

  @Column({ default: true })
  @ApiProperty({
    description: 'Whether this exchange key is active',
    example: true
  })
  isActive: boolean;

  @Column({ type: 'varchar', length: 20, default: 'unknown' })
  healthStatus: ExchangeKeyHealthStatus;

  @Column({ type: 'timestamptz', nullable: true })
  lastHealthCheckAt: Date | null;

  @Column({ type: 'int', default: 0 })
  consecutiveFailures: number;

  @Column({ type: 'varchar', length: 30, nullable: true })
  lastErrorCategory: ExchangeKeyErrorCategory | null;

  @Column({ type: 'text', nullable: true })
  lastErrorMessage: string | null;

  @Column({ type: 'boolean', default: false })
  deactivatedByHealthCheck: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  name: string;
  slug: string;

  constructor(partial: Partial<ExchangeKey>) {
    Object.assign(this, partial);
  }

  /** Matches the exact format: 32-hex-char IV : 32-hex-char salt : hex ciphertext */
  private static readonly ENCRYPTED_FORMAT = /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/;

  private static isEncrypted(value: string): boolean {
    return ExchangeKey.ENCRYPTED_FORMAT.test(value);
  }

  private static getEncryptionKey(): string {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
      throw new Error('ENCRYPTION_KEY environment variable is not set');
    }
    return key;
  }

  @BeforeInsert()
  @BeforeUpdate()
  async encryptApiKey() {
    if (!this.apiKey || ExchangeKey.isEncrypted(this.apiKey)) return;
    const iv = randomBytes(16);
    const salt = randomBytes(16);
    const key = (await promisify(scrypt)(ExchangeKey.getEncryptionKey(), salt, 32)) as Buffer;
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    this.apiKey = `${iv.toString('hex')}:${salt.toString('hex')}:${Buffer.concat([
      cipher.update(this.apiKey),
      cipher.final()
    ]).toString('hex')}`;
  }

  @BeforeInsert()
  @BeforeUpdate()
  async encryptSecretKey() {
    if (!this.secretKey || ExchangeKey.isEncrypted(this.secretKey)) return;
    const iv = randomBytes(16);
    const salt = randomBytes(16);
    const key = (await promisify(scrypt)(ExchangeKey.getEncryptionKey(), salt, 32)) as Buffer;
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    this.secretKey = `${iv.toString('hex')}:${salt.toString('hex')}:${Buffer.concat([
      cipher.update(this.secretKey),
      cipher.final()
    ]).toString('hex')}`;
  }

  async getDecryptedApiKey(): Promise<string | undefined> {
    if (!this.apiKey || !ExchangeKey.isEncrypted(this.apiKey)) return;
    const [ivs, salts, apiKey] = this.apiKey.split(':');
    const iv = Buffer.from(ivs, 'hex');
    const salt = Buffer.from(salts, 'hex');
    const key = (await promisify(scrypt)(ExchangeKey.getEncryptionKey(), salt, 32)) as Buffer;

    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(apiKey, 'hex'), decipher.final()]).toString();
  }

  async getDecryptedSecretKey(): Promise<string | undefined> {
    if (!this.secretKey || !ExchangeKey.isEncrypted(this.secretKey)) return;
    const [ivs, salts, secretKey] = this.secretKey.split(':');
    const iv = Buffer.from(ivs, 'hex');
    const salt = Buffer.from(salts, 'hex');
    const key = (await promisify(scrypt)(ExchangeKey.getEncryptionKey(), salt, 32)) as Buffer;

    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(secretKey, 'hex'), decipher.final()]).toString();
  }
}
