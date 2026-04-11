import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { Queue } from 'bullmq';

import { PaperTradingStatus } from './entities';
import { PaperTradingCleanupService } from './paper-trading-cleanup.service';
import { PaperTradingEngineService } from './paper-trading-engine.service';
import { PaperTradingJobService } from './paper-trading-job.service';

import { toErrorInfo } from '../../shared/error.util';

@Injectable()
export class PaperTradingRecoveryService implements OnApplicationBootstrap {
  private static readonly BOOT_GRACE_PERIOD_MS = 10 * 60 * 1000; // 10 min
  private static readonly STALE_RECOVERY_THRESHOLD_MS = 10 * 60 * 1000; // 10 min — attempt recovery
  private static readonly STALE_FAIL_THRESHOLD_MS = 20 * 60 * 1000; // 20 min — mark FAILED

  private static readonly TERMINAL_STATUSES: ReadonlySet<PaperTradingStatus> = new Set([
    PaperTradingStatus.FAILED,
    PaperTradingStatus.STOPPED,
    PaperTradingStatus.COMPLETED
  ]);

  private readonly logger = new Logger(PaperTradingRecoveryService.name);
  private readonly bootedAt = Date.now();

  constructor(
    private readonly jobService: PaperTradingJobService,
    private readonly engineService: PaperTradingEngineService,
    private readonly cleanupService: PaperTradingCleanupService,
    @InjectQueue('paper-trading') private readonly paperTradingQueue: Queue
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // OnApplicationBootstrap is called after all modules are initialized
    // This is the proper lifecycle hook for recovery operations.
    //
    // Order matters:
    //   1. cleanupOrphanedSchedulers — removes legacy schedulers for terminal sessions
    //   2. cleanupDuplicateActiveSessions — stops duplicates so step 3 doesn't re-schedule them
    //   3. recoverActiveSessions — re-schedules tick jobs for the survivors
    await this.cleanupOrphanedSchedulers();
    // TODO: remove cleanupDuplicateActiveSessions once the 31 legacy duplicate sessions are
    // cleared. Leaving this in long-term is risky — it would silently mask any future bug
    // that re-introduces overlapping sessions instead of letting it surface loudly.
    await this.cleanupDuplicateActiveSessions();
    await this.recoverActiveSessions();
  }

  /**
   * One-shot self-healing pass for overlapping paper-trading sessions.
   *
   * Delegates to {@link PaperTradingCleanupService.cleanupDuplicateSessions}, which keeps the
   * oldest session per `(userId, algorithmId)` group and stops the rest via the normal `stop()`
   * flow (so per-session BullMQ tick schedulers and in-memory throttle/exit state are cleaned up).
   * Linked pipelines are cancelled.
   *
   * TODO: delete this method (and its bootstrap call) — along with `PaperTradingCleanupService`
   * itself — after the legacy duplicate sessions are cleared in production. The orchestration-level
   * guard (`PipelineOrchestrationService.checkDuplicate`) and the `startFromPipeline` defense-in-depth
   * check are the intended long-term protection. Keeping a silent boot-time fix would hide
   * regressions that should fail loudly instead.
   *
   * Idempotent — a no-op when no duplicates exist, so it's safe to run on every boot until removed.
   * Errors are logged but never rethrown so they don't block the rest of the boot sequence.
   */
  private async cleanupDuplicateActiveSessions(): Promise<void> {
    try {
      const result = await this.cleanupService.cleanupDuplicateSessions(false);
      if (result.stopped.length > 0) {
        this.logger.warn(
          `Duplicate session cleanup: scanned=${result.scanned}, kept=${result.kept}, stopped=${result.stopped.length}`
        );
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Duplicate session cleanup failed: ${err.message}`, err.stack);
    }
  }

  /**
   * Watchdog that detects stale ACTIVE paper trading sessions during normal operation.
   *
   * Uses lastTickAt as the heartbeat signal (updated only on successful ticks, NOT by re-scheduling).
   * Falls back to updatedAt when lastTickAt is null (session activated but never completed a first tick).
   *
   * Two-tier staleness model:
   *   10 min stale → attempt recovery (removeTickJobs + scheduleTickJob)
   *   20 min stale → mark FAILED (recovery didn't help)
   *
   * Errors on individual sessions do not abort the loop.
   */
  @Cron('*/5 * * * *')
  async detectStaleSessions(): Promise<void> {
    const timeSinceBoot = Date.now() - this.bootedAt;
    if (timeSinceBoot < PaperTradingRecoveryService.BOOT_GRACE_PERIOD_MS) {
      this.logger.debug(
        `Skipping stale session detection — server booted ${Math.round(timeSinceBoot / 1000)}s ago ` +
          `(grace period: ${PaperTradingRecoveryService.BOOT_GRACE_PERIOD_MS / 60000} min)`
      );
      return;
    }

    const activeSessions = await this.jobService.findActiveSessions();

    if (activeSessions.length === 0) {
      return;
    }

    const now = Date.now();
    const recoveryCutoff = now - PaperTradingRecoveryService.STALE_RECOVERY_THRESHOLD_MS;
    const failCutoff = now - PaperTradingRecoveryService.STALE_FAIL_THRESHOLD_MS;

    let recovered = 0;
    let failed = 0;

    for (const session of activeSessions) {
      try {
        const heartbeat = session.lastTickAt ?? session.updatedAt;
        const heartbeatMs = new Date(heartbeat).getTime();

        if (heartbeatMs < failCutoff) {
          // 20+ min stale — recovery didn't help, mark FAILED
          await this.jobService.markFailed(
            session.id,
            `Session stale for 20+ minutes (last heartbeat: ${new Date(heartbeat).toISOString()})`
          );
          failed++;
        } else if (heartbeatMs < recoveryCutoff) {
          // 10-20 min stale — attempt recovery
          await this.jobService.removeTickJobs(session.id);
          await this.jobService.scheduleTickJob(session.id, session.user?.id ?? '', session.tickIntervalMs);
          recovered++;
          this.logger.warn(
            `Recovered stale paper trading session ${session.id} (last heartbeat: ${new Date(heartbeat).toISOString()})`
          );
        }
        // else: healthy — skip
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Failed to process stale session ${session.id}: ${err.message}`, err.stack);
      }
    }

