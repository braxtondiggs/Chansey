import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStrategyHeartbeatColumns1734400000000 implements MigrationInterface {
  name = 'AddStrategyHeartbeatColumns1734400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add lastHeartbeat column - tracks when strategy last sent a heartbeat
    await queryRunner.query(`
      ALTER TABLE "strategy_configs"
      ADD COLUMN IF NOT EXISTS "lastHeartbeat" TIMESTAMPTZ NULL
    `);

    // Add heartbeatFailures column - tracks consecutive heartbeat failures
    await queryRunner.query(`
      ALTER TABLE "strategy_configs"
      ADD COLUMN IF NOT EXISTS "heartbeatFailures" INTEGER NOT NULL DEFAULT 0
    `);

    // Add lastError column - stores last error message
    await queryRunner.query(`
      ALTER TABLE "strategy_configs"
      ADD COLUMN IF NOT EXISTS "lastError" VARCHAR(500) NULL
    `);

    // Add lastErrorAt column - tracks when last error occurred
    await queryRunner.query(`
      ALTER TABLE "strategy_configs"
      ADD COLUMN IF NOT EXISTS "lastErrorAt" TIMESTAMPTZ NULL
    `);

    // Add comments for documentation
    await queryRunner.query(`
      COMMENT ON COLUMN "strategy_configs"."lastHeartbeat" IS 'Last time this strategy sent a heartbeat signal (for health monitoring)'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "strategy_configs"."heartbeatFailures" IS 'Number of consecutive heartbeat failures (resets on success)'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "strategy_configs"."lastError" IS 'Last error message from strategy execution'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "strategy_configs"."lastErrorAt" IS 'Timestamp of last error occurrence'
    `);

    // Add indexes for heartbeat queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_strategy_configs_status_lastHeartbeat"
      ON "strategy_configs" ("status", "lastHeartbeat")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_strategy_configs_heartbeatFailures"
      ON "strategy_configs" ("heartbeatFailures")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes first
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_strategy_configs_heartbeatFailures"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_strategy_configs_status_lastHeartbeat"`);

    await queryRunner.query(`
      ALTER TABLE "strategy_configs"
      DROP COLUMN IF EXISTS "lastErrorAt"
    `);

    await queryRunner.query(`
      ALTER TABLE "strategy_configs"
      DROP COLUMN IF EXISTS "lastError"
    `);

    await queryRunner.query(`
      ALTER TABLE "strategy_configs"
      DROP COLUMN IF EXISTS "heartbeatFailures"
    `);

    await queryRunner.query(`
      ALTER TABLE "strategy_configs"
      DROP COLUMN IF EXISTS "lastHeartbeat"
    `);
  }
}
