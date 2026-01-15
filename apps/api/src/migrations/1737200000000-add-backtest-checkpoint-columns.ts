import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBacktestCheckpointColumns1737200000000 implements MigrationInterface {
  name = 'AddBacktestCheckpointColumns1737200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "backtests"
      ADD COLUMN IF NOT EXISTS "checkpointState" jsonb
    `);

    await queryRunner.query(`
      ALTER TABLE "backtests"
      ADD COLUMN IF NOT EXISTS "lastCheckpointAt" TIMESTAMP WITH TIME ZONE
    `);

    await queryRunner.query(`
      ALTER TABLE "backtests"
      ADD COLUMN IF NOT EXISTS "processedTimestampCount" integer DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE "backtests"
      ADD COLUMN IF NOT EXISTS "totalTimestampCount" integer DEFAULT 0
    `);

    // Index for finding backtests with checkpoints (useful for cleanup tasks)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_backtest_checkpoint"
      ON "backtests" ("lastCheckpointAt")
      WHERE "checkpointState" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_backtest_checkpoint"`);
    await queryRunner.query(`ALTER TABLE "backtests" DROP COLUMN IF EXISTS "totalTimestampCount"`);
    await queryRunner.query(`ALTER TABLE "backtests" DROP COLUMN IF EXISTS "processedTimestampCount"`);
    await queryRunner.query(`ALTER TABLE "backtests" DROP COLUMN IF EXISTS "lastCheckpointAt"`);
    await queryRunner.query(`ALTER TABLE "backtests" DROP COLUMN IF EXISTS "checkpointState"`);
  }
}
