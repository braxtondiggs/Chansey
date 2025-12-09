import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { randomUUID } from 'crypto';

import { AuditEventType, CreateAuditLogDto, AuditTrailQuery } from '@chansey/api-interfaces';

import { AuditLog } from './entities/audit-log.entity';

import { CryptoService } from '../common/crypto.service';

/**
 * Immutable audit logging service
 * All system decisions and changes are logged with cryptographic integrity
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    private readonly cryptoService: CryptoService
  ) {}

  /**
   * Create a new audit log entry
   * The entry is immutable once created
   */
  async createAuditLog(dto: CreateAuditLogDto): Promise<AuditLog> {
    const timestamp = new Date();

    // Generate integrity hash
    const integrity = this.cryptoService.generateAuditIntegrityHash({
      eventType: dto.eventType,
      entityType: dto.entityType,
      entityId: dto.entityId,
      timestamp,
      beforeState: dto.beforeState,
      afterState: dto.afterState,
      metadata: dto.metadata
    });

    // Hash IP address for privacy
    const hashedIpAddress = dto.ipAddress ? this.cryptoService.hashSensitiveData(dto.ipAddress) : null;

    const auditLog = this.auditLogRepository.create({
      eventType: dto.eventType,
      entityType: dto.entityType,
      entityId: dto.entityId,
      userId: dto.userId,
      timestamp,
      beforeState: dto.beforeState,
      afterState: dto.afterState,
      metadata: dto.metadata,
      correlationId: dto.correlationId || randomUUID(),
      integrity,
      ipAddress: hashedIpAddress,
      userAgent: dto.userAgent
    });

    // Save first to get the ID, then generate and update chain hash
    const saved = await this.auditLogRepository.save(auditLog);

    // Get the most recent previous audit log entry (by timestamp)
    const previousEntry = await this.auditLogRepository.findOne({
      where: {},
      order: { timestamp: 'DESC' },
      select: ['chainHash']
    });

    // Generate chain hash linking to previous entry
    const chainHash = this.cryptoService.generateChainHash(
      {
        id: saved.id,
        eventType: saved.eventType,
        entityType: saved.entityType,
        entityId: saved.entityId,
        timestamp: saved.timestamp,
        integrity: saved.integrity
      },
      previousEntry?.chainHash || null
    );

    // Update with chain hash
    saved.chainHash = chainHash;
    await this.auditLogRepository.save(saved);

    this.logger.log(
      `Audit log created: ${dto.eventType} for ${dto.entityType}:${dto.entityId} (correlationId: ${saved.correlationId})`
    );

    return saved;
  }

  /**
   * Query audit trail with filters
   */
  async queryAuditTrail(query: AuditTrailQuery): Promise<{ logs: AuditLog[]; total: number }> {
    const qb = this.auditLogRepository.createQueryBuilder('audit');

    // Apply filters
    if (query.entityType) {
      qb.andWhere('audit.entityType = :entityType', { entityType: query.entityType });
    }

    if (query.entityId) {
      qb.andWhere('audit.entityId = :entityId', { entityId: query.entityId });
    }

    if (query.eventType) {
      if (Array.isArray(query.eventType)) {
        qb.andWhere('audit.eventType IN (:...eventTypes)', { eventTypes: query.eventType });
      } else {
        qb.andWhere('audit.eventType = :eventType', { eventType: query.eventType });
      }
    }

    if (query.userId) {
      qb.andWhere('audit.userId = :userId', { userId: query.userId });
    }

    if (query.startDate) {
      qb.andWhere('audit.timestamp >= :startDate', { startDate: new Date(query.startDate) });
    }

    if (query.endDate) {
      qb.andWhere('audit.timestamp <= :endDate', { endDate: new Date(query.endDate) });
    }

    if (query.correlationId) {
      qb.andWhere('audit.correlationId = :correlationId', { correlationId: query.correlationId });
    }

    // Order by timestamp descending (most recent first)
    qb.orderBy('audit.timestamp', 'DESC');

    // Get total count
    const total = await qb.getCount();

    // Apply pagination
    const limit = query.limit || 100;
    const offset = query.offset || 0;
    qb.skip(offset).take(limit);

    const logs = await qb.getMany();

    return { logs, total };
  }

  /**
   * Verify integrity of an audit log entry
   */
  verifyIntegrity(auditLog: AuditLog): boolean {
    return this.cryptoService.verifyAuditIntegrity({
      eventType: auditLog.eventType,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      timestamp: auditLog.timestamp,
      beforeState: auditLog.beforeState,
      afterState: auditLog.afterState,
      metadata: auditLog.metadata,
      integrity: auditLog.integrity
    });
  }

  /**
   * Verify integrity of multiple audit log entries
   */
  async verifyMultipleEntries(auditLogIds: string[]): Promise<{ verified: number; failed: string[] }> {
    const logs = await this.auditLogRepository.findByIds(auditLogIds);
    const failed: string[] = [];
    let verified = 0;

    for (const log of logs) {
      if (this.verifyIntegrity(log)) {
        verified++;
      } else {
        failed.push(log.id);
        this.logger.warn(`Integrity verification failed for audit log: ${log.id}`);
      }
    }

    return { verified, failed };
  }

  /**
   * Get audit trail for a specific entity
   */
  async getEntityAuditTrail(entityType: string, entityId: string, limit = 50): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      where: { entityType, entityId },
      order: { timestamp: 'DESC' },
      take: limit
    });
  }

  /**
   * Get correlated audit events
   */
  async getCorrelatedEvents(correlationId: string): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      where: { correlationId },
      order: { timestamp: 'ASC' }
    });
  }

  /**
   * Get audit statistics for a date range
   */
  async getAuditStatistics(
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalEvents: number;
    eventsByType: Record<string, number>;
    eventsByEntity: Record<string, number>;
  }> {
    const logs = await this.auditLogRepository
      .createQueryBuilder('audit')
      .where('audit.timestamp >= :startDate', { startDate })
      .andWhere('audit.timestamp <= :endDate', { endDate })
      .getMany();

    const eventsByType: Record<string, number> = {};
    const eventsByEntity: Record<string, number> = {};

    for (const log of logs) {
      eventsByType[log.eventType] = (eventsByType[log.eventType] || 0) + 1;
      eventsByEntity[log.entityType] = (eventsByEntity[log.entityType] || 0) + 1;
    }

    return {
      totalEvents: logs.length,
      eventsByType,
      eventsByEntity
    };
  }

  // ============================================================================
  // SPECIALIZED AUDIT LOGGING METHODS (T103-T105 Enhancement)
  // ============================================================================

  /**
   * Log strategy configuration change
   */
  async logStrategyConfigChange(
    strategyConfigId: string,
    userId: string,
    beforeState: any,
    afterState: any,
    reason?: string
  ): Promise<AuditLog> {
    return this.createAuditLog({
      eventType: AuditEventType.STRATEGY_MODIFIED,
      entityType: 'StrategyConfig',
      entityId: strategyConfigId,
      userId,
      beforeState,
      afterState,
      metadata: { reason, changeType: 'configuration' }
    });
  }

  /**
   * Log backtest execution
   */
  async logBacktestExecution(
    backtestRunId: string,
    strategyConfigId: string,
    userId: string,
    results: any,
    correlationId?: string
  ): Promise<AuditLog> {
    return this.createAuditLog({
      eventType: AuditEventType.BACKTEST_COMPLETED,
      entityType: 'BacktestRun',
      entityId: backtestRunId,
      userId,
      beforeState: null,
      afterState: {
        strategyConfigId,
        totalReturn: results.totalReturn,
        sharpeRatio: results.sharpeRatio,
        maxDrawdown: results.maxDrawdown,
        totalTrades: results.totalTrades
      },
      metadata: { fullResults: results },
      correlationId
    });
  }

  /**
   * Log promotion gate evaluation
   */
  async logPromotionGateEvaluation(
    strategyConfigId: string,
    userId: string,
    evaluation: any,
    correlationId?: string
  ): Promise<AuditLog> {
    return this.createAuditLog({
      eventType: AuditEventType.GATE_EVALUATION,
      entityType: 'StrategyConfig',
      entityId: strategyConfigId,
      userId,
      beforeState: null,
      afterState: {
        canPromote: evaluation.canPromote,
        gatesPassed: evaluation.gatesPassed,
        gatesFailed: evaluation.gatesFailed,
        failedGates: evaluation.failedGates
      },
      metadata: { evaluation },
      correlationId
    });
  }

  /**
   * Log deployment lifecycle event
   */
  async logDeploymentLifecycle(
    deploymentId: string,
    userId: string,
    event: 'created' | 'activated' | 'paused' | 'resumed' | 'demoted' | 'terminated',
    beforeState: any,
    afterState: any,
    reason?: string,
    correlationId?: string
  ): Promise<AuditLog> {
    const eventTypeMap = {
      created: AuditEventType.STRATEGY_PROMOTED,
      activated: AuditEventType.DEPLOYMENT_ACTIVATED,
      paused: AuditEventType.DEPLOYMENT_PAUSED,
      resumed: AuditEventType.DEPLOYMENT_RESUMED,
      demoted: AuditEventType.STRATEGY_DEMOTED,
      terminated: AuditEventType.DEPLOYMENT_TERMINATED
    };

    return this.createAuditLog({
      eventType: eventTypeMap[event],
      entityType: 'Deployment',
      entityId: deploymentId,
      userId,
      beforeState,
      afterState,
      metadata: { reason, lifecycleEvent: event },
      correlationId
    });
  }

  /**
   * Log risk breach event
   */
  async logRiskBreach(
    deploymentId: string,
    breachType: string,
    details: any,
    correlationId?: string
  ): Promise<AuditLog> {
    return this.createAuditLog({
      eventType: AuditEventType.RISK_BREACH,
      entityType: 'Deployment',
      entityId: deploymentId,
      userId: 'system',
      beforeState: null,
      afterState: details,
      metadata: { breachType },
      correlationId
    });
  }

  /**
   * Log drift detection event
   */
  async logDriftDetection(
    deploymentId: string,
    driftAlertId: string,
    driftType: string,
    severity: string,
    details: any,
    correlationId?: string
  ): Promise<AuditLog> {
    return this.createAuditLog({
      eventType: AuditEventType.DRIFT_DETECTED,
      entityType: 'Deployment',
      entityId: deploymentId,
      userId: 'system',
      beforeState: null,
      afterState: {
        driftAlertId,
        driftType,
        severity,
        expectedValue: details.expectedValue,
        actualValue: details.actualValue,
        deviation: details.deviationPercent
      },
      metadata: { details },
      correlationId
    });
  }

  /**
   * Log allocation adjustment
   */
  async logAllocationAdjustment(
    deploymentId: string,
    userId: string,
    fromPercent: number,
    toPercent: number,
    reason: string,
    correlationId?: string
  ): Promise<AuditLog> {
    return this.createAuditLog({
      eventType: AuditEventType.ALLOCATION_ADJUSTED,
      entityType: 'Deployment',
      entityId: deploymentId,
      userId,
      beforeState: { allocationPercent: fromPercent },
      afterState: { allocationPercent: toPercent },
      metadata: { reason, change: toPercent - fromPercent },
      correlationId
    });
  }

  /**
   * Create audit trail for a complete workflow (with correlation ID)
   */
  async createWorkflowAudit(workflowName: string): Promise<{
    correlationId: string;
    log: (eventType: AuditEventType, details: Partial<CreateAuditLogDto>) => Promise<AuditLog>;
  }> {
    const correlationId = randomUUID();

    return {
      correlationId,
      log: async (eventType: AuditEventType, details: Partial<CreateAuditLogDto>) => {
        return this.createAuditLog({
          eventType,
          correlationId,
          ...details
        } as CreateAuditLogDto);
      }
    };
  }

  // ============================================================================
  // CHAIN VERIFICATION METHODS (T110 Data Integrity)
  // ============================================================================

  /**
   * Verify chain integrity between two consecutive audit log entries
   *
   * @param currentEntry - Current audit log entry
   * @param previousEntry - Previous audit log entry (or null if first entry)
   * @returns True if chain is valid, false if tampered
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
        chainHash: currentEntry.chainHash
      },
      previousEntry ? { chainHash: previousEntry.chainHash } : null
    );
  }

  /**
   * Verify integrity of an entire audit log chain
   * Checks both individual entry integrity and chain linkage
   *
   * @param entries - Audit log entries in chronological order
   * @returns Object with detailed verification results
   */
  verifyAuditChain(entries: AuditLog[]): {
    valid: boolean;
    totalEntries: number;
    verifiedEntries: number;
    brokenChainAt: number | null;
    tamperedEntries: string[];
    integrityFailures: string[];
  } {
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

    // First verify chain linkage
    const chainResult = this.cryptoService.verifyAuditChain(
      entries.map((entry) => ({
        id: entry.id,
        eventType: entry.eventType,
        entityType: entry.entityType,
        entityId: entry.entityId,
        timestamp: entry.timestamp,
        integrity: entry.integrity,
        chainHash: entry.chainHash
      }))
    );

    // Then verify individual entry integrity hashes
    const integrityFailures: string[] = [];
    for (const entry of entries) {
      if (!this.verifyIntegrity(entry)) {
        integrityFailures.push(entry.id);
      }
    }

    // Combine results
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
   * Retrieves all audit logs for the entity and verifies chain integrity
   *
   * @param entityType - Type of entity (e.g., 'StrategyConfig', 'Deployment')
   * @param entityId - ID of the entity
   * @returns Verification results with details
   */
  async verifyEntityAuditChain(
    entityType: string,
    entityId: string
  ): Promise<{
    valid: boolean;
    totalEntries: number;
    verifiedEntries: number;
    brokenChainAt: number | null;
    tamperedEntries: string[];
    integrityFailures: string[];
  }> {
    const entries = await this.auditLogRepository.find({
      where: { entityType, entityId },
      order: { timestamp: 'ASC' } // Must be chronological for chain verification
    });

    return this.verifyAuditChain(entries);
  }

  /**
   * Verify the global audit chain across all entries
   * WARNING: This can be expensive for large audit logs
   * Consider using pagination for production systems
   *
   * @param limit - Maximum number of entries to verify (default: 1000)
   * @param offset - Offset for pagination
   * @returns Verification results
   */
  async verifyGlobalAuditChain(
    limit = 1000,
    offset = 0
  ): Promise<{
    valid: boolean;
    totalEntries: number;
    verifiedEntries: number;
    brokenChainAt: number | null;
    tamperedEntries: string[];
    integrityFailures: string[];
  }> {
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
   * Useful for periodic integrity checks
   *
   * @param startDate - Start of date range
   * @param endDate - End of date range
   * @returns Verification results
   */
  async verifyAuditChainByDateRange(
    startDate: Date,
    endDate: Date
  ): Promise<{
    valid: boolean;
    totalEntries: number;
    verifiedEntries: number;
    brokenChainAt: number | null;
    tamperedEntries: string[];
    integrityFailures: string[];
  }> {
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
   * This should be called periodically (e.g., daily) to detect tampering
   *
   * @param hoursBack - Number of hours to check backwards from now (default: 24)
   * @returns Verification results
   */
  async runScheduledIntegrityCheck(hoursBack = 24): Promise<{
    valid: boolean;
    totalEntries: number;
    verifiedEntries: number;
    brokenChainAt: number | null;
    tamperedEntries: string[];
    integrityFailures: string[];
  }> {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - hoursBack * 60 * 60 * 1000);

    this.logger.log(`Running scheduled integrity check for last ${hoursBack} hours`);

    const result = await this.verifyAuditChainByDateRange(startDate, endDate);

    if (!result.valid) {
      this.logger.error(
        `CRITICAL: Audit log tampering detected during scheduled check! ` +
          `Period: ${startDate.toISOString()} to ${endDate.toISOString()}`
      );
      // In production, this should trigger alerts (email, Slack, PagerDuty, etc.)
    }

    return result;
  }
}