    if (recovered > 0 || failed > 0) {
      this.logger.log(`Stale session watchdog: recovered=${recovered}, failed=${failed}`);
    }

    // Sweep in-memory state for sessions that no longer exist
    const activeIds = new Set(activeSessions.map((s) => s.id));
    const swept = this.engineService.sweepOrphanedState(activeIds);
    if (swept > 0) {
      this.logger.log(`Swept ${swept} orphaned in-memory state entries`);
    }
  }

  /**
   * One-time cleanup of legacy repeatable jobs created by the old queue.add({ repeat }) API.
   * Those schedulers are stored under an MD5 hash key, so removeJobScheduler(jobId) never matches them.
   * This method uses the legacy getRepeatableJobs() / removeRepeatableByKey() APIs to remove them
   * for sessions that are already in a terminal state (FAILED / STOPPED / COMPLETED).
   */
  private async cleanupOrphanedSchedulers(): Promise<void> {
    try {
      const repeatableJobs = await this.paperTradingQueue.getRepeatableJobs();

      if (repeatableJobs.length === 0) return;

      let cleaned = 0;

      for (const job of repeatableJobs) {
        // Extract sessionId from the legacy jobId (format: "paper-trading-tick-{sessionId}")
        const match = (job.id ?? '').match(/^paper-trading-tick-(.+)$/);
        if (!match) continue;

        const sessionId = match[1];

        try {
          const { status } = await this.jobService.getSessionStatus(sessionId);

          if (PaperTradingRecoveryService.TERMINAL_STATUSES.has(status as PaperTradingStatus)) {
            await this.paperTradingQueue.removeRepeatableByKey(job.key);
            cleaned++;
            this.logger.log(`Removed orphaned legacy scheduler for terminal session ${sessionId} (status: ${status})`);
          }
        } catch (error: unknown) {
          if (error instanceof NotFoundException) {
            // Session not found in DB — safe to remove the orphaned scheduler
            await this.paperTradingQueue.removeRepeatableByKey(job.key);
            cleaned++;
            this.logger.log(`Removed orphaned legacy scheduler for missing session ${sessionId}`);
          } else {
            const err = toErrorInfo(error);
            this.logger.warn(`Failed to check session ${sessionId} for orphan cleanup: ${err.message}`);
          }
        }
      }

      if (cleaned > 0) {
        this.logger.log(`Orphaned scheduler cleanup complete: removed ${cleaned} legacy repeatable job(s)`);
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Orphaned scheduler cleanup failed: ${err.message}`, err.stack);
    }
  }

  /**
   * Recover active paper trading sessions after server restart
   * Re-schedules tick jobs for any sessions that were active
   */
  private async recoverActiveSessions(): Promise<void> {
    this.logger.log('Checking for active paper trading sessions to recover...');

    try {
      const activeSessions = await this.jobService.findActiveSessions();

      if (activeSessions.length === 0) {
        this.logger.log('No active paper trading sessions to recover');
        return;
      }

      this.logger.log(`Found ${activeSessions.length} active paper trading session(s) to recover`);

      for (const session of activeSessions) {
        try {
          // Remove stale tick job schedulers before re-scheduling to prevent duplicates
          await this.jobService.removeTickJobs(session.id);
          await this.jobService.scheduleTickJob(session.id, session.user?.id ?? '', session.tickIntervalMs);

          this.logger.log(`Recovered paper trading session ${session.id}`);
        } catch (error: unknown) {
          const err = toErrorInfo(error);
          this.logger.error(`Failed to recover paper trading session ${session.id}: ${err.message}`, err.stack);

          // Mark as failed if recovery fails
          try {
            await this.jobService.markFailed(session.id, `Recovery failed: ${err.message}`);
          } catch (markError: unknown) {
            const err = toErrorInfo(markError);
            this.logger.error(`Failed to mark session ${session.id} as failed: ${err.message}`);
          }
        }
      }

      this.logger.log(`Paper trading session recovery complete`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Paper trading session recovery failed: ${err.message}`, err.stack);
    }
  }
}
