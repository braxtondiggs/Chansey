import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add standalone indexes on backtestId for backtest_signals and backtest_trades.
 *
 * Postgres analysis showed 85.6% sequential scans on backtest_signals and
 * 164M tuple reads via seq scan on backtest_trades. The existing composite
 * indexes (backtestId, timestamp) and (backtestId, executedAt) don't cover
 * backtestId-only lookups efficiently. These standalone indexes address the
 * dominant query pattern: loading all signals/trades for a given backtest.
 *
 * Uses CONCURRENTLY to avoid locking tables during creation.
 */
export class AddBacktestPerformanceIndexes1739300000000 implements MigrationInterface {
  name = 'AddBacktestPerformanceIndexes1739300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_backtest_signals_backtest_id" ON "backtest_signals" ("backtestId")`
    );
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_backtest_trades_backtest_id" ON "backtest_trades" ("backtestId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_backtest_trades_backtest_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_backtest_signals_backtest_id"`);
  }
}
