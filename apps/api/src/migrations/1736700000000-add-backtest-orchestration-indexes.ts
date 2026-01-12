import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration to add indexes for backtest orchestration deduplication queries.
 *
 * - IDX_backtest_user_algo_created: Optimizes deduplication queries for
 *   finding existing backtests by user/algorithm within a time window.
 *
 * - IDX_user_algo_trading_enabled: Optimizes the query for finding
 *   eligible users with algo trading enabled.
 */
export class AddBacktestOrchestrationIndexes1736700000000 implements MigrationInterface {
  name = 'AddBacktestOrchestrationIndexes1736700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Composite index for deduplication queries
    // Used to efficiently find recent backtests for the same user/algorithm combination
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_backtest_user_algo_created"
      ON "backtests" ("userId", "algorithmId", "createdAt" DESC)
    `);

    // Partial index for eligible users query
    // Only indexes users with algo trading enabled for faster lookups
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_algo_trading_enabled"
      ON "user" ("algoTradingEnabled")
      WHERE "algoTradingEnabled" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_backtest_user_algo_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_algo_trading_enabled"`);
  }
}
