import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaperTradingThrottleState1748390400000 implements MigrationInterface {
  name = 'AddPaperTradingThrottleState1748390400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" ADD "throttleState" jsonb DEFAULT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" DROP COLUMN "throttleState"`);
  }
}
