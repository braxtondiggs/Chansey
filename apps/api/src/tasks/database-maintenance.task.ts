import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { toErrorInfo } from '../shared/error.util';

/**
 * Database Maintenance Task
 *
 * Runs `ANALYZE` nightly on hot tables as a safety net in case Railway's
 * shared autovacuum workers don't get to us. Keeps planner statistics fresh
 * so the query planner continues to pick index scans over seq scans.
 *
 * Runs at 4:30 AM UTC daily (right after RedisMaintenanceTask at 4 AM).
 */
@Injectable()
export class DatabaseMaintenanceTask {
  private readonly logger = new Logger(DatabaseMaintenanceTask.name);
  private running = false;

  private static readonly HOT_TABLES = [
    'ohlc_candles',
    'backtest_signals',
    'backtest_trades',
    'pipelines',
    'paper_trading_accounts',
    'paper_trading_sessions',
    'paper_trading_signals',
    'strategy_configs',
    'backtests',
    'optimization_runs',
    'coin'
  ];

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Cron('30 4 * * *', { timeZone: 'UTC' })
  async runMaintenance(): Promise<void> {
    if (this.running) {
      this.logger.warn('Database maintenance already running, skipping');
      return;
    }

    this.running = true;
    try {
      this.logger.log('Starting database maintenance (ANALYZE hot tables)');
      const startTime = Date.now();
      let analyzed = 0;

      for (const table of DatabaseMaintenanceTask.HOT_TABLES) {
        try {
          await this.dataSource.query(`ANALYZE "${table}"`);
          analyzed++;
        } catch (error: unknown) {
          const err = toErrorInfo(error);
          this.logger.error(`Failed to ANALYZE "${table}": ${err.message}`);
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(
        `Database maintenance complete: ${analyzed}/${DatabaseMaintenanceTask.HOT_TABLES.length} tables analyzed in ${elapsed}s`
      );
    } finally {
      this.running = false;
    }
  }
}
