import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaperTradingMinTrades1774978312000 implements MigrationInterface {
  name = 'AddPaperTradingMinTrades1774978312000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" ADD "minTrades" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" DROP COLUMN "minTrades"`);
  }
}
