import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widen numeric precision on backtest/optimization columns to prevent overflow.
 *
 * Root cause: walk-forward windows with short test periods produce annualized
 * returns that exceed numeric(8,4) (max 9,999.9999). For example, 200% over
 * 20 days annualizes to ~1.4 billion percent.
 *
 * All return/ratio/score columns are widened from (8,4) or (10,4) to (18,4),
 * which supports values up to 99,999,999,999,999.9999 — effectively unlimited
 * for financial metrics.
 */
export class WidenNumericPrecision1739200000000 implements MigrationInterface {
  name = 'WidenNumericPrecision1739200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // backtests — the primary offender (numeric(8,4) → numeric(18,4))
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "totalReturn" TYPE NUMERIC(18, 4)`);
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "annualizedReturn" TYPE NUMERIC(18, 4)`);
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "sharpeRatio" TYPE NUMERIC(18, 4)`);
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "maxDrawdown" TYPE NUMERIC(18, 4)`);
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "winRate" TYPE NUMERIC(18, 4)`);

    // backtest_performance_snapshots (numeric(8,4) → numeric(18,4))
    await queryRunner.query(
      `ALTER TABLE "backtest_performance_snapshots" ALTER COLUMN "cumulativeReturn" TYPE NUMERIC(18, 4)`
    );
    await queryRunner.query(`ALTER TABLE "backtest_performance_snapshots" ALTER COLUMN "drawdown" TYPE NUMERIC(18, 4)`);

    // paper_trading_sessions (numeric(8,4) → numeric(18,4))
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" ALTER COLUMN "totalReturn" TYPE NUMERIC(18, 4)`);
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" ALTER COLUMN "sharpeRatio" TYPE NUMERIC(18, 4)`);
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" ALTER COLUMN "maxDrawdown" TYPE NUMERIC(18, 4)`);
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" ALTER COLUMN "winRate" TYPE NUMERIC(18, 4)`);

    // paper_trading_snapshots (numeric(8,4) → numeric(18,4))
    await queryRunner.query(
      `ALTER TABLE "paper_trading_snapshots" ALTER COLUMN "cumulativeReturn" TYPE NUMERIC(18, 4)`
    );
    await queryRunner.query(`ALTER TABLE "paper_trading_snapshots" ALTER COLUMN "drawdown" TYPE NUMERIC(18, 4)`);

    // optimization_results (numeric(10,4) → numeric(18,4))
    await queryRunner.query(`ALTER TABLE "optimization_results" ALTER COLUMN "avgTrainScore" TYPE NUMERIC(18, 4)`);
    await queryRunner.query(`ALTER TABLE "optimization_results" ALTER COLUMN "avgTestScore" TYPE NUMERIC(18, 4)`);
    await queryRunner.query(`ALTER TABLE "optimization_results" ALTER COLUMN "avgDegradation" TYPE NUMERIC(18, 4)`);
    await queryRunner.query(`ALTER TABLE "optimization_results" ALTER COLUMN "consistencyScore" TYPE NUMERIC(18, 4)`);

    // optimization_runs (numeric(10,4) → numeric(18,4))
    await queryRunner.query(`ALTER TABLE "optimization_runs" ALTER COLUMN "baselineScore" TYPE NUMERIC(18, 4)`);
    await queryRunner.query(`ALTER TABLE "optimization_runs" ALTER COLUMN "bestScore" TYPE NUMERIC(18, 4)`);
    await queryRunner.query(`ALTER TABLE "optimization_runs" ALTER COLUMN "improvement" TYPE NUMERIC(18, 4)`);

    // walk_forward_windows (numeric(10,4) → numeric(18,4))
    await queryRunner.query(`ALTER TABLE "walk_forward_windows" ALTER COLUMN "degradation" TYPE NUMERIC(18, 4)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert walk_forward_windows
    await queryRunner.query(`ALTER TABLE "walk_forward_windows" ALTER COLUMN "degradation" TYPE NUMERIC(10, 4)`);

    // Revert optimization_runs
    await queryRunner.query(`ALTER TABLE "optimization_runs" ALTER COLUMN "improvement" TYPE NUMERIC(10, 4)`);
    await queryRunner.query(`ALTER TABLE "optimization_runs" ALTER COLUMN "bestScore" TYPE NUMERIC(10, 4)`);
    await queryRunner.query(`ALTER TABLE "optimization_runs" ALTER COLUMN "baselineScore" TYPE NUMERIC(10, 4)`);

    // Revert optimization_results
    await queryRunner.query(`ALTER TABLE "optimization_results" ALTER COLUMN "consistencyScore" TYPE NUMERIC(10, 4)`);
    await queryRunner.query(`ALTER TABLE "optimization_results" ALTER COLUMN "avgDegradation" TYPE NUMERIC(10, 4)`);
    await queryRunner.query(`ALTER TABLE "optimization_results" ALTER COLUMN "avgTestScore" TYPE NUMERIC(10, 4)`);
    await queryRunner.query(`ALTER TABLE "optimization_results" ALTER COLUMN "avgTrainScore" TYPE NUMERIC(10, 4)`);

    // Revert paper_trading_snapshots
    await queryRunner.query(`ALTER TABLE "paper_trading_snapshots" ALTER COLUMN "drawdown" TYPE NUMERIC(8, 4)`);
    await queryRunner.query(`ALTER TABLE "paper_trading_snapshots" ALTER COLUMN "cumulativeReturn" TYPE NUMERIC(8, 4)`);

    // Revert paper_trading_sessions
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" ALTER COLUMN "winRate" TYPE NUMERIC(8, 4)`);
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" ALTER COLUMN "maxDrawdown" TYPE NUMERIC(8, 4)`);
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" ALTER COLUMN "sharpeRatio" TYPE NUMERIC(8, 4)`);
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" ALTER COLUMN "totalReturn" TYPE NUMERIC(8, 4)`);

    // Revert backtest_performance_snapshots
    await queryRunner.query(`ALTER TABLE "backtest_performance_snapshots" ALTER COLUMN "drawdown" TYPE NUMERIC(8, 4)`);
    await queryRunner.query(
      `ALTER TABLE "backtest_performance_snapshots" ALTER COLUMN "cumulativeReturn" TYPE NUMERIC(8, 4)`
    );

    // Revert backtests
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "winRate" TYPE NUMERIC(8, 4)`);
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "maxDrawdown" TYPE NUMERIC(8, 4)`);
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "sharpeRatio" TYPE NUMERIC(8, 4)`);
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "annualizedReturn" TYPE NUMERIC(8, 4)`);
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "totalReturn" TYPE NUMERIC(8, 4)`);
  }
}
