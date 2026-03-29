import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExchangeKeyHealthMonitoring1748490400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "exchange_key"
        ADD "healthStatus" varchar(20) NOT NULL DEFAULT 'unknown',
        ADD "lastHealthCheckAt" timestamptz,
        ADD "consecutiveFailures" integer NOT NULL DEFAULT 0,
        ADD "lastErrorCategory" varchar(30),
        ADD "lastErrorMessage" text,
        ADD "deactivatedByHealthCheck" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      CREATE TABLE "exchange_key_health_log" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "exchangeKeyId" uuid NOT NULL,
        "status" varchar(20) NOT NULL,
        "errorCategory" varchar(30),
        "errorMessage" text,
        "responseTimeMs" integer,
        "checkedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_exchange_key_health_log" PRIMARY KEY ("id"),
        CONSTRAINT "FK_exchange_key_health_log_exchange_key" FOREIGN KEY ("exchangeKeyId")
          REFERENCES "exchange_key"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_exchange_key_health_log_key_checked"
        ON "exchange_key_health_log" ("exchangeKeyId", "checkedAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_exchange_key_health_log_key_checked"`);
    await queryRunner.query(`DROP TABLE "exchange_key_health_log"`);
    await queryRunner.query(`
      ALTER TABLE "exchange_key"
        DROP COLUMN "healthStatus",
        DROP COLUMN "lastHealthCheckAt",
        DROP COLUMN "consecutiveFailures",
        DROP COLUMN "lastErrorCategory",
        DROP COLUMN "lastErrorMessage",
        DROP COLUMN "deactivatedByHealthCheck"
    `);
  }
}
