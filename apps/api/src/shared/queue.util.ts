import { Logger } from '@nestjs/common';

import { type Queue } from 'bullmq';

import { toErrorInfo } from './error.util';

const defaultLogger = new Logger('QueueUtil');

/**
 * Force-remove a job from the queue, clearing stale locks from dead workers if needed.
 * After a deployment, the old worker process is gone but its Redis lock on active jobs
 * persists until lockDuration expires. job.remove() fails on locked jobs, so we
 * transition the job to failed state via moveToFailed() and then remove it.
 *
 * Safe to call even if the job doesn't exist (no-op).
 */
export async function forceRemoveJob(queue: Queue, jobId: string, logger?: Logger): Promise<void> {
  const log = logger ?? defaultLogger;

  const existingJob = await queue.getJob(jobId);
  if (!existingJob) return;

  try {
    await existingJob.remove();
    log.log(`Removed existing job ${jobId} from queue before re-queuing`);
    return;
  } catch (error: unknown) {
    const err = toErrorInfo(error);
    log.log(`Initial remove for job ${jobId} failed (${err.message}), attempting force-remove`);
  }

  // Transition the active job to failed via BullMQ's sanctioned API, then remove it.
  // Simply deleting the lock key is insufficient — the job remains in BullMQ's active
  // sorted set, so queue.add() with the same jobId is silently deduplicated (no-op).
  // moveToFailed() atomically removes from active set, adds to failed set, and clears the lock.
  try {
    const client = await queue.client;
    const prefix = queue.opts?.prefix ?? 'bull';
    const lockKey = `${prefix}:${queue.name}:${jobId}:lock`;

    // Set a recovery lock token so moveToFailed's token check passes
    const recoveryToken = `recovery-${Date.now()}`;
    await client.set(lockKey, recoveryToken);
    await existingJob.moveToFailed(new Error('Orphaned after deployment'), recoveryToken, false);
    log.log(`Moved orphaned job ${jobId} to failed state`);

    // Now remove the failed job so queue.add() can reuse the jobId
    await existingJob.remove();
    log.log(`Removed failed job ${jobId} after moveToFailed`);
  } catch (forceError: unknown) {
    const err = toErrorInfo(forceError);
    log.warn(`Could not force-remove job ${jobId}: ${err.message}`);
  }
}
