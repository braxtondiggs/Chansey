import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PaperTradingService } from './paper-trading.service';

import { toErrorInfo } from '../../shared/error.util';

@Injectable()
export class PaperTradingRecoveryService implements OnApplicationBootstrap {
  private static readonly BOOT_GRACE_PERIOD_MS = 10 * 60 * 1000; // 10 min
  private static readonly STALE_RECOVERY_THRESHOLD_MS = 10 * 60 * 1000; // 10 min — attempt recovery
  private static readonly STALE_FAIL_THRESHOLD_MS = 20 * 60 * 1000; // 20 min — mark FAILED

  private readonly logger = new Logger(PaperTradingRecoveryService.name);
  private readonly bootedAt = Date.now();

  constructor(private readonly paperTradingService: PaperTradingService) {}

  async onApplicationBootstrap(): Promise<void> {
    // OnApplicationBootstrap is called after all modules are initialized
    // This is the proper lifecycle hook for recovery operations
    await this.recoverActiveSessions();
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

    const activeSessions = await this.paperTradingService.findActiveSessions();

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
          await this.paperTradingService.markFailed(
            session.id,
            `Session stale for 20+ minutes (last heartbeat: ${new Date(heartbeat).toISOString()})`
          );
          failed++;
        } else if (heartbeatMs < recoveryCutoff) {
          // 10-20 min stale — attempt recovery
          await this.paperTradingService.removeTickJobs(session.id);
          await this.paperTradingService.scheduleTickJob(session.id, session.user?.id ?? '', session.tickIntervalMs);
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
  }

  /**
   * Recover active paper trading sessions after server restart
   * Re-schedules tick jobs for any sessions that were active
   */
  private async recoverActiveSessions(): Promise<void> {
    this.logger.log('Checking for active paper trading sessions to recover...');

    try {
      const activeSessions = await this.paperTradingService.findActiveSessions();

      if (activeSessions.length === 0) {
        this.logger.log('No active paper trading sessions to recover');
        return;
      }

      this.logger.log(`Found ${activeSessions.length} active paper trading session(s) to recover`);

      for (const session of activeSessions) {
        try {
          // Remove stale tick job schedulers before re-scheduling to prevent duplicates
          await this.paperTradingService.removeTickJobs(session.id);
          await this.paperTradingService.scheduleTickJob(session.id, session.user?.id ?? '', session.tickIntervalMs);

          this.logger.log(`Recovered paper trading session ${session.id}`);
        } catch (error: unknown) {
          const err = toErrorInfo(error);
          this.logger.error(`Failed to recover paper trading session ${session.id}: ${err.message}`, err.stack);

          // Mark as failed if recovery fails
          try {
            await this.paperTradingService.markFailed(session.id, `Recovery failed: ${err.message}`);
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
