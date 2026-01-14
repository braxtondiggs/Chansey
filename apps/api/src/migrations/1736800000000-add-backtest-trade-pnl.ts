import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBacktestTradePnl1736800000000 implements MigrationInterface {
  name = 'AddBacktestTradePnl1736800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add realized P&L column - dollar amount of profit/loss for SELL trades
    await queryRunner.query(`
      ALTER TABLE "backtest_trades"
      ADD COLUMN IF NOT EXISTS "realizedPnL" decimal(18,8)
    `);

    // Add realized P&L percentage column - percentage gain/loss
    await queryRunner.query(`
      ALTER TABLE "backtest_trades"
      ADD COLUMN IF NOT EXISTS "realizedPnLPercent" decimal(10,6)
    `);

    // Add cost basis column - entry price at time of trade
    await queryRunner.query(`
      ALTER TABLE "backtest_trades"
      ADD COLUMN IF NOT EXISTS "costBasis" decimal(18,8)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "backtest_trades"
      DROP COLUMN IF EXISTS "costBasis"
    `);

    await queryRunner.query(`
      ALTER TABLE "backtest_trades"
      DROP COLUMN IF EXISTS "realizedPnLPercent"
    `);

    await queryRunner.query(`
      ALTER TABLE "backtest_trades"
      DROP COLUMN IF EXISTS "realizedPnL"
    `);
  }
}
