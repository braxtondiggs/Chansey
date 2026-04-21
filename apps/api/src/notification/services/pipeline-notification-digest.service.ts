import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { Queue } from 'bullmq';
import Redis from 'ioredis';

import {
  DeploymentRecommendation,
  NotificationEventType,
  NotificationSeverity,
  PipelineStage
} from '@chansey/api-interfaces';

import { toErrorInfo } from '../../shared/error.util';
import { forceRemoveJob } from '../../shared/queue.util';
import { NotificationPayload } from '../interfaces/notification-events.interface';
import { NOTIFICATION_REDIS } from '../notification-redis.provider';
import { NotificationService } from '../notification.service';

export const PIPELINE_DIGEST_QUEUE = 'notification-digest';
export const PIPELINE_DIGEST_JOB_NAME = 'flush-digest';

export type DigestBucket = 'started' | 'stage' | 'terminal';

export const DIGEST_DEBOUNCE_MS: Record<DigestBucket, number> = {
  started: 5 * 60 * 1000,
  stage: 15 * 60 * 1000,
  terminal: 2 * 60 * 60 * 1000
};

const SAFETY_TTL_EXTENSION_MS = 60 * 60 * 1000; // 1 hour safety margin

const STAGE_FRIENDLY_LABEL: Record<string, string> = {
  [PipelineStage.OPTIMIZE]: 'Training your strategy',
  [PipelineStage.HISTORICAL]: 'Testing against history',
  [PipelineStage.LIVE_REPLAY]: 'Replaying recent market data',
  [PipelineStage.PAPER_TRADE]: 'Practicing with pretend money',
  [PipelineStage.COMPLETED]: 'Final safety review'
};

const STAGE_COMPLETED_LABEL: Record<string, string> = {
  [PipelineStage.OPTIMIZE]: 'training complete',
  [PipelineStage.HISTORICAL]: 'historical testing complete',
  [PipelineStage.LIVE_REPLAY]: 'recent market replay complete',
  [PipelineStage.PAPER_TRADE]: 'paper trading complete'
};

export type DigestEntrySubType = 'started' | 'stage' | 'completed' | 'rejected' | 'failed';

export interface DigestEntry {
  pipelineId: string;
  userId: string;
  strategyName: string;
  subType: DigestEntrySubType;
  previousStage?: PipelineStage;
  newStage?: PipelineStage;
  recommendation?: DeploymentRecommendation;
  inconclusive?: boolean;
  reason?: string;
  at: string;
}

export interface FlushJobData {
  userId: string;
  bucket: DigestBucket;
}

interface AggregatedPayload {
  eventType: NotificationEventType;
  title: string;
  body: string;
  severity: NotificationSeverity;
  payload: Record<string, unknown>;
}

@Injectable()
export class PipelineNotificationDigestService {
  private readonly logger = new Logger(PipelineNotificationDigestService.name);

  constructor(
    @InjectQueue(PIPELINE_DIGEST_QUEUE) private readonly digestQueue: Queue,
    @Inject(NOTIFICATION_REDIS) private readonly redis: Redis,
    private readonly notificationService: NotificationService
  ) {}

  /**
   * Build the deterministic jobId used to debounce per (user, bucket).
   * Exposed for tests only — production callers should never need it.
   */
  jobIdFor(userId: string, bucket: DigestBucket): string {
    return `pl-digest:${userId}:${bucket}`;
  }

  /**
   * Redis list key holding buffered digest entries.
   */
  pendingKey(userId: string, bucket: DigestBucket): string {
    return `notif:pl-digest:pending:${userId}:${bucket}`;
  }

