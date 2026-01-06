import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTradingState1736200000000 implements MigrationInterface {
  name = 'CreateTradingState1736200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create trading_state table
    await queryRunner.query(`
      CREATE TABLE "trading_state" (
        "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "tradingEnabled" BOOLEAN NOT NULL DEFAULT true,
        "haltedAt" TIMESTAMPTZ NULL,
        "haltedBy" UUID NULL,
        "haltReason" TEXT NULL,
        "resumedAt" TIMESTAMPTZ NULL,
        "resumedBy" UUID NULL,
        "resumeReason" TEXT NULL,
        "haltCount" INTEGER NOT NULL DEFAULT 0,
        "metadata" JSONB NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Add table comment
    await queryRunner.query(`
      COMMENT ON TABLE "trading_state" IS 'Global trading state - singleton pattern, only one row should exist'
    `);

    // Add column comments
    await queryRunner.query(`
      COMMENT ON COLUMN "trading_state"."tradingEnabled" IS 'Whether trading is enabled system-wide'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "trading_state"."haltedAt" IS 'Timestamp of last trading halt'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "trading_state"."haltedBy" IS 'User ID who triggered the halt'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "trading_state"."haltReason" IS 'Reason for halting trading'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "trading_state"."haltCount" IS 'Total number of times trading has been halted'
    `);

    // Insert initial state (trading enabled by default)
    await queryRunner.query(`
      INSERT INTO "trading_state" ("tradingEnabled", "haltCount")
      VALUES (true, 0)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "trading_state"`);
  }
}
