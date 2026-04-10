import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateCoinDailySnapshots1775349958146 implements MigrationInterface {
  name = 'CreateCoinDailySnapshots1775349958146';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "coin_daily_snapshots" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "coinId" uuid NOT NULL,
        "snapshotDate" DATE NOT NULL,
        "marketCap" NUMERIC(38,8),
        "totalVolume" NUMERIC(38,8),
        "currentPrice" NUMERIC(25,8),
        "circulatingSupply" NUMERIC(38,8),
        "marketRank" integer,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_coin_daily_snapshots" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_coin_daily_snapshots_coin_date" UNIQUE ("coinId", "snapshotDate"),
        CONSTRAINT "FK_coin_daily_snapshots_coin" FOREIGN KEY ("coinId") REFERENCES "coin"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_coin_daily_snapshots_snapshotDate" ON "coin_daily_snapshots" ("snapshotDate")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_coin_daily_snapshots_coinId_snapshotDate" ON "coin_daily_snapshots" ("coinId", "snapshotDate")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "coin_daily_snapshots"`);
  }
}
