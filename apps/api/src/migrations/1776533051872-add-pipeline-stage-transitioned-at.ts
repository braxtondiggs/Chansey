import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddPipelineStageTransitionedAt1776533051872 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "pipelines" ADD COLUMN "stageTransitionedAt" TIMESTAMPTZ NULL
    `);

    // Backfill in-flight pipelines so stall detection has a sane baseline.
    // Historical rows remain NULL — no read path needs stageTransitionedAt for completed pipelines.
    await queryRunner.query(`
      UPDATE "pipelines"
      SET "stageTransitionedAt" = COALESCE("updatedAt", "createdAt")
      WHERE "status" IN ('RUNNING', 'PENDING', 'PAUSED')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "pipelines" DROP COLUMN IF EXISTS "stageTransitionedAt"`);
  }
}
