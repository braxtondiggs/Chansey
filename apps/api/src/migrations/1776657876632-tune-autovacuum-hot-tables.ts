import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class TuneAutovacuumHotTables1776657876632 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ohlc_candles" SET (
        autovacuum_vacuum_scale_factor = 0.05,
        autovacuum_analyze_scale_factor = 0.02,
        autovacuum_analyze_threshold = 500
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "backtest_signals" SET (
        autovacuum_analyze_scale_factor = 0.02,
        autovacuum_analyze_threshold = 500
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "backtest_trades" SET (
        autovacuum_analyze_scale_factor = 0.02,
        autovacuum_analyze_threshold = 500
      )
    `);
    await queryRunner.query(`ALTER TABLE "pipelines" SET (autovacuum_analyze_threshold = 50)`);
    await queryRunner.query(`ALTER TABLE "paper_trading_accounts" SET (autovacuum_analyze_threshold = 50)`);
    await queryRunner.query(`ALTER TABLE "paper_trading_signals" SET (autovacuum_analyze_scale_factor = 0.02)`);
    await queryRunner.query(`ALTER TABLE "strategy_configs" SET (autovacuum_analyze_threshold = 10)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ohlc_candles" RESET (
        autovacuum_vacuum_scale_factor,
        autovacuum_analyze_scale_factor,
        autovacuum_analyze_threshold
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "backtest_signals" RESET (
        autovacuum_analyze_scale_factor,
        autovacuum_analyze_threshold
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "backtest_trades" RESET (
        autovacuum_analyze_scale_factor,
        autovacuum_analyze_threshold
      )
    `);
    await queryRunner.query(`ALTER TABLE "pipelines" RESET (autovacuum_analyze_threshold)`);
    await queryRunner.query(`ALTER TABLE "paper_trading_accounts" RESET (autovacuum_analyze_threshold)`);
    await queryRunner.query(`ALTER TABLE "paper_trading_signals" RESET (autovacuum_analyze_scale_factor)`);
    await queryRunner.query(`ALTER TABLE "strategy_configs" RESET (autovacuum_analyze_threshold)`);
  }
}
