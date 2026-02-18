import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKellyOrderCompositeIndex1739000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_strategy_algo_status"
        ON "order" ("strategyConfigId", "is_algorithmic_trade", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_strategy_algo_status"`);
  }
}
