import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixLiveReplayStateColumnName1738500000000 implements MigrationInterface {
  name = 'FixLiveReplayStateColumnName1738500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The original migration (1737300000000) created the column as "live_replay_state" (snake_case),
    // but TypeORM expects "liveReplayState" (camelCase) since no naming strategy is configured.
    // This mismatch causes: column backtest.liveReplayState does not exist

    // Drop the old index that references the snake_case column
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_backtests_live_replay_paused"`);

    // Rename column from snake_case to camelCase to match the entity property
    await queryRunner.query(`
      ALTER TABLE "backtests"
      RENAME COLUMN "live_replay_state" TO "liveReplayState"
    `);

    // Recreate the index with the corrected column name
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_backtests_live_replay_paused"
      ON "backtests" (("liveReplayState"->>'isPaused'))
      WHERE "type" = 'LIVE_REPLAY' AND "liveReplayState" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_backtests_live_replay_paused"`);

    await queryRunner.query(`
      ALTER TABLE "backtests"
      RENAME COLUMN "liveReplayState" TO "live_replay_state"
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_backtests_live_replay_paused"
      ON "backtests" (("live_replay_state"->>'isPaused'))
      WHERE "type" = 'LIVE_REPLAY' AND "live_replay_state" IS NOT NULL
    `);
  }
}
