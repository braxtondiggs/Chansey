import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaperTradingExitTracking1774932017000 implements MigrationInterface {
  name = 'AddPaperTradingExitTracking1774932017000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" ADD COLUMN "exitConfig" jsonb`);
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" ADD COLUMN "exitTrackerState" jsonb`);
    await queryRunner.query(
      `CREATE TYPE "paper_trading_exit_type_enum" AS ENUM ('STOP_LOSS', 'TAKE_PROFIT', 'TRAILING_STOP')`
    );
    await queryRunner.query(`ALTER TABLE "paper_trading_orders" ADD COLUMN "exitType" "paper_trading_exit_type_enum"`);

    // Signal status enum
    await queryRunner.query(
      `CREATE TYPE "paper_trading_signal_status_enum" AS ENUM ('PENDING', 'SIMULATED', 'REJECTED', 'ERROR')`
    );
    await queryRunner.query(
      `ALTER TABLE "paper_trading_signals" ADD COLUMN "status" "paper_trading_signal_status_enum" NOT NULL DEFAULT 'PENDING'`
    );
    await queryRunner.query(`UPDATE "paper_trading_signals" SET "status" = 'SIMULATED' WHERE "processed" = true`);
    await queryRunner.query(
      `CREATE INDEX "IDX_paper_trading_signals_session_status" ON "paper_trading_signals" ("sessionId", "status")`
    );
    await queryRunner.query(`ALTER TABLE "paper_trading_signals" ADD COLUMN "rejectionCode" "signal_reason_code_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "paper_trading_signals" DROP COLUMN IF EXISTS "rejectionCode"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_paper_trading_signals_session_status"`);
    await queryRunner.query(`ALTER TABLE "paper_trading_signals" DROP COLUMN IF EXISTS "status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "paper_trading_signal_status_enum"`);
    await queryRunner.query(`ALTER TABLE "paper_trading_orders" DROP COLUMN "exitType"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "paper_trading_exit_type_enum"`);
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" DROP COLUMN "exitTrackerState"`);
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" DROP COLUMN "exitConfig"`);
  }
}