  /**
   * Buffer an event into the per-(user, bucket) Redis list and arm / reset the
   * BullMQ debounce job. Race-safe: any event arriving after a flush drains
   * the list simply seeds a fresh list + new debounce cycle.
   */
  async enqueue(bucket: DigestBucket, entry: DigestEntry): Promise<void> {
    const delayMs = DIGEST_DEBOUNCE_MS[bucket];
    const pendingKey = this.pendingKey(entry.userId, bucket);
    const jobId = this.jobIdFor(entry.userId, bucket);

    try {
      await this.redis
        .multi()
        .rpush(pendingKey, JSON.stringify(entry))
        .pexpire(pendingKey, delayMs + SAFETY_TTL_EXTENSION_MS)
        .exec();

      const existing = await this.digestQueue.getJob(jobId);

      if (!existing) {
        await this.digestQueue.add(PIPELINE_DIGEST_JOB_NAME, { userId: entry.userId, bucket } satisfies FlushJobData, {
          jobId,
          delay: delayMs,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 500
        });
        return;
      }

      try {
        await existing.changeDelay(delayMs);
      } catch (changeDelayError) {
        // Job is already active / completed — can't reschedule. Force-remove
        // and re-add under the same jobId so the next flush sees this entry.
        const err = toErrorInfo(changeDelayError);
        this.logger.debug(`changeDelay failed for ${jobId} (${err.message}); re-arming`);
        await forceRemoveJob(this.digestQueue, jobId, this.logger);
        await this.digestQueue.add(PIPELINE_DIGEST_JOB_NAME, { userId: entry.userId, bucket } satisfies FlushJobData, {
          jobId,
          delay: delayMs,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 500
        });
      }
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.error(
        `Failed to enqueue digest entry for user ${entry.userId} bucket ${bucket}: ${err.message}`,
        err.stack
      );
    }
  }

  /**
   * Drain all buffered entries for (userId, bucket) and emit a single
   * aggregated notification. Called from the BullMQ processor when the
   * debounce window expires.
   */
  async flush(userId: string, bucket: DigestBucket): Promise<void> {
    const pendingKey = this.pendingKey(userId, bucket);

    const multiResult = await this.redis.multi().lrange(pendingKey, 0, -1).del(pendingKey).exec();

    if (!multiResult) {
      this.logger.warn(`Redis MULTI returned null draining ${pendingKey}`);
      return;
    }

    const [lrangeResult] = multiResult;
    const rawEntries = (lrangeResult?.[1] as string[] | undefined) ?? [];

    if (rawEntries.length === 0) return;

    const entries = this.parseAndDedupe(rawEntries);
    if (entries.length === 0) return;

    const aggregated = this.buildAggregate(bucket, entries);
    if (!aggregated) return;

    await this.notificationService.send(
      userId,
      aggregated.eventType,
      aggregated.title,
      aggregated.body,
      aggregated.severity,
      aggregated.payload as unknown as NotificationPayload
    );
  }

  private parseAndDedupe(rawEntries: string[]): DigestEntry[] {
    const byPipelineId = new Map<string, DigestEntry>();
    for (const raw of rawEntries) {
      try {
        const parsed = JSON.parse(raw) as DigestEntry;
        const existing = byPipelineId.get(parsed.pipelineId);
        if (!existing || parsed.at >= existing.at) {
          byPipelineId.set(parsed.pipelineId, parsed);
        }
      } catch (error) {
        const err = toErrorInfo(error);
        this.logger.warn(`Skipping malformed digest entry: ${err.message}`);
      }
    }
    return Array.from(byPipelineId.values());
  }

  private buildAggregate(bucket: DigestBucket, entries: DigestEntry[]): AggregatedPayload | null {
    switch (bucket) {
      case 'started':
        return this.buildStartedAggregate(entries);
      case 'stage':
        return this.buildStageAggregate(entries);
      case 'terminal':
        return this.buildTerminalAggregate(entries);
      default:
        return null;
    }
  }

  private buildStartedAggregate(entries: DigestEntry[]): AggregatedPayload {
    const basePayload = this.baseBatchPayload(entries);

    if (entries.length === 1) {
      return {
        eventType: NotificationEventType.PIPELINE_STARTED,
        title: 'We started building a new strategy',
        body: `An automated strategy is being trained and tested — we'll let you know as it progresses.`,
        severity: 'info',
        payload: { ...basePayload, strategyName: entries[0].strategyName }
      };
    }

    return {
      eventType: NotificationEventType.PIPELINE_STARTED,
      title: `We started building ${entries.length} new strategies`,
      body: `${this.describeStrategyList(entries)} — we'll let you know as they progress.`,
      severity: 'info',
      payload: basePayload
    };
  }

