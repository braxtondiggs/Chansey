import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeAlgorithmWeightComputed1738800000000 implements MigrationInterface {
  name = 'MakeAlgorithmWeightComputed1738800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Backfill any existing NULL weights to 5 (default score)
    await queryRunner.query(`UPDATE "algorithm" SET "weight" = 5 WHERE "weight" IS NULL`);

    // Set the column default to 5
    await queryRunner.query(`ALTER TABLE "algorithm" ALTER COLUMN "weight" SET DEFAULT 5`);

    // Add column comment describing the computed nature
    await queryRunner.query(
      `COMMENT ON COLUMN "algorithm"."weight" IS 'Auto-calculated performance score (1-10). Recalculated every 5 minutes by PerformanceRankingTask.'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`COMMENT ON COLUMN "algorithm"."weight" IS NULL`);
    await queryRunner.query(`ALTER TABLE "algorithm" ALTER COLUMN "weight" DROP DEFAULT`);
  }
}
