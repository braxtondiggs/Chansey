import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddInconclusiveRetryRecommendation1776449885990 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Adding a new enum value requires running outside of a transaction in PostgreSQL
    await queryRunner.query(`COMMIT`);
    await queryRunner.query(`ALTER TYPE "pipeline_recommendation_enum" ADD VALUE IF NOT EXISTS 'INCONCLUSIVE_RETRY'`);
    await queryRunner.query(`BEGIN`);
  }

  public async down(): Promise<void> {
    // PostgreSQL does not support removing enum values.
  }
}
