import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';

import { Job } from 'bullmq';

import { FailedJobService } from './failed-job.service';

import { toErrorInfo } from '../shared/error.util';

/**
 * Metadata key set by `@Processor()` from `@nestjs/bullmq` — see
 * `node_modules/@nestjs/bullmq/dist/bull.constants.js`. The decorator stores
 * `{ name: '<queue-name>' }` on the constructor, so we read it via
 * `Reflect.getMetadata` to derive `queueName` automatically. This makes
 * subclasses single-source-of-truth on their `@Processor()` decorator and
 * eliminates the possibility of drift between two literal strings.
 */
const PROCESSOR_METADATA_KEY = 'bullmq:processor_metadata';

/**
 * Abstract base for BullMQ workers that auto-records terminal failures to
 * `failed_job_logs`. Subclasses just need to extend this class and pass
 * `FailedJobService` to `super()` — the queue name is read from the
 * `@Processor()` decorator metadata at runtime.
 *
 * BullMQ's `failed` event fires on every retry attempt — this base class
 * filters interim failures so only the terminal attempt is persisted.
 */
export abstract class FailSafeWorkerHost extends WorkerHost {
  private readonly failSafeLogger = new Logger(FailSafeWorkerHost.name);

  constructor(protected readonly failedJobService: FailedJobService) {
    super();
  }

  /**
   * Resolve the queue name from `@Processor()` decorator metadata on the
   * concrete subclass. Falls back to 'unknown' if metadata is missing.
   */
  private resolveQueueName(): string {
    const meta = Reflect.getMetadata(PROCESSOR_METADATA_KEY, this.constructor) as { name?: string } | undefined;
    return meta?.name ?? 'unknown';
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, error: Error): Promise<void> {
    const attemptsMade = job.attemptsMade ?? 0;
    const maxAttempts = job.opts?.attempts ?? 1;

    // Skip interim retries — record only the terminal failure to avoid
    // N rows per job for jobs configured with `attempts: N`.
    if (attemptsMade < maxAttempts) return;

    const queueName = this.resolveQueueName();

    try {
      await this.failedJobService.recordFailure({
        queueName,
        jobId: job.id ?? 'unknown',
        jobName: job.name,
        jobData: job.data,
        errorMessage: error.message,
        stackTrace: error.stack,
        attemptsMade,
        maxAttempts
      });
    } catch (caught: unknown) {
      // recordFailure is internally fail-safe; this outer catch guards
      // against future regression. Always log so the regression is visible.
      const err = toErrorInfo(caught);
      this.failSafeLogger.error(
        `Outer fail-safe triggered for queue "${queueName}" job ${job.id}: ${err.message}`,
        err.stack
      );
    }
  }
}
