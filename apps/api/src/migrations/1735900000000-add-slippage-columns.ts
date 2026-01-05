import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSlippageColumns1735900000000 implements MigrationInterface {
  name = 'AddSlippageColumns1735900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add expectedPrice column - price at signal generation (before execution)
    await queryRunner.query(`
      ALTER TABLE "order"
      ADD COLUMN IF NOT EXISTS "expectedPrice" DECIMAL(20,8) NULL
    `);

    // Add actualSlippageBps column - basis points: (actual - expected) / expected * 10000
    await queryRunner.query(`
      ALTER TABLE "order"
      ADD COLUMN IF NOT EXISTS "actualSlippageBps" DECIMAL(10,4) NULL
    `);

    // Add comments for documentation
    await queryRunner.query(`
      COMMENT ON COLUMN "order"."expectedPrice" IS 'Expected execution price captured before order submission'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "order"."actualSlippageBps" IS 'Actual slippage in basis points (positive = unfavorable)'
    `);

    // Add index for slippage analysis queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_actualSlippageBps"
      ON "order" ("actualSlippageBps") WHERE "actualSlippageBps" IS NOT NULL
    `);

    // Add composite index for per-symbol slippage analysis
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_symbol_slippage"
      ON "order" ("symbol", "actualSlippageBps") WHERE "actualSlippageBps" IS NOT NULL
    `);

    // Add composite index for user slippage analysis queries (userId + status + actualSlippageBps)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_user_status_slippage"
      ON "order" ("userId", "status", "actualSlippageBps")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes first
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_user_status_slippage"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_symbol_slippage"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_actualSlippageBps"`);

    await queryRunner.query(`
      ALTER TABLE "order"
      DROP COLUMN IF EXISTS "actualSlippageBps"
    `);

    await queryRunner.query(`
      ALTER TABLE "order"
      DROP COLUMN IF EXISTS "expectedPrice"
    `);
  }
}
