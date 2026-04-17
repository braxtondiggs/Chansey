import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddCoinSnapshotBackfillCompleted1776388300942 implements MigrationInterface {
  name = 'AddCoinSnapshotBackfillCompleted1776388300942';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coin" ADD COLUMN IF NOT EXISTS "snapshotBackfillCompletedAt" TIMESTAMP WITH TIME ZONE`
    );

    // Coins with 30+ existing snapshots don't need re-backfill — mark them complete.
    await queryRunner.query(`
      UPDATE "coin"
         SET "snapshotBackfillCompletedAt" = NOW()
        FROM (
          SELECT "coinId", COUNT(*) AS cnt
            FROM "coin_daily_snapshots"
           GROUP BY "coinId"
        ) s
       WHERE "coin"."id" = s."coinId"
         AND s.cnt >= 30
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_coin_backfill_pending"
          ON "coin" ("id")
       WHERE "snapshotBackfillCompletedAt" IS NULL
         AND "delistedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_coin_backfill_pending"`);
    await queryRunner.query(`ALTER TABLE "coin" DROP COLUMN IF EXISTS "snapshotBackfillCompletedAt"`);
  }
}
