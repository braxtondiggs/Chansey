import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemovePriceTable1736900000000 implements MigrationInterface {
  name = 'RemovePriceTable1736900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the price table - data has been migrated to OHLC candles
    await queryRunner.query(`DROP TABLE IF EXISTS "price" CASCADE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreate the price table structure for rollback
    await queryRunner.query(`
      CREATE TABLE "price" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "coinId" uuid NOT NULL,
        "price" numeric(28,18) NOT NULL,
        "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_price_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_price_coin" FOREIGN KEY ("coinId")
          REFERENCES "coin"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_price_coinId" ON "price" ("coinId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_price_timestamp" ON "price" ("timestamp")
    `);
  }
}
