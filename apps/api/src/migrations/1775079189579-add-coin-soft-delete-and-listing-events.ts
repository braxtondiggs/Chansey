import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCoinSoftDeleteAndListingEvents1775079189579 implements MigrationInterface {
  name = 'AddCoinSoftDeleteAndListingEvents1775079189579';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "coin" ADD COLUMN "delistedAt" TIMESTAMP WITH TIME ZONE DEFAULT NULL`);
    await queryRunner.query(
      `CREATE INDEX "IDX_coin_delistedAt_active" ON "coin" ("delistedAt") WHERE "delistedAt" IS NULL`
    );
    await queryRunner.query(`CREATE TYPE "coin_listing_event_type_enum" AS ENUM ('LISTED', 'DELISTED')`);
    await queryRunner.query(`
      CREATE TABLE "coin_listing_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "coinId" uuid NOT NULL,
        "exchangeId" uuid,
        "eventType" "coin_listing_event_type_enum" NOT NULL,
        "eventDate" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "source" varchar(50) NOT NULL DEFAULT 'coin_sync',
        "metadata" jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_coin_listing_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_coin_listing_events_coin" FOREIGN KEY ("coinId") REFERENCES "coin"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_coin_listing_events_exchange" FOREIGN KEY ("exchangeId") REFERENCES "exchange"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_coin_listing_events_coinId" ON "coin_listing_events" ("coinId")`);
    await queryRunner.query(`CREATE INDEX "IDX_coin_listing_events_eventDate" ON "coin_listing_events" ("eventDate")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_coin_listing_events_coinId_eventType" ON "coin_listing_events" ("coinId", "eventType")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "coin_listing_events"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "coin_listing_event_type_enum"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_coin_delistedAt_active"`);
    await queryRunner.query(`ALTER TABLE "coin" DROP COLUMN IF EXISTS "delistedAt"`);
  }
}
