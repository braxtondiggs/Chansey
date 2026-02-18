import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPipelineScoringColumns1738900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "pipelines"
        ADD COLUMN "pipelineScore" DECIMAL(5,2),
        ADD COLUMN "scoreGrade" VARCHAR(2),
        ADD COLUMN "scoringRegime" VARCHAR(50),
        ADD COLUMN "scoreDetails" JSONB
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_pipelines_score" ON "pipelines" ("pipelineScore") WHERE "pipelineScore" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pipelines_score"`);
    await queryRunner.query(`
      ALTER TABLE "pipelines"
        DROP COLUMN IF EXISTS "pipelineScore",
        DROP COLUMN IF EXISTS "scoreGrade",
        DROP COLUMN IF EXISTS "scoringRegime",
        DROP COLUMN IF EXISTS "scoreDetails"
    `);
  }
}
