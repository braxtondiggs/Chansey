import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePositionExitsTable1736000000000 implements MigrationInterface {
  name = 'CreatePositionExitsTable1736000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum for position exit status
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE position_exit_status AS ENUM (
          'active',
          'sl_triggered',
          'tp_triggered',
          'trailing_triggered',
          'cancelled',
          'expired'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create position_exits table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "position_exits" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "position_id" uuid NULL,
        "entry_order_id" uuid NOT NULL,
        "stop_loss_order_id" uuid NULL,
        "take_profit_order_id" uuid NULL,
        "trailing_stop_order_id" uuid NULL,
        "entryPrice" DECIMAL(20,8) NOT NULL,
        "stopLossPrice" DECIMAL(20,8) NULL,
        "takeProfitPrice" DECIMAL(20,8) NULL,
        "currentTrailingStopPrice" DECIMAL(20,8) NULL,
        "trailingHighWaterMark" DECIMAL(20,8) NULL,
        "trailingLowWaterMark" DECIMAL(20,8) NULL,
        "trailingActivated" BOOLEAN DEFAULT FALSE,
        "ocoLinked" BOOLEAN DEFAULT FALSE,
        "exitConfig" JSONB NOT NULL,
        "status" position_exit_status DEFAULT 'active',
        "symbol" VARCHAR(20) NOT NULL,
        "quantity" DECIMAL(20,8) NOT NULL,
        "side" VARCHAR(4) NOT NULL,
        "user_id" uuid NOT NULL,
        "strategy_config_id" uuid NULL,
        "exchangeKeyId" uuid NULL,
        "entryAtr" DECIMAL(20,8) NULL,
        "triggeredAt" TIMESTAMPTZ NULL,
        "exitPrice" DECIMAL(20,8) NULL,
        "realizedPnL" DECIMAL(20,8) NULL,
        "warnings" JSONB NULL,
        "createdAt" TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ DEFAULT NOW(),

        CONSTRAINT "FK_position_exits_entry_order" FOREIGN KEY ("entry_order_id")
          REFERENCES "order"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_position_exits_stop_loss_order" FOREIGN KEY ("stop_loss_order_id")
          REFERENCES "order"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_position_exits_take_profit_order" FOREIGN KEY ("take_profit_order_id")
          REFERENCES "order"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_position_exits_trailing_stop_order" FOREIGN KEY ("trailing_stop_order_id")
          REFERENCES "order"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_position_exits_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_position_exits_strategy_config" FOREIGN KEY ("strategy_config_id")
          REFERENCES "strategy_configs"("id") ON DELETE SET NULL
      )
    `);

    // Add comments for documentation
    await queryRunner.query(`
      COMMENT ON TABLE "position_exits" IS 'Tracks exit orders (SL/TP/trailing) attached to trading positions'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "position_exits"."position_id" IS 'Reference to UserStrategyPosition if from automated strategy'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "position_exits"."exitConfig" IS 'Full exit configuration (stop loss, take profit, trailing settings)'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "position_exits"."trailingHighWaterMark" IS 'Highest price reached for long positions (trailing stop reference)'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "position_exits"."trailingLowWaterMark" IS 'Lowest price reached for short positions (trailing stop reference)'
    `);

    // Create indexes for efficient queries
    await queryRunner.query(`
      CREATE INDEX "IDX_position_exit_position_id" ON "position_exits" ("position_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_position_exit_entry_order" ON "position_exits" ("entry_order_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_position_exit_status" ON "position_exits" ("status")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_position_exit_user_status" ON "position_exits" ("user_id", "status")
    `);

    // Index for trailing stop monitoring (active + trailing enabled)
    await queryRunner.query(`
      CREATE INDEX "IDX_position_exit_trailing_active" ON "position_exits" ("status", "trailingActivated")
      WHERE "status" = 'active'
    `);

    // Index for symbol-based queries
    await queryRunner.query(`
      CREATE INDEX "IDX_position_exit_symbol" ON "position_exits" ("symbol", "status")
    `);

    // GIN index for JSONB exitConfig queries
    await queryRunner.query(`
      CREATE INDEX "IDX_position_exit_config" ON "position_exits" USING GIN ("exitConfig")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes first
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_position_exit_config"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_position_exit_symbol"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_position_exit_trailing_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_position_exit_user_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_position_exit_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_position_exit_entry_order"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_position_exit_position_id"`);

    // Drop table
    await queryRunner.query(`DROP TABLE IF EXISTS "position_exits"`);

    // Drop enum type
    await queryRunner.query(`DROP TYPE IF EXISTS position_exit_status`);
  }
}
