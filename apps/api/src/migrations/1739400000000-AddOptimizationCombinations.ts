import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * Add `combinations` JSONB column to optimization_runs.
 *
 * Stores the generated parameter combinations at run creation time so that
 * interrupted optimization runs can resume from their last completed batch.
 * Critical for random_search where combinations are non-deterministic and
 * cannot be regenerated.
 */
export class AddOptimizationCombinations1739400000000 implements MigrationInterface {
  name = 'AddOptimizationCombinations1739400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "optimization_runs" ADD COLUMN IF NOT EXISTS "combinations" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "optimization_runs" DROP COLUMN IF EXISTS "combinations"`);
  }
}
