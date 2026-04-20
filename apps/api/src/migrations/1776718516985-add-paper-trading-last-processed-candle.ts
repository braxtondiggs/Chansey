import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddPaperTradingLastProcessedCandle1776718516985 implements MigrationInterface {
  name = 'AddPaperTradingLastProcessedCandle1776718516985';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" ADD COLUMN "lastProcessedCandleTs" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" DROP COLUMN IF EXISTS "lastProcessedCandleTs"`);
  }
}
