import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { In, Repository } from 'typeorm';

import { AuditEventType } from '@chansey/api-interfaces';

import { FailedJobQueryDto } from './dto/failed-job-query.dto';
import { ReviewFailedJobDto } from './dto/review-failed-job.dto';
import { FailedJobLog, FailedJobSeverity, FailedJobStatus } from './entities/failed-job-log.entity';
import { FailedJobAlertService } from './failed-job-alert.service';

import { AuditService } from '../audit/audit.service';
import { toErrorInfo } from '../shared/error.util';

/** Queue name → severity classification */
const SEVERITY_MAP: Record<string, FailedJobSeverity> = {
  'trade-execution': FailedJobSeverity.CRITICAL,
  'order-queue': FailedJobSeverity.CRITICAL,
  'live-trading-cron': FailedJobSeverity.CRITICAL,
  'position-monitor': FailedJobSeverity.HIGH,
  'liquidation-monitor': FailedJobSeverity.HIGH,
  // Failed delivery of risk/drift alerts is operationally serious — without
  // notifications a user has no idea their strategy has degraded.
  notification: FailedJobSeverity.HIGH
};

/** Queue name prefixes for MEDIUM severity */
const MEDIUM_PREFIXES = ['backtest', 'pipeline', 'optimization'];

/**
 * Cron-driven sync/maintenance queues — the next scheduled run will catch up,
 * so manual retries from the admin dashboard add no value and only confuse
 * audit trails. Event-driven queues (order-queue, trade-execution, position-
 * monitor, liquidation-monitor, backtest-*, paper-trading, pipeline,
 * optimization, notification) remain retryable.
 */
const NON_RETRYABLE_QUEUES = new Set([
  'live-trading-cron',
  'coin-queue',
  'coin-snapshot-prune-queue',
  'ticker-pairs-queue',
  'ohlc-sync-queue',
  'ohlc-prune-queue',
  'balance-queue',
  'exchange-queue',
  'exchange-health-queue',
  'category-queue',
  'user-queue',
  'coin-selection-queue',
  'performance-ranking',
  'regime-check-queue',
  'drift-detection-queue',
  'strategy-evaluation-queue',
  'backtest-orchestration',
  'pipeline-orchestration'
]);

@Injectable()
export class FailedJobService {
  private static readonly SENSITIVE_KEYS = new Set([
    'apiKey',
    'apiSecret',
    'secret',
    'password',
    'token',
    'accessToken',
    'refreshToken',
    'privateKey',
    'passphrase'
  ]);

  private readonly logger = new Logger(FailedJobService.name);

  constructor(
    @InjectRepository(FailedJobLog)
    private readonly repo: Repository<FailedJobLog>,
    private readonly auditService: AuditService,
    private readonly alertService: FailedJobAlertService,
    private readonly moduleRef: ModuleRef
  ) {}

