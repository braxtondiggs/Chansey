import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class UpdatePaperTradingSchema1739400000000 implements MigrationInterface {
  name = 'UpdatePaperTradingSchema1739400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" ADD COLUMN "riskLevel" smallint`);
    await queryRunner.query(`ALTER TABLE "paper_trading_accounts" ADD COLUMN "entryDate" timestamptz`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "paper_trading_accounts" DROP COLUMN "entryDate"`);
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" DROP COLUMN "riskLevel"`);
  }
}
