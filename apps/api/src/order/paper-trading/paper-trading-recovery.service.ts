import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { PaperTradingService } from './paper-trading.service';

@Injectable()
export class PaperTradingRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PaperTradingRecoveryService.name);

  constructor(private readonly paperTradingService: PaperTradingService) {}

  async onApplicationBootstrap(): Promise<void> {
    // OnApplicationBootstrap is called after all modules are initialized
    // This is the proper lifecycle hook for recovery operations
    await this.recoverActiveSessions();
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
          // Re-schedule tick jobs for the session
          await this.paperTradingService.scheduleTickJob(session.id, session.user?.id ?? '', session.tickIntervalMs);

          this.logger.log(`Recovered paper trading session ${session.id}`);
        } catch (error) {
          this.logger.error(`Failed to recover paper trading session ${session.id}: ${error.message}`, error.stack);

          // Mark as failed if recovery fails
          try {
            await this.paperTradingService.markFailed(session.id, `Recovery failed: ${error.message}`);
          } catch (markError) {
            this.logger.error(`Failed to mark session ${session.id} as failed: ${markError.message}`);
          }
        }
      }

      this.logger.log(`Paper trading session recovery complete`);
    } catch (error) {
      this.logger.error(`Paper trading session recovery failed: ${error.message}`, error.stack);
    }
  }
}
