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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "paper_trading_orders" DROP COLUMN "exitType"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "paper_trading_exit_type_enum"`);
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" DROP COLUMN "exitTrackerState"`);
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" DROP COLUMN "exitConfig"`);
  }
}
