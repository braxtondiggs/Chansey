import { MigrationInterface, QueryRunner } from 'typeorm';

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

/**
 * Re-encrypts exchange API keys from JWT_SECRET to ENCRYPTION_KEY.
 *
 * This migration requires both environment variables to be set:
 * - JWT_SECRET: the old encryption key (used to decrypt)
 * - ENCRYPTION_KEY: the new encryption key (used to re-encrypt)
 *
 * After this migration, only ENCRYPTION_KEY is needed.
 */
export class ReEncryptExchangeKeys1741000000000 implements MigrationInterface {
  name = 'ReEncryptExchangeKeys1741000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const oldSecret = process.env.JWT_SECRET;
    const newSecret = process.env.ENCRYPTION_KEY;

    if (!oldSecret) {
      throw new Error('JWT_SECRET environment variable is required to decrypt existing keys');
    }
    if (!newSecret) {
      throw new Error('ENCRYPTION_KEY environment variable is required to re-encrypt keys');
    }

    // If they're the same, no re-encryption needed (fresh install or already migrated)
    if (oldSecret === newSecret) {
      console.log('JWT_SECRET and ENCRYPTION_KEY are identical — skipping re-encryption');
      return;
    }

    const rows: { id: string; apiKey: string | null; secretKey: string | null }[] = await queryRunner.query(
      `SELECT "id", "apiKey", "secretKey" FROM "exchange_key"`
    );

    if (rows.length === 0) {
      console.log('No exchange keys to re-encrypt');
      return;
    }

    console.log(`Re-encrypting ${rows.length} exchange key(s)...`);

    for (const row of rows) {
      const updates: Record<string, string> = {};

      if (row.apiKey && row.apiKey.includes(':')) {
        const decrypted = this.decrypt(row.apiKey, oldSecret);
        updates.apiKey = this.encrypt(decrypted, newSecret);
      }

      if (row.secretKey && row.secretKey.includes(':')) {
        const decrypted = this.decrypt(row.secretKey, oldSecret);
        updates.secretKey = this.encrypt(decrypted, newSecret);
      }

      if (Object.keys(updates).length > 0) {
        const setClauses = Object.keys(updates)
          .map((col, i) => `"${col}" = $${i + 1}`)
          .join(', ');
        const values = Object.values(updates);
        await queryRunner.query(`UPDATE "exchange_key" SET ${setClauses} WHERE "id" = $${values.length + 1}`, [
          ...values,
          row.id
        ]);
      }
    }

    console.log(`Successfully re-encrypted ${rows.length} exchange key(s)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const oldSecret = process.env.ENCRYPTION_KEY;
    const newSecret = process.env.JWT_SECRET;

    if (!oldSecret) {
      throw new Error('ENCRYPTION_KEY environment variable is required to decrypt keys for rollback');
    }
    if (!newSecret) {
      throw new Error('JWT_SECRET environment variable is required to re-encrypt keys for rollback');
    }

    if (oldSecret === newSecret) {
      return;
    }

    const rows: { id: string; apiKey: string | null; secretKey: string | null }[] = await queryRunner.query(
      `SELECT "id", "apiKey", "secretKey" FROM "exchange_key"`
    );

    for (const row of rows) {
      const updates: Record<string, string> = {};

      if (row.apiKey && row.apiKey.includes(':')) {
        const decrypted = this.decrypt(row.apiKey, oldSecret);
        updates.apiKey = this.encrypt(decrypted, newSecret);
      }

      if (row.secretKey && row.secretKey.includes(':')) {
        const decrypted = this.decrypt(row.secretKey, oldSecret);
        updates.secretKey = this.encrypt(decrypted, newSecret);
      }

      if (Object.keys(updates).length > 0) {
        const setClauses = Object.keys(updates)
          .map((col, i) => `"${col}" = $${i + 1}`)
          .join(', ');
        const values = Object.values(updates);
        await queryRunner.query(`UPDATE "exchange_key" SET ${setClauses} WHERE "id" = $${values.length + 1}`, [
          ...values,
          row.id
        ]);
      }
    }
  }

  private decrypt(ciphertext: string, secret: string): string {
    const [ivHex, saltHex, encryptedHex] = ciphertext.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const salt = Buffer.from(saltHex, 'hex');
    const key = scryptSync(secret, salt, 32);
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(encryptedHex, 'hex'), decipher.final()]).toString();
  }

  private encrypt(plaintext: string, secret: string): string {
    const iv = randomBytes(16);
    const salt = randomBytes(16);
    const key = scryptSync(secret, salt, 32);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return `${iv.toString('hex')}:${salt.toString('hex')}:${encrypted.toString('hex')}`;
  }
}
