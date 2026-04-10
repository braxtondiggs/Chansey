import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class UpdateBacktestPrecisionAndIndexes1775195735827 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // backtests: scale 8 columns
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "initialCapital" TYPE numeric(25,8)`);
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "finalValue" TYPE numeric(25,8)`);

    // backtests: scale 4 columns
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "totalReturn" TYPE numeric(25,4)`);
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "annualizedReturn" TYPE numeric(25,4)`);
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "sharpeRatio" TYPE numeric(25,4)`);
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "maxDrawdown" TYPE numeric(25,4)`);
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "winRate" TYPE numeric(25,4)`);

    // backtest_trades
    await queryRunner.query(`ALTER TABLE "backtest_trades" ALTER COLUMN "quantity" TYPE numeric(25,8)`);
    await queryRunner.query(`ALTER TABLE "backtest_trades" ALTER COLUMN "price" TYPE numeric(25,8)`);
    await queryRunner.query(`ALTER TABLE "backtest_trades" ALTER COLUMN "totalValue" TYPE numeric(25,8)`);
    await queryRunner.query(`ALTER TABLE "backtest_trades" ALTER COLUMN "fee" TYPE numeric(25,8)`);
    await queryRunner.query(`ALTER TABLE "backtest_trades" ALTER COLUMN "realizedPnL" TYPE numeric(25,8)`);
    await queryRunner.query(`ALTER TABLE "backtest_trades" ALTER COLUMN "costBasis" TYPE numeric(25,8)`);

    // backtest_signals
    await queryRunner.query(`ALTER TABLE "backtest_signals" ALTER COLUMN "quantity" TYPE numeric(25,8)`);
    await queryRunner.query(`ALTER TABLE "backtest_signals" ALTER COLUMN "price" TYPE numeric(25,8)`);

    // backtest_performance_snapshots
    await queryRunner.query(
      `ALTER TABLE "backtest_performance_snapshots" ALTER COLUMN "portfolioValue" TYPE numeric(25,8)`
    );
    await queryRunner.query(
      `ALTER TABLE "backtest_performance_snapshots" ALTER COLUMN "cashBalance" TYPE numeric(25,8)`
    );

    // simulated_order_fills
    await queryRunner.query(`ALTER TABLE "simulated_order_fills" ALTER COLUMN "filledQuantity" TYPE numeric(25,8)`);
    await queryRunner.query(`ALTER TABLE "simulated_order_fills" ALTER COLUMN "averagePrice" TYPE numeric(25,8)`);
    await queryRunner.query(`ALTER TABLE "simulated_order_fills" ALTER COLUMN "fees" TYPE numeric(25,8)`);

    // Composite indexes
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_backtest_signals_backtest_instrument" ON "backtest_signals" ("backtestId", "instrument")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_simulated_order_fills_backtest_instrument" ON "simulated_order_fills" ("backtestId", "instrument")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop composite indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_simulated_order_fills_backtest_instrument"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_backtest_signals_backtest_instrument"`);

    // Revert simulated_order_fills
    await queryRunner.query(`ALTER TABLE "simulated_order_fills" ALTER COLUMN "fees" TYPE numeric(18,8)`);
    await queryRunner.query(`ALTER TABLE "simulated_order_fills" ALTER COLUMN "averagePrice" TYPE numeric(18,8)`);
    await queryRunner.query(`ALTER TABLE "simulated_order_fills" ALTER COLUMN "filledQuantity" TYPE numeric(18,8)`);

    // Revert backtest_performance_snapshots
    await queryRunner.query(
      `ALTER TABLE "backtest_performance_snapshots" ALTER COLUMN "cashBalance" TYPE numeric(18,8)`
    );
    await queryRunner.query(
      `ALTER TABLE "backtest_performance_snapshots" ALTER COLUMN "portfolioValue" TYPE numeric(18,8)`
    );

    // Revert backtest_signals
    await queryRunner.query(`ALTER TABLE "backtest_signals" ALTER COLUMN "price" TYPE numeric(18,8)`);
    await queryRunner.query(`ALTER TABLE "backtest_signals" ALTER COLUMN "quantity" TYPE numeric(18,8)`);

    // Revert backtest_trades
    await queryRunner.query(`ALTER TABLE "backtest_trades" ALTER COLUMN "costBasis" TYPE numeric(18,8)`);
    await queryRunner.query(`ALTER TABLE "backtest_trades" ALTER COLUMN "realizedPnL" TYPE numeric(18,8)`);
    await queryRunner.query(`ALTER TABLE "backtest_trades" ALTER COLUMN "fee" TYPE numeric(18,8)`);
    await queryRunner.query(`ALTER TABLE "backtest_trades" ALTER COLUMN "totalValue" TYPE numeric(18,8)`);
    await queryRunner.query(`ALTER TABLE "backtest_trades" ALTER COLUMN "price" TYPE numeric(18,8)`);
    await queryRunner.query(`ALTER TABLE "backtest_trades" ALTER COLUMN "quantity" TYPE numeric(18,8)`);

    // Revert backtests scale 4
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "winRate" TYPE numeric(18,4)`);
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "maxDrawdown" TYPE numeric(18,4)`);
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "sharpeRatio" TYPE numeric(18,4)`);
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "annualizedReturn" TYPE numeric(18,4)`);
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "totalReturn" TYPE numeric(18,4)`);

    // Revert backtests scale 8
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "finalValue" TYPE numeric(18,8)`);
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "initialCapital" TYPE numeric(18,8)`);
  }
}