  private buildStageAggregate(entries: DigestEntry[]): AggregatedPayload {
    const basePayload = this.baseBatchPayload(entries);

    if (entries.length === 1) {
      const single = entries[0];
      const completedLabel = single.previousStage
        ? (STAGE_COMPLETED_LABEL[single.previousStage] ?? 'stage complete')
        : 'stage complete';
      const nextLabel = single.newStage ? (STAGE_FRIENDLY_LABEL[single.newStage] ?? 'next stage') : 'next stage';

      return {
        eventType: NotificationEventType.PIPELINE_STAGE_COMPLETED,
        title: `Strategy progress: ${completedLabel}`,
        body: `Moving on to: ${nextLabel}.`,
        severity: 'info',
        payload: {
          ...basePayload,
          strategyName: single.strategyName,
          completedStage: single.previousStage,
          nextStage: single.newStage
        }
      };
    }

    const groups = new Map<string, { count: number; completedLabel: string; nextLabel: string }>();
    for (const entry of entries) {
      const completedLabel = entry.previousStage
        ? (STAGE_COMPLETED_LABEL[entry.previousStage] ?? 'stage complete')
        : 'stage complete';
      const nextLabel = entry.newStage ? (STAGE_FRIENDLY_LABEL[entry.newStage] ?? 'next stage') : 'next stage';
      const key = `${entry.previousStage ?? 'unknown'}→${entry.newStage ?? 'unknown'}`;
      const existing = groups.get(key);
      if (existing) {
        existing.count++;
      } else {
        groups.set(key, { count: 1, completedLabel, nextLabel });
      }
    }

    if (groups.size === 1) {
      const [only] = Array.from(groups.values());
      return {
        eventType: NotificationEventType.PIPELINE_STAGE_COMPLETED,
        title: `${entries.length} strategies: ${only.completedLabel}`,
        body: `All moving on to: ${only.nextLabel}.`,
        severity: 'info',
        payload: basePayload
      };
    }

    const parts = Array.from(groups.values()).map(
      (group) => `${group.count} × ${group.completedLabel} → ${group.nextLabel}`
    );
    return {
      eventType: NotificationEventType.PIPELINE_STAGE_COMPLETED,
      title: `${entries.length} strategies making progress`,
      body: `${parts.join('; ')}.`,
      severity: 'info',
      payload: basePayload
    };
  }

  private buildTerminalAggregate(entries: DigestEntry[]): AggregatedPayload {
    const success = entries.filter(
      (e) =>
        e.recommendation === DeploymentRecommendation.DEPLOY ||
        e.recommendation === DeploymentRecommendation.NEEDS_REVIEW
    ).length;
    const inconclusive = entries.filter(
      (e) => e.recommendation === DeploymentRecommendation.INCONCLUSIVE_RETRY || e.inconclusive === true
    ).length;
    const rejected = entries.filter(
      (e) =>
        e.subType === 'rejected' ||
        (e.subType === 'completed' && e.recommendation === DeploymentRecommendation.DO_NOT_DEPLOY)
    ).length;
    const failed = entries.filter((e) => e.subType === 'failed').length;
    const rejectedOrFailed = rejected + failed;

    const basePayload = {
      ...this.baseBatchPayload(entries),
      counts: { success, rejected, failed, inconclusive, total: entries.length }
    };

    // Single-pipeline: reuse existing per-recommendation wording verbatim.
    if (entries.length === 1) {
      return this.buildSingleTerminalAggregate(entries[0], basePayload);
    }

    if (success >= 1) {
      const strategyWord = success === 1 ? 'strategy is' : 'strategies are';
      const simpleBody = `They passed every check and are being activated on your account.`;
      const body =
        rejectedOrFailed === 0 && inconclusive === 0
          ? simpleBody
          : this.formatMixedTerminalBody(success, rejected, failed, inconclusive);

      return {
        eventType: NotificationEventType.PIPELINE_COMPLETED,
        title:
          success === entries.length
            ? `${success} new ${strategyWord} ready for live trading`
            : `${success} of ${entries.length} strategies ready for live trading`,
        body,
        severity: 'info',
        payload: basePayload
      };
    }

    // success === 0 below.
    if (rejectedOrFailed === 0 && inconclusive > 0) {
      return {
        eventType: NotificationEventType.PIPELINE_REJECTED,
        title: `${inconclusive} strategies: not enough trading opportunities`,
        body: `We'll retry with fresh parameters — no action needed from you.`,
        severity: 'low',
        payload: basePayload
      };
    }

    if (inconclusive === 0 && rejectedOrFailed > 0) {
      let title: string;
      if (failed === 0) {
        title = `${rejected} strategies didn't pass review`;
      } else if (rejected === 0) {
        title = `${failed} strategies couldn't finish building`;
      } else {
        title = `${rejectedOrFailed} strategies finished with issues`;
      }
      return {
        eventType: NotificationEventType.PIPELINE_REJECTED,
        title,
        body: this.formatMixedTerminalBody(0, rejected, failed, 0),
        severity: 'medium',
        payload: basePayload
      };
    }

    // Mixed rejected/failed + inconclusive, no success.
    return {
      eventType: NotificationEventType.PIPELINE_REJECTED,
      title: `Your strategies didn't complete successfully`,
      body: this.formatMixedTerminalBody(success, rejected, failed, inconclusive),
      severity: 'medium',
      payload: basePayload
    };
  }

