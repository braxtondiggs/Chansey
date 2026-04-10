import { type AuditLog } from './entities/audit-log.entity';

import { type CryptoService } from '../common/crypto.service';

/**
 * Verify integrity of a single audit log entry by recomputing the integrity hash
 * and comparing it to the stored value.
 *
 * Shared between AuditService and AuditChainService to ensure consistent verification.
 */
export function verifyAuditEntryIntegrity(auditLog: AuditLog, cryptoService: CryptoService): boolean {
  return cryptoService.verifyAuditIntegrity({
    eventType: auditLog.eventType,
    entityType: auditLog.entityType,
    entityId: auditLog.entityId,
    userId: auditLog.userId,
    timestamp: auditLog.timestamp,
    beforeState: auditLog.beforeState,
    afterState: auditLog.afterState,
    metadata: auditLog.metadata,
    integrity: auditLog.integrity
  });
}
