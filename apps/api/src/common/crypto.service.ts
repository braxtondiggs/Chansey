import { Injectable } from '@nestjs/common';

import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Cryptographic utilities service
 * Provides SHA-256 hashing and AES-256 encryption/decryption
 */
@Injectable()
export class CryptoService {
  private readonly algorithm = 'aes-256-cbc';
  private readonly encryptionKey: Buffer;

  constructor() {
    // Use environment variable for encryption key or generate one
    // In production, this should be stored securely (e.g., AWS Secrets Manager)
    const key = process.env.ENCRYPTION_KEY || this.generateKey();
    this.encryptionKey = Buffer.from(key, 'hex');
  }

  /**
   * Generate SHA-256 hash of input data
   * Used for integrity verification of audit logs
   */
  generateSHA256Hash(data: string | object): string {
    const input = typeof data === 'string' ? data : JSON.stringify(data);
    return createHash('sha256').update(input).digest('hex');
  }

  /**
   * Generate integrity hash for audit log entry
   * Combines all critical fields to ensure tamper detection
   */
  generateAuditIntegrityHash(auditEntry: {
    eventType: string;
    entityType: string;
    entityId: string;
    timestamp: Date;
    beforeState?: any;
    afterState?: any;
    metadata?: any;
  }): string {
    const data = {
      eventType: auditEntry.eventType,
      entityType: auditEntry.entityType,
      entityId: auditEntry.entityId,
      timestamp: auditEntry.timestamp.toISOString(),
      beforeState: auditEntry.beforeState || null,
      afterState: auditEntry.afterState || null,
      metadata: auditEntry.metadata || null
    };

    return this.generateSHA256Hash(data);
  }

  /**
   * Verify integrity hash of audit log entry
   */
  verifyAuditIntegrity(auditEntry: {
    eventType: string;
    entityType: string;
    entityId: string;
    timestamp: Date;
    beforeState?: any;
    afterState?: any;
    metadata?: any;
    integrity: string;
  }): boolean {
    const expectedHash = this.generateAuditIntegrityHash(auditEntry);
    return expectedHash === auditEntry.integrity;
  }

  /**
   * Encrypt sensitive data using AES-256-CBC
   * Used for strategy parameters and sensitive configuration
   */
  encrypt(text: string): { encryptedData: string; iv: string } {
    const iv = randomBytes(16);
    const cipher = createCipheriv(this.algorithm, this.encryptionKey, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return {
      encryptedData: encrypted,
      iv: iv.toString('hex')
    };
  }

  /**
   * Decrypt data encrypted with AES-256-CBC
   */
  decrypt(encryptedData: string, iv: string): string {
    const decipher = createDecipheriv(this.algorithm, this.encryptionKey, Buffer.from(iv, 'hex'));

    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Generate a random encryption key
   * This should only be used in development/testing
   */
  private generateKey(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Hash sensitive data for storage (one-way)
   * Used for IP addresses in audit logs
   */
  hashSensitiveData(data: string): string {
    return this.generateSHA256Hash(data);
  }

  /**
   * Generate chain hash for audit log entry
   * Links current entry to previous entry for blockchain-style integrity
   *
   * @param currentEntry - Current audit log entry
   * @param previousHash - Hash of the previous audit log entry
   * @returns Chain hash linking this entry to the previous one
   */
  generateChainHash(
    currentEntry: {
      id: string;
      eventType: string;
      entityType: string;
      entityId: string;
      timestamp: Date;
      integrity: string;
    },
    previousHash: string | null
  ): string {
    const data = {
      id: currentEntry.id,
      eventType: currentEntry.eventType,
      entityType: currentEntry.entityType,
      entityId: currentEntry.entityId,
      timestamp: currentEntry.timestamp.toISOString(),
      integrity: currentEntry.integrity,
      previousHash: previousHash || 'GENESIS'
    };

    return this.generateSHA256Hash(data);
  }

  /**
   * Verify chain integrity between two consecutive audit log entries
   *
   * @param currentEntry - Current audit log entry
   * @param previousEntry - Previous audit log entry (or null if first entry)
   * @returns True if chain is valid, false if tampered
   */
  verifyChainIntegrity(
    currentEntry: {
      id: string;
      eventType: string;
      entityType: string;
      entityId: string;
      timestamp: Date;
      integrity: string;
      chainHash?: string;
    },
    previousEntry: {
      chainHash: string;
    } | null
  ): boolean {
    if (!currentEntry.chainHash) {
      // Entry doesn't have chain hash (legacy or first entry)
      return true;
    }

    const previousHash = previousEntry?.chainHash || null;
    const expectedChainHash = this.generateChainHash(currentEntry, previousHash);

    return expectedChainHash === currentEntry.chainHash;
  }

  /**
   * Verify integrity of an entire audit log chain
   *
   * @param entries - Audit log entries in chronological order
   * @returns Object with verification results
   */
  verifyAuditChain(
    entries: Array<{
      id: string;
      eventType: string;
      entityType: string;
      entityId: string;
      timestamp: Date;
      integrity: string;
      chainHash?: string;
    }>
  ): {
    valid: boolean;
    totalEntries: number;
    verifiedEntries: number;
    brokenChainAt: number | null;
    tamperedEntries: string[];
  } {
    if (entries.length === 0) {
      return {
        valid: true,
        totalEntries: 0,
        verifiedEntries: 0,
        brokenChainAt: null,
        tamperedEntries: []
      };
    }

    let verifiedEntries = 0;
    let brokenChainAt: number | null = null;
    const tamperedEntries: string[] = [];

    for (let i = 0; i < entries.length; i++) {
      const currentEntry = entries[i];
      const previousEntry = i > 0 ? entries[i - 1] : null;

      const chainValid = this.verifyChainIntegrity(
        currentEntry,
        previousEntry && previousEntry.chainHash ? { chainHash: previousEntry.chainHash } : null
      );

      if (chainValid) {
        verifiedEntries++;
      } else {
        if (brokenChainAt === null) {
          brokenChainAt = i;
        }
        tamperedEntries.push(currentEntry.id);
      }
    }

    return {
      valid: verifiedEntries === entries.length,
      totalEntries: entries.length,
      verifiedEntries,
      brokenChainAt,
      tamperedEntries
    };
  }
}
