import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLiveReplayState1737300000000 implements MigrationInterface {
  name = 'AddLiveReplayState1737300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add live_replay_state JSONB column to backtests table
    // This stores pause state and replay configuration for LIVE_REPLAY backtests
    await queryRunner.query(`
      ALTER TABLE "backtests"
      ADD COLUMN IF NOT EXISTS "live_replay_state" JSONB
    `);

    // Add comment to document the column purpose
    await queryRunner.query(`
      COMMENT ON COLUMN "backtests"."live_replay_state" IS 'Live replay state: replaySpeed, isPaused, pausedAt, pauseReason'
    `);

    // Create an index on backtests for efficient querying of paused live replay backtests
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_backtests_live_replay_paused"
      ON "backtests" (("live_replay_state"->>'isPaused'))
      WHERE "type" = 'LIVE_REPLAY' AND "live_replay_state" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the index first
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_backtests_live_replay_paused"
    `);

    // Remove the column
    await queryRunner.query(`
      ALTER TABLE "backtests"
      DROP COLUMN IF EXISTS "live_replay_state"
    `);
  }
}
