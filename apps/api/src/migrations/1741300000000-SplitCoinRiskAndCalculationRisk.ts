import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class SplitCoinRiskAndCalculationRisk1741300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Rename the FK column from "risk" to "coin_risk"
    await queryRunner.query(`ALTER TABLE "user" RENAME COLUMN "risk" TO "coin_risk"`);

    // 2. Add the new calculationRiskLevel column
    await queryRunner.query(`ALTER TABLE "user" ADD COLUMN "calculationRiskLevel" smallint`);

    // 3. Backfill algoCapitalAllocationPercentage based on existing risk level
    await queryRunner.query(`
      UPDATE "user" u
      SET "algoCapitalAllocationPercentage" = CASE r.level
        WHEN 1 THEN 15
        WHEN 2 THEN 25
        WHEN 3 THEN 35
        WHEN 4 THEN 50
        WHEN 5 THEN 70
        ELSE 35
      END
      FROM "risk" r
      WHERE u."coin_risk" = r.id
        AND u."algoTradingEnabled" = true
    `);

    // 4. For level-6 (Custom) users, set calculationRiskLevel = 3
    await queryRunner.query(`
      UPDATE "user" u
      SET "calculationRiskLevel" = 3
      FROM "risk" r
      WHERE u."coin_risk" = r.id
        AND r.level = 6
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "calculationRiskLevel"`);
    await queryRunner.query(`ALTER TABLE "user" RENAME COLUMN "coin_risk" TO "risk"`);
  }
}