  /**
   * Record a failed job — fail-safe, never throws.
   */
  async recordFailure(params: {
    queueName: string;
    jobId: string;
    jobName: string;
    jobData?: Record<string, any>;
    errorMessage: string;
    stackTrace?: string;
    attemptsMade?: number;
    maxAttempts?: number;
  }): Promise<FailedJobLog | null> {
    try {
      const severity = this.classifySeverity(params.queueName);
      const { userId, context } = this.extractContext(params.jobData);

      const entry = this.repo.create({
        queueName: params.queueName,
        jobId: params.jobId,
        jobName: params.jobName,
        jobData: this.sanitizeJobData(params.jobData),
        errorMessage: params.errorMessage,
        stackTrace: params.stackTrace,
        attemptsMade: params.attemptsMade ?? 0,
        maxAttempts: params.maxAttempts ?? 0,
        userId,
        severity,
        context,
        status: FailedJobStatus.PENDING
      });

      const saved = await this.repo.save(entry);

      // Audit CRITICAL failures
      if (severity === FailedJobSeverity.CRITICAL) {
        try {
          await this.auditService.createAuditLog({
            eventType: AuditEventType.FAILED_JOB_RECORDED,
            entityType: 'failed_job_log',
            entityId: saved.id,
            userId: userId ?? undefined,
            metadata: {
              queueName: params.queueName,
              jobName: params.jobName,
              errorMessage: params.errorMessage,
              severity
            }
          });
        } catch {
          // Audit failure should never block recording
        }
      }

      // Check for spike
      this.alertService.recordFailure(severity);

      return saved;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to record job failure (fail-safe): ${err.message}`, err.stack);
      return null;
    }
  }

  async findAll(query: FailedJobQueryDto): Promise<{ data: FailedJobLog[]; total: number }> {
    const qb = this.repo.createQueryBuilder('fjl').orderBy('fjl.createdAt', 'DESC');

    if (query.queueName) {
      qb.andWhere('fjl.queueName = :queueName', { queueName: query.queueName });
    }
    if (query.status) {
      qb.andWhere('fjl.status = :status', { status: query.status });
    }
    if (query.severity) {
      qb.andWhere('fjl.severity = :severity', { severity: query.severity });
    }
    if (query.userId) {
      qb.andWhere('fjl.userId = :userId', { userId: query.userId });
    }
    if (query.startDate) {
      qb.andWhere('fjl.createdAt >= :startDate', { startDate: query.startDate });
    }
    if (query.endDate) {
      qb.andWhere('fjl.createdAt <= :endDate', { endDate: query.endDate });
    }

    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    qb.take(limit).skip(offset);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async findOne(id: string): Promise<FailedJobLog> {
    const entry = await this.repo.findOne({ where: { id } });
    if (!entry) throw new NotFoundException(`Failed job log ${id} not found`);
    return entry;
  }

  async getStats(): Promise<Record<string, any>> {
    const [bySeverity, byQueue, byStatus] = await Promise.all([
      this.repo
        .createQueryBuilder('fjl')
        .select('fjl.severity', 'severity')
        .addSelect('COUNT(*)::int', 'count')
        .groupBy('fjl.severity')
        .getRawMany(),
      this.repo
        .createQueryBuilder('fjl')
        .select('fjl.queueName', 'queueName')
        .addSelect('COUNT(*)::int', 'count')
        .groupBy('fjl.queueName')
        .orderBy('count', 'DESC')
        .limit(10)
        .getRawMany(),
      this.repo
        .createQueryBuilder('fjl')
        .select('fjl.status', 'status')
        .addSelect('COUNT(*)::int', 'count')
        .groupBy('fjl.status')
        .getRawMany()
    ]);

    return { bySeverity, byQueue, byStatus };
  }

  async reviewJob(id: string, dto: ReviewFailedJobDto, adminUserId: string): Promise<FailedJobLog> {
    const entry = await this.findOne(id);
    entry.status = dto.status;
    entry.adminNotes = dto.adminNotes ?? null;
    entry.reviewedBy = adminUserId;
    entry.reviewedAt = new Date();

    const saved = await this.repo.save(entry);

    try {
      await this.auditService.createAuditLog({
        eventType: AuditEventType.FAILED_JOB_REVIEWED,
        entityType: 'failed_job_log',
        entityId: saved.id,
        userId: adminUserId,
        metadata: { status: dto.status, adminNotes: dto.adminNotes }
      });
    } catch {
      // Audit failure should not block review
    }

    return saved;
  }

  async retryJob(id: string, adminUserId: string): Promise<FailedJobLog> {
    const entry = await this.findOne(id);

    if (entry.status !== FailedJobStatus.PENDING) {
      throw new BadRequestException(
        `Cannot retry job with status "${entry.status}" — only pending jobs can be retried`
      );
    }

    if (NON_RETRYABLE_QUEUES.has(entry.queueName)) {
      throw new BadRequestException(`Queue "${entry.queueName}" is cron-driven and cannot be retried`);
    }

    // Guard: warn if stored job data contains redacted fields (secrets are stripped on record)
    if (entry.jobData && Object.values(entry.jobData).some((v) => v === '[REDACTED]')) {
      this.logger.warn(`Retrying job ${id} with redacted fields — job must resolve credentials at runtime from IDs`);
    }

    // Resolve the queue dynamically
    let queue: Queue;
    try {
      queue = this.moduleRef.get<Queue>(getQueueToken(entry.queueName), { strict: false });
    } catch {
      throw new NotFoundException(`Queue "${entry.queueName}" not found — cannot retry`);
    }

    await queue.add(entry.jobName, entry.jobData ?? {}, {
      attempts: entry.maxAttempts || 3,
      backoff: { type: 'exponential', delay: 5000 }
    });

    entry.status = FailedJobStatus.RETRIED;
    entry.reviewedBy = adminUserId;
    entry.reviewedAt = new Date();
    const saved = await this.repo.save(entry);

    try {
      await this.auditService.createAuditLog({
        eventType: AuditEventType.FAILED_JOB_RETRIED,
        entityType: 'failed_job_log',
        entityId: saved.id,
        userId: adminUserId,
        metadata: { queueName: entry.queueName, jobName: entry.jobName }
      });
    } catch {
      // Audit failure should not block retry
    }

    return saved;
  }

  async bulkDismiss(ids: string[], adminUserId: string): Promise<number> {
    const result = await this.repo.update(
      { id: In(ids), status: FailedJobStatus.PENDING },
      {
        status: FailedJobStatus.DISMISSED,
        reviewedBy: adminUserId,
        reviewedAt: new Date()
      }
    );
    return result.affected ?? 0;
  }

  classifySeverity(queueName: string): FailedJobSeverity {
    const direct = SEVERITY_MAP[queueName];
    if (direct) return direct;

    if (MEDIUM_PREFIXES.some((p) => queueName.startsWith(p))) {
      return FailedJobSeverity.MEDIUM;
    }

    return FailedJobSeverity.LOW;
  }

  private sanitizeJobData(data?: Record<string, any>): Record<string, any> | undefined {
    if (!data) return data;
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (FailedJobService.SENSITIVE_KEYS.has(key)) {
        sanitized[key] = '[REDACTED]';
      } else if (Array.isArray(value)) {
        sanitized[key] = value.map((item) =>
          item && typeof item === 'object' && !Array.isArray(item) ? this.sanitizeJobData(item) : item
        );
      } else if (value && typeof value === 'object') {
        sanitized[key] = this.sanitizeJobData(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  private extractContext(jobData?: Record<string, any>): {
    userId: string | null;
    context: Record<string, any> | null;
  } {
    if (!jobData) return { userId: null, context: null };

    const userId = (jobData.userId ?? jobData.user?.id ?? null) as string | null;
    const ctx: Record<string, any> = {};

    for (const key of ['symbol', 'action', 'exchange', 'exchangeKeyId', 'strategyId', 'activationId']) {
      if (jobData[key] != null) ctx[key] = jobData[key];
    }

    return { userId, context: Object.keys(ctx).length > 0 ? ctx : null };
  }
}
