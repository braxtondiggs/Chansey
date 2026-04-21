import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddRejectedPipelineStatus1776699591770 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Adding a new enum value requires running outside of a transaction in PostgreSQL
    await queryRunner.query(`COMMIT`);
    await queryRunner.query(`ALTER TYPE "pipeline_status_enum" ADD VALUE IF NOT EXISTS 'REJECTED'`);
    await queryRunner.query(`BEGIN`);
  }

  public async down(): Promise<void> {
    // PostgreSQL does not support removing enum values.
  }
}
