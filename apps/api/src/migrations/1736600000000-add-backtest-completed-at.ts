import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBacktestCompletedAt1736600000000 implements MigrationInterface {
  name = 'AddBacktestCompletedAt1736600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "backtests"
      ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP WITH TIME ZONE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "backtests"
      DROP COLUMN IF EXISTS "completedAt"
    `);
  }
}