  private buildSingleTerminalAggregate(entry: DigestEntry, basePayload: Record<string, unknown>): AggregatedPayload {
    const strategyPayload = { ...basePayload, strategyName: entry.strategyName };

    if (entry.subType === 'failed') {
      return {
        eventType: NotificationEventType.PIPELINE_REJECTED,
        title: `A strategy couldn't finish building`,
        body: `We'll try again on the next cycle — no action needed.`,
        severity: 'medium',
        payload: { ...strategyPayload, reason: entry.reason }
      };
    }

    if (entry.subType === 'rejected') {
      return {
        eventType: NotificationEventType.PIPELINE_REJECTED,
        title: `A strategy didn't pass the safety review`,
        body: `We'll try a different approach on your next cycle — no action needed.`,
        severity: 'medium',
        payload: { ...strategyPayload, reason: entry.reason }
      };
    }

    // subType === 'completed'
    if (entry.recommendation === DeploymentRecommendation.DO_NOT_DEPLOY) {
      return {
        eventType: NotificationEventType.PIPELINE_REJECTED,
        title: `A strategy didn't pass the safety review`,
        body: `We'll try a different approach on your next cycle — no action needed.`,
        severity: 'medium',
        payload: { ...strategyPayload, reason: entry.reason ?? 'Failed final review' }
      };
    }

    if (entry.recommendation === DeploymentRecommendation.INCONCLUSIVE_RETRY || entry.inconclusive === true) {
      return {
        eventType: NotificationEventType.PIPELINE_REJECTED,
        title: `Not enough trading opportunities`,
        body: `We'll retry with fresh parameters — no action needed from you.`,
        severity: 'low',
        payload: { ...strategyPayload, reason: entry.reason ?? 'Insufficient trading signals' }
      };
    }

    return {
      eventType: NotificationEventType.PIPELINE_COMPLETED,
      title: `A new strategy is ready for live trading`,
      body: `It passed every check and is being activated on your account.`,
      severity: 'info',
      payload: strategyPayload
    };
  }

  private formatMixedTerminalBody(success: number, rejected: number, failed: number, inconclusive: number): string {
    const clauses: string[] = [];
    if (success > 0) clauses.push(`${success} ready for live trading`);
    if (rejected > 0) clauses.push(`${rejected} didn't pass review`);
    if (failed > 0) clauses.push(`${failed} couldn't finish building`);
    if (inconclusive > 0) clauses.push(`${inconclusive} inconclusive (will retry)`);
    return `${clauses.join(', ')}.`;
  }

  private baseBatchPayload(entries: DigestEntry[]): Record<string, unknown> {
    return {
      userId: entries[0].userId,
      pipelineIds: entries.map((e) => e.pipelineId),
      strategyNames: entries.map((e) => e.strategyName),
      count: entries.length
    };
  }

  private describeStrategyList(entries: DigestEntry[]): string {
    const names = entries.map((e) => e.strategyName);
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 3).join(', ')}…`;
  }
}
