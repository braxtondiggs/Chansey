import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Not, Repository } from 'typeorm';

import { randomUUID } from 'crypto';

import { AuditEventType, AuditTrailQuery, CreateAuditLogDto } from '@chansey/api-interfaces';

import { verifyAuditEntryIntegrity } from './audit-integrity.util';
import { AuditLog } from './entities/audit-log.entity';

import { RequestContext } from '../common/cls/request-context.service';
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
    private readonly cryptoService: CryptoService,
    @Optional() private readonly requestContext?: RequestContext
  ) {}

  /**
   * Create a new audit log entry
   * The entry is immutable once created
   */
  async createAuditLog(dto: CreateAuditLogDto): Promise<AuditLog> {
    const timestamp = new Date();

    // Fallback to CLS values when dto fields are not provided
    const effectiveUserId = dto.userId ?? this.requestContext?.userId;
    const effectiveIpAddress = dto.ipAddress ?? this.requestContext?.ipAddress;
    const effectiveUserAgent = dto.userAgent ?? this.requestContext?.userAgent;

    // Generate integrity hash (includes userId for non-repudiation)
    const integrity = this.cryptoService.generateAuditIntegrityHash({
      eventType: dto.eventType,
      entityType: dto.entityType,
      entityId: dto.entityId,
      userId: effectiveUserId,
      timestamp,
      beforeState: dto.beforeState,
      afterState: dto.afterState,
      metadata: dto.metadata
    });

    // Hash IP address for privacy
    const hashedIpAddress = effectiveIpAddress ? this.cryptoService.hashSensitiveData(effectiveIpAddress) : null;

    const auditLog = this.auditLogRepository.create({
      eventType: dto.eventType,
      entityType: dto.entityType,
      entityId: dto.entityId,
      userId: effectiveUserId,
      timestamp,
      beforeState: dto.beforeState,
      afterState: dto.afterState,
      metadata: dto.metadata,
      correlationId: dto.correlationId ?? this.requestContext?.requestId ?? randomUUID(),
      integrity,
      ipAddress: hashedIpAddress,
      userAgent: effectiveUserAgent
    });

    // Save first to get the ID, then generate and update chain hash
    const saved = await this.auditLogRepository.save(auditLog);

    // Get the most recent previous audit log entry, excluding the one we just saved
    const previousEntry = await this.auditLogRepository.findOne({
      where: { id: Not(saved.id) },
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
    return verifyAuditEntryIntegrity(auditLog, this.cryptoService);
  }

  /**
   * Verify integrity of multiple audit log entries
   */
  async verifyMultipleEntries(auditLogIds: string[]): Promise<{ verified: number; failed: string[] }> {
    const logs = await this.auditLogRepository.find({ where: { id: In(auditLogIds) } });
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
    const baseQb = this.auditLogRepository
      .createQueryBuilder('audit')
      .where('audit.timestamp >= :startDate', { startDate })
      .andWhere('audit.timestamp <= :endDate', { endDate });

    const [totalEvents, typeRows, entityRows] = await Promise.all([
      baseQb.clone().getCount(),
      baseQb
        .clone()
        .select('audit.eventType', 'eventType')
        .addSelect('COUNT(*)', 'count')
        .groupBy('audit.eventType')
        .getRawMany<{ eventType: string; count: string }>(),
      baseQb
        .clone()
        .select('audit.entityType', 'entityType')
        .addSelect('COUNT(*)', 'count')
        .groupBy('audit.entityType')
        .getRawMany<{ entityType: string; count: string }>()
    ]);

    const eventsByType: Record<string, number> = {};
    for (const row of typeRows) {
      eventsByType[row.eventType] = parseInt(row.count, 10);
    }

    const eventsByEntity: Record<string, number> = {};
    for (const row of entityRows) {
      eventsByEntity[row.entityType] = parseInt(row.count, 10);
    }

    return { totalEvents, eventsByType, eventsByEntity };
  }

  // ============================================================================
  // SPECIALIZED AUDIT LOGGING METHODS
  // ============================================================================

  /**
   * Log strategy configuration change
   */
  async logStrategyConfigChange(opts: {
    strategyConfigId: string;
    userId: string;
    beforeState: any;
    afterState: any;
    reason?: string;
  }): Promise<AuditLog> {
    return this.createAuditLog({
      eventType: AuditEventType.STRATEGY_MODIFIED,
      entityType: 'StrategyConfig',
      entityId: opts.strategyConfigId,
      userId: opts.userId,
      beforeState: opts.beforeState,
      afterState: opts.afterState,
      metadata: { reason: opts.reason, changeType: 'configuration' }
    });
  }

  /**
   * Log promotion gate evaluation
   */
  async logPromotionGateEvaluation(opts: {
    strategyConfigId: string;
    userId?: string;
    evaluation: any;
    correlationId?: string;
    metadata?: Record<string, any>;
  }): Promise<AuditLog> {
    return this.createAuditLog({
      eventType: AuditEventType.GATE_EVALUATION,
      entityType: 'StrategyConfig',
      entityId: opts.strategyConfigId,
      userId: opts.userId,
      beforeState: undefined,
      afterState: {
        canPromote: opts.evaluation.canPromote,
        gatesPassed: opts.evaluation.gatesPassed,
        gatesFailed: opts.evaluation.gatesFailed,
        failedGates: opts.evaluation.failedGates
      },
      metadata: { evaluation: opts.evaluation, ...opts.metadata },
      correlationId: opts.correlationId
    });
  }

  /**
   * Log deployment lifecycle event
   */
  async logDeploymentLifecycle(opts: {
    deploymentId: string;
    userId: string | undefined;
    event: 'created' | 'activated' | 'paused' | 'resumed' | 'demoted' | 'terminated';
    beforeState: any;
    afterState: any;
    reason?: string;
    correlationId?: string;
    metadata?: Record<string, any>;
  }): Promise<AuditLog> {
    const eventTypeMap = {
      created: AuditEventType.STRATEGY_PROMOTED,
      activated: AuditEventType.DEPLOYMENT_ACTIVATED,
      paused: AuditEventType.DEPLOYMENT_PAUSED,
      resumed: AuditEventType.DEPLOYMENT_RESUMED,
      demoted: AuditEventType.STRATEGY_DEMOTED,
      terminated: AuditEventType.DEPLOYMENT_TERMINATED
    };

    return this.createAuditLog({
      eventType: eventTypeMap[opts.event],
      entityType: 'Deployment',
      entityId: opts.deploymentId,
      userId: opts.userId,
      beforeState: opts.beforeState,
      afterState: opts.afterState,
      metadata: { reason: opts.reason, lifecycleEvent: opts.event, ...opts.metadata },
      correlationId: opts.correlationId
    });
  }

  /**
   * Log drift detection event
   */
  async logDriftDetection(opts: {
    deploymentId: string;
    driftAlertId: string;
    driftType: string;
    severity: string;
    details: any;
    correlationId?: string;
  }): Promise<AuditLog> {
    return this.createAuditLog({
      eventType: AuditEventType.DRIFT_DETECTED,
      entityType: 'Deployment',
      entityId: opts.deploymentId,
      beforeState: undefined,
      afterState: {
        driftAlertId: opts.driftAlertId,
        driftType: opts.driftType,
        severity: opts.severity,
        expectedValue: opts.details.expectedValue,
        actualValue: opts.details.actualValue,
        deviation: opts.details.deviationPercent
      },
      metadata: { details: opts.details },
      correlationId: opts.correlationId
    });
  }

  /**
   * Log allocation adjustment
   */
  async logAllocationAdjustment(opts: {
    deploymentId: string;
    userId: string | undefined;
    fromPercent: number;
    toPercent: number;
    reason: string;
    correlationId?: string;
  }): Promise<AuditLog> {
    return this.createAuditLog({
      eventType: AuditEventType.ALLOCATION_ADJUSTED,
      entityType: 'Deployment',
      entityId: opts.deploymentId,
      userId: opts.userId,
      beforeState: { allocationPercent: opts.fromPercent },
      afterState: { allocationPercent: opts.toPercent },
      metadata: { reason: opts.reason, change: opts.toPercent - opts.fromPercent },
      correlationId: opts.correlationId
    });
  }
}
