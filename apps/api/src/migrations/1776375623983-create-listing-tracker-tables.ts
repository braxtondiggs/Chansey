import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateListingTrackerTables1776375623983 implements MigrationInterface {
  name = 'CreateListingTrackerTables1776375623983';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "listing_announcements_announcementType_enum" AS ENUM ('NEW_LISTING', 'TRADING_LIVE', 'DEPOSITS_OPEN')`
    );

    await queryRunner.query(`
      CREATE TABLE "listing_announcements" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "exchangeSlug" varchar(40) NOT NULL,
        "coinId" uuid,
        "announcedSymbol" varchar(30) NOT NULL,
        "announcementType" "listing_announcements_announcementType_enum" NOT NULL DEFAULT 'NEW_LISTING',
        "sourceUrl" varchar(2048) NOT NULL,
        "detectedAt" timestamptz NOT NULL,
        "rawPayload" jsonb,
        "dispatched" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_listing_announcements" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_listing_announcements_exchange_source" UNIQUE ("exchangeSlug", "sourceUrl"),
        CONSTRAINT "FK_listing_announcements_coin" FOREIGN KEY ("coinId") REFERENCES "coin"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_listing_announcements_exchange_detected" ON "listing_announcements" ("exchangeSlug", "detectedAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_listing_announcements_dispatched_detected" ON "listing_announcements" ("dispatched", "detectedAt")`
    );

    await queryRunner.query(`
      CREATE TABLE "listing_candidates" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "coinId" uuid NOT NULL,
        "score" numeric(6,2) NOT NULL DEFAULT 0,
        "scoreBreakdown" jsonb,
        "qualified" boolean NOT NULL DEFAULT false,
        "firstScoredAt" timestamptz NOT NULL,
        "lastScoredAt" timestamptz NOT NULL,
        "lastTradedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_listing_candidates" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_listing_candidates_coin" UNIQUE ("coinId"),
        CONSTRAINT "FK_listing_candidates_coin" FOREIGN KEY ("coinId") REFERENCES "coin"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_listing_candidates_qualified_score" ON "listing_candidates" ("qualified", "score")`
    );

    await queryRunner.query(
      `CREATE TYPE "listing_trade_positions_strategyType_enum" AS ENUM ('PRE_LISTING', 'POST_ANNOUNCEMENT')`
    );
    await queryRunner.query(
      `CREATE TYPE "listing_trade_positions_status_enum" AS ENUM ('OPEN', 'CLOSED', 'EXITED_TIME_STOP', 'EXITED_SL', 'EXITED_TP')`
    );

    await queryRunner.query(`
      CREATE TABLE "listing_trade_positions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "orderId" uuid NOT NULL,
        "strategyType" "listing_trade_positions_strategyType_enum" NOT NULL,
        "coinId" uuid NOT NULL,
        "announcementId" uuid,
        "candidateId" uuid,
        "expiresAt" timestamptz NOT NULL,
        "hedgeOrderId" uuid,
        "status" "listing_trade_positions_status_enum" NOT NULL DEFAULT 'OPEN',
        "metadata" jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_listing_trade_positions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_listing_trade_positions_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_listing_trade_positions_order" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_listing_trade_positions_coin" FOREIGN KEY ("coinId") REFERENCES "coin"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_listing_trade_positions_announcement" FOREIGN KEY ("announcementId") REFERENCES "listing_announcements"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_listing_trade_positions_candidate" FOREIGN KEY ("candidateId") REFERENCES "listing_candidates"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_listing_trade_positions_hedge_order" FOREIGN KEY ("hedgeOrderId") REFERENCES "order"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_listing_trade_positions_user_status_expires" ON "listing_trade_positions" ("userId", "status", "expiresAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_listing_trade_positions_orderId" ON "listing_trade_positions" ("orderId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "listing_trade_positions"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "listing_trade_positions_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "listing_trade_positions_strategyType_enum"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "listing_candidates"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "listing_announcements"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "listing_announcements_announcementType_enum"`);
  }
}
