import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaperTradingRetryAttempts1740100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" ADD "retryAttempts" integer NOT NULL DEFAULT 0`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" DROP COLUMN "retryAttempts"`);
  }
}
