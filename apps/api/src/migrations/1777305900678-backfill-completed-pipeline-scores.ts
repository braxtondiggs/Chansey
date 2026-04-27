import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class BackfillCompletedPipelineScores1777305900678 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE pipelines
      SET
        "pipelineScore" = ("stageResults"->'scoring'->>'overallScore')::numeric,
        "scoreGrade"    = "stageResults"->'scoring'->>'grade',
        "scoringRegime" = "stageResults"->'scoring'->>'regime',
        "scoreDetails"  = "stageResults"->'scoring'->'componentScores'
      WHERE status = 'COMPLETED'
        AND "pipelineScore" IS NULL
        AND "stageResults"->'scoring'->>'overallScore' IS NOT NULL
        AND (recommendation IS NULL OR recommendation <> 'INCONCLUSIVE_RETRY')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE pipelines
      SET
        "pipelineScore" = NULL,
        "scoreGrade"    = NULL,
        "scoringRegime" = NULL,
        "scoreDetails"  = NULL
      WHERE status = 'COMPLETED'
        AND "pipelineScore" IS NOT NULL
        AND "stageResults"->'scoring'->>'overallScore' IS NOT NULL
        AND "pipelineScore" = ("stageResults"->'scoring'->>'overallScore')::numeric
        AND (recommendation IS NULL OR recommendation <> 'INCONCLUSIVE_RETRY')
    `);
  }
}
