import { MigrationInterface, QueryRunner } from 'typeorm';

export class DefaultCapitalAllocationPercentage1738600000000 implements MigrationInterface {
  name = 'DefaultCapitalAllocationPercentage1738600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Backfill existing users that have no capital allocation set
    await queryRunner.query(`
      UPDATE "user"
      SET "algoCapitalAllocationPercentage" = 25
      WHERE "algoCapitalAllocationPercentage" IS NULL
    `);

    // Set column default and make non-nullable
    await queryRunner.query(`
      ALTER TABLE "user"
      ALTER COLUMN "algoCapitalAllocationPercentage" SET DEFAULT 25,
      ALTER COLUMN "algoCapitalAllocationPercentage" SET NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user"
      ALTER COLUMN "algoCapitalAllocationPercentage" DROP NOT NULL,
      ALTER COLUMN "algoCapitalAllocationPercentage" DROP DEFAULT
    `);
  }
}
