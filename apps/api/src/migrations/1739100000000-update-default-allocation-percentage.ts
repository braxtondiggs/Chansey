import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateDefaultAllocationPercentage1739100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "algorithm_activations" ALTER COLUMN "allocationPercentage" SET DEFAULT 5.0`);
    await queryRunner.query(
      `UPDATE "algorithm_activations" SET "allocationPercentage" = 5.0 WHERE "allocationPercentage" = 1.0`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "algorithm_activations" ALTER COLUMN "allocationPercentage" SET DEFAULT 1.0`);
    await queryRunner.query(
      `UPDATE "algorithm_activations" SET "allocationPercentage" = 1.0 WHERE "allocationPercentage" = 5.0`
    );
  }
}
