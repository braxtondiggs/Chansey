import { Injectable, Logger } from '@nestjs/common';

import { AuditEventType } from '@chansey/api-interfaces';

import { FailedJobSeverity } from './entities/failed-job-log.entity';

import { AuditService } from '../audit/audit.service';
import { toErrorInfo } from '../shared/error.util';

const WINDOW_MS = 5 * 60 * 1000; // 5-minute rolling window
const SPIKE_THRESHOLD = 5; // critical failures within window

@Injectable()
export class FailedJobAlertService {
  private readonly logger = new Logger(FailedJobAlertService.name);
  private readonly timestamps = new Map<string, number[]>();

  constructor(private readonly auditService: AuditService) {}

  /**
   * Record a failure and check for spikes — fully fail-safe.
   */
  recordFailure(severity: FailedJobSeverity): void {
    try {
      const now = Date.now();
      const key = severity;
      const entries = this.timestamps.get(key) ?? [];

      // Prune old entries
      const cutoff = now - WINDOW_MS;
      const pruned = entries.filter((t) => t > cutoff);
      pruned.push(now);
      this.timestamps.set(key, pruned);

      if (severity === FailedJobSeverity.CRITICAL && pruned.length >= SPIKE_THRESHOLD) {
        this.logger.error(`CRITICAL failure spike detected: ${pruned.length} failures in 5-minute window`);

        // Reset to avoid repeated alerts
        this.timestamps.set(key, []);

        this.auditService
          .createAuditLog({
            eventType: AuditEventType.FAILED_JOB_SPIKE_DETECTED,
            entityType: 'failed_job_log',
            entityId: 'spike',
            metadata: {
              severity,
              count: pruned.length,
              windowMs: WINDOW_MS,
              threshold: SPIKE_THRESHOLD
            }
          })
          .catch(() => {
            // Audit failure should never cause cascading issues
          });
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed job alert service error (fail-safe): ${err.message}`);
    }
  }
}
