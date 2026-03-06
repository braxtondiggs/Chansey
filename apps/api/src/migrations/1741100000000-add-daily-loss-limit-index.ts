import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDailyLossLimitIndex1741100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_order_daily_loss_gate"
        ON "order" ("userId", "is_algorithmic_trade", "status", "side", "createdAt")
        WHERE "gainLoss" < 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_order_daily_loss_gate"`);
  }
}
