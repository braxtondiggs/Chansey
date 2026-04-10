import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddCoinSelectionSource1774978311000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create the enum type
    await queryRunner.query(`CREATE TYPE "coin_selection_source_enum" AS ENUM ('risk_based', 'listing', 'strategy')`);

    // 2. Add nullable source column
    await queryRunner.query(`ALTER TABLE "coin_selection" ADD "source" "coin_selection_source_enum" DEFAULT NULL`);

    // 3. Backfill existing AUTOMATIC selections as risk_based
    await queryRunner.query(`UPDATE "coin_selection" SET "source" = 'risk_based' WHERE "type" = 'AUTOMATIC'`);

    // 4. Drop old unique index on (coinId, userId, type)
    // The TypeORM-generated name for @Index(['coin', 'user', 'type'], { unique: true })
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_coin_selection_coin_user_type"`);
    // Also try the auto-generated constraint name patterns
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_4e0c7e6b1c2d3f4a5b6c7d8e9f"`);
    // Use a dynamic approach to find and drop the right index
    await queryRunner.query(`
      DO $$
      DECLARE
        idx_name text;
      BEGIN
        SELECT indexname INTO idx_name
        FROM pg_indexes
        WHERE tablename = 'coin_selection'
          AND indexdef LIKE '%coinId%'
          AND indexdef LIKE '%userId%'
          AND indexdef LIKE '%type%'
          AND indexname NOT LIKE '%pkey%'
          AND indexdef NOT LIKE '%source%'
          AND indexdef NOT LIKE '%"id"%';
        IF idx_name IS NOT NULL THEN
          EXECUTE format('DROP INDEX IF EXISTS %I', idx_name);
        END IF;
      END $$;
    `);

    // 5. Create partial unique index for MANUAL/WATCHED (source IS NULL)
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_coin_selection_manual"
      ON "coin_selection" ("coinId", "userId", "type")
      WHERE "source" IS NULL
    `);

    // 6. Create partial unique index for AUTOMATIC (source IS NOT NULL)
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_coin_selection_automatic"
      ON "coin_selection" ("coinId", "userId", "type", "source")
      WHERE "source" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop partial unique indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_coin_selection_automatic"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_coin_selection_manual"`);

    // 2. Deduplicate rows before recreating the stricter unique index.
    //    Keep the oldest row per (coinId, userId, type) group, delete extras.
    await queryRunner.query(`
      DELETE FROM "coin_selection"
      WHERE id NOT IN (
        SELECT DISTINCT ON ("coinId", "userId", "type") id
        FROM "coin_selection"
        ORDER BY "coinId", "userId", "type", "createdAt" ASC
      )
    `);

    // 3. Recreate original unique index
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_coin_selection_coin_user_type"
      ON "coin_selection" ("coinId", "userId", "type")
    `);

    // 3. Drop source column
    await queryRunner.query(`ALTER TABLE "coin_selection" DROP COLUMN "source"`);

    // 4. Drop enum type
    await queryRunner.query(`DROP TYPE "coin_selection_source_enum"`);
  }
}
