import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { verifyAuditEntryIntegrity } from './audit-integrity.util';
import { AuditLog } from './entities/audit-log.entity';
import { ChainVerificationResult } from './interfaces/chain-verification-result.interface';

import { CryptoService } from '../common/crypto.service';

/**
 * Chain verification service for audit log integrity
 * Verifies cryptographic chain linkage and individual entry integrity
 */
@Injectable()
export class AuditChainService {
  private readonly logger = new Logger(AuditChainService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    private readonly cryptoService: CryptoService
  ) {}

  /**
   * Verify chain integrity between two consecutive audit log entries
   */
  verifyChainIntegrity(currentEntry: AuditLog, previousEntry: AuditLog | null): boolean {
    return this.cryptoService.verifyChainIntegrity(
      {
        id: currentEntry.id,
        eventType: currentEntry.eventType,
        entityType: currentEntry.entityType,
        entityId: currentEntry.entityId,
        timestamp: currentEntry.timestamp,
        integrity: currentEntry.integrity,
        chainHash: currentEntry.chainHash ?? undefined
      },
      previousEntry?.chainHash ? { chainHash: previousEntry.chainHash } : null
    );
  }

  /**
   * Verify integrity of an entire audit log chain
   * Checks both individual entry integrity and chain linkage
   */
  verifyAuditChain(entries: AuditLog[]): ChainVerificationResult {
    if (entries.length === 0) {
      return {
        valid: true,
        totalEntries: 0,
        verifiedEntries: 0,
        brokenChainAt: null,
        tamperedEntries: [],
        integrityFailures: []
      };
    }

    const chainResult = this.cryptoService.verifyAuditChain(
      entries.map((entry) => ({
        id: entry.id,
        eventType: entry.eventType,
        entityType: entry.entityType,
        entityId: entry.entityId,
        timestamp: entry.timestamp,
        integrity: entry.integrity,
        chainHash: entry.chainHash ?? undefined
      }))
    );

    const integrityFailures: string[] = [];
    for (const entry of entries) {
      if (!this.verifyEntryIntegrity(entry)) {
        integrityFailures.push(entry.id);
      }
    }

    const allTamperedEntries = [...new Set([...chainResult.tamperedEntries, ...integrityFailures])];

    return {
      valid: chainResult.valid && integrityFailures.length === 0,
      totalEntries: chainResult.totalEntries,
      verifiedEntries: chainResult.verifiedEntries,
      brokenChainAt: chainResult.brokenChainAt,
      tamperedEntries: allTamperedEntries,
      integrityFailures
    };
  }

  /**
   * Verify the complete audit chain for a specific entity
   */
  async verifyEntityAuditChain(entityType: string, entityId: string): Promise<ChainVerificationResult> {
    const entries = await this.auditLogRepository.find({
      where: { entityType, entityId },
      order: { timestamp: 'ASC' }
    });

    return this.verifyAuditChain(entries);
  }

  /**
   * Verify the global audit chain across all entries
   * WARNING: This can be expensive for large audit logs
   */
  async verifyGlobalAuditChain(limit = 1000, offset = 0): Promise<ChainVerificationResult> {
    const entries = await this.auditLogRepository.find({
      order: { timestamp: 'ASC' },
      take: limit,
      skip: offset
    });

    const result = this.verifyAuditChain(entries);

    this.logger.log(
      `Global audit chain verification: ${result.verifiedEntries}/${result.totalEntries} entries verified ` +
        `(offset: ${offset}, limit: ${limit})`
    );

    if (!result.valid) {
      this.logger.error(
        `Audit chain integrity breach detected! ` +
          `Broken at index: ${result.brokenChainAt}, ` +
          `Tampered entries: ${result.tamperedEntries.length}, ` +
          `Integrity failures: ${result.integrityFailures.length}`
      );
    }

    return result;
  }

  /**
   * Verify audit chain for a specific date range
   */
  async verifyAuditChainByDateRange(startDate: Date, endDate: Date): Promise<ChainVerificationResult> {
    const entries = await this.auditLogRepository
      .createQueryBuilder('audit')
      .where('audit.timestamp >= :startDate', { startDate })
      .andWhere('audit.timestamp <= :endDate', { endDate })
      .orderBy('audit.timestamp', 'ASC')
      .getMany();

    const result = this.verifyAuditChain(entries);

    this.logger.log(
      `Audit chain verification for ${startDate.toISOString()} to ${endDate.toISOString()}: ` +
        `${result.verifiedEntries}/${result.totalEntries} entries verified`
    );

    return result;
  }

  /**
   * Run a scheduled integrity check on the audit log
   * Should be called periodically (e.g., daily) to detect tampering
   */
  async runScheduledIntegrityCheck(hoursBack = 24): Promise<ChainVerificationResult> {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - hoursBack * 60 * 60 * 1000);

    this.logger.log(`Running scheduled integrity check for last ${hoursBack} hours`);

    const result = await this.verifyAuditChainByDateRange(startDate, endDate);

    if (!result.valid) {
      this.logger.error(
        `CRITICAL: Audit log tampering detected during scheduled check! ` +
          `Period: ${startDate.toISOString()} to ${endDate.toISOString()}`
      );
    }

    return result;
  }

  /**
   * Verify integrity of a single audit log entry
   */
  private verifyEntryIntegrity(auditLog: AuditLog): boolean {
    return verifyAuditEntryIntegrity(auditLog, this.cryptoService);
  }
}
