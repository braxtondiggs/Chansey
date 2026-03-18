import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Consolidated migration:
 * 1. Adds coinCount column to risk table
 * 2. Adds selectionUpdateCron column to risk table
 * 3. Renames portfolio table → coin_selection
 */
export class RiskAndCoinSelection1741600000000 implements MigrationInterface {
  name = 'RiskAndCoinSelection1741600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add coinCount column to risk table
    await queryRunner.query(`ALTER TABLE "risk" ADD "coinCount" integer NOT NULL DEFAULT 10`);
    await queryRunner.query(`UPDATE "risk" SET "coinCount" = 20 WHERE "level" = 1`);
    await queryRunner.query(`UPDATE "risk" SET "coinCount" = 15 WHERE "level" = 2`);
    await queryRunner.query(`UPDATE "risk" SET "coinCount" = 12 WHERE "level" = 3`);
    await queryRunner.query(`UPDATE "risk" SET "coinCount" = 8 WHERE "level" = 4`);
    await queryRunner.query(`UPDATE "risk" SET "coinCount" = 5 WHERE "level" = 5`);
    await queryRunner.query(`UPDATE "risk" SET "coinCount" = 0 WHERE "level" = 6`);

    // 2. Add selectionUpdateCron column to risk table
    await queryRunner.query(`ALTER TABLE "risk" ADD "selectionUpdateCron" varchar`);
    await queryRunner.query(`UPDATE "risk" SET "selectionUpdateCron" = '0 2 * * 1' WHERE "level" = 1`);
    await queryRunner.query(`UPDATE "risk" SET "selectionUpdateCron" = '0 3 * * 1' WHERE "level" = 2`);
    await queryRunner.query(`UPDATE "risk" SET "selectionUpdateCron" = '0 4 * * 3' WHERE "level" = 3`);
    await queryRunner.query(`UPDATE "risk" SET "selectionUpdateCron" = '0 0 * * *' WHERE "level" = 4`);
    await queryRunner.query(`UPDATE "risk" SET "selectionUpdateCron" = '0 */12 * * *' WHERE "level" = 5`);

    // 3. Rename portfolio table → coin_selection
    await queryRunner.query(`ALTER TABLE "portfolio" RENAME TO "coin_selection"`);

    // Rename indexes/constraints that reference "portfolio"
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_portfolio_coinId_index" RENAME TO "IDX_coin_selection_coinId_index"`
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_portfolio_userId_index" RENAME TO "IDX_coin_selection_userId_index"`
    );
    await queryRunner.query(`ALTER INDEX IF EXISTS "portfolio_coinId_index" RENAME TO "coin_selection_coinId_index"`);
    await queryRunner.query(`ALTER INDEX IF EXISTS "portfolio_userId_index" RENAME TO "coin_selection_userId_index"`);

    // Rename the enum type if it exists
    await queryRunner.query(`ALTER TYPE "public"."portfolio_type_enum" RENAME TO "coin_selection_type_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse enum rename
    await queryRunner.query(`ALTER TYPE "public"."coin_selection_type_enum" RENAME TO "portfolio_type_enum"`);

    // Reverse index renames
    await queryRunner.query(`ALTER INDEX IF EXISTS "coin_selection_coinId_index" RENAME TO "portfolio_coinId_index"`);
    await queryRunner.query(`ALTER INDEX IF EXISTS "coin_selection_userId_index" RENAME TO "portfolio_userId_index"`);
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_coin_selection_coinId_index" RENAME TO "IDX_portfolio_coinId_index"`
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_coin_selection_userId_index" RENAME TO "IDX_portfolio_userId_index"`
    );

    // Reverse table rename
    await queryRunner.query(`ALTER TABLE "coin_selection" RENAME TO "portfolio"`);

    // Drop selectionUpdateCron column
    await queryRunner.query(`ALTER TABLE "risk" DROP COLUMN "selectionUpdateCron"`);

    // Drop coinCount column
    await queryRunner.query(`ALTER TABLE "risk" DROP COLUMN "coinCount"`);
  }
}
