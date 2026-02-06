import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLiveTradeMonitoringIndexes1738400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Composite index for filtering algorithmic trades by date (used by overview, orders list)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_algo_trade_created" ON "order" ("is_algorithmic_trade", "createdAt")`
    );

    // Partial index for slippage analysis queries (only rows with slippage data)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_algo_trade_slippage" ON "order" ("is_algorithmic_trade", "actualSlippageBps")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_algo_trade_slippage"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_algo_trade_created"`);
  }
}
