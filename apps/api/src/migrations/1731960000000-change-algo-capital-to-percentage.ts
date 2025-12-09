import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChangeAlgoCapitalToPercentage1731960000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Rename column from dollar amount to percentage
    await queryRunner.query(`
      ALTER TABLE "user"
      RENAME COLUMN "algoCapitalAllocation" TO "algoCapitalAllocationPercentage"
    `);

    // Change type to percentage (decimal with 2 decimal places)
    // Example: 25.50 means 25.5%
    await queryRunner.query(`
      ALTER TABLE "user"
      ALTER COLUMN "algoCapitalAllocationPercentage" TYPE decimal(5,2)
    `);

    // Reset all existing values to NULL - users will need to re-enroll
    // This is cleaner than trying to convert dollar amounts to percentages
    await queryRunner.query(`
      UPDATE "user"
      SET "algoCapitalAllocationPercentage" = NULL,
          "algoTradingEnabled" = false
      WHERE "algoCapitalAllocation" IS NOT NULL
    `);

    // Add comment explaining the column
    await queryRunner.query(`
      COMMENT ON COLUMN "user"."algoCapitalAllocationPercentage" IS
      'Percentage of users free balance allocated to algorithmic trading (e.g., 25.50 = 25.5%)'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert column type
    await queryRunner.query(`
      ALTER TABLE "user"
      ALTER COLUMN "algoCapitalAllocationPercentage" TYPE decimal(12,2)
    `);

    // Rename back to original name
    await queryRunner.query(`
      ALTER TABLE "user"
      RENAME COLUMN "algoCapitalAllocationPercentage" TO "algoCapitalAllocation"
    `);

    // Remove comment
    await queryRunner.query(`
      COMMENT ON COLUMN "user"."algoCapitalAllocation" IS NULL
    `);
  }
}
