import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateLiveTradingSignals1774830000000 implements MigrationInterface {
  name = 'CreateLiveTradingSignals1774830000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "signal_source_enum" AS ENUM (
        'BACKTEST',
        'PAPER_TRADING',
        'LIVE_TRADING'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "signal_status_enum" AS ENUM (
        'RECORDED',
        'PENDING',
        'PROCESSED',
        'PLACED',
        'BLOCKED',
        'FAILED'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "signal_reason_code_enum" AS ENUM (
        'SIGNAL_VALIDATION_FAILED',
        'DAILY_LOSS_LIMIT',
        'REGIME_GATE',
        'DRAWDOWN_GATE',
        'CONCENTRATION_LIMIT',
        'CONCENTRATION_REDUCED',
        'OPPORTUNITY_SELLING_REJECTED',
        'INSUFFICIENT_FUNDS',
        'EXCHANGE_SELECTION_FAILED',
        'TRADE_COOLDOWN',
        'ORDER_EXECUTION_FAILED',
        'SIGNAL_THROTTLED',
        'SYMBOL_RESOLUTION_FAILED'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "live_trading_signal_action_enum" AS ENUM (
        'buy',
        'sell',
        'short_entry',
        'short_exit'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "live_trading_signals" (
        "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "userId" UUID NOT NULL,
        "strategyConfigId" UUID,
        "algorithmActivationId" UUID,
        "source" "signal_source_enum" NOT NULL DEFAULT 'LIVE_TRADING',
        "action" "live_trading_signal_action_enum" NOT NULL,
        "symbol" VARCHAR(50) NOT NULL,
        "quantity" DECIMAL(25, 8) NOT NULL,
        "price" DECIMAL(25, 8),
        "confidence" DECIMAL(5, 4),
        "status" "signal_status_enum" NOT NULL,
        "reasonCode" "signal_reason_code_enum",
        "reason" TEXT,
        "metadata" JSONB,
        "orderId" UUID,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk_live_trading_signals_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_live_trading_signals_strategy" FOREIGN KEY ("strategyConfigId") REFERENCES "strategy_configs"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_live_trading_signals_activation" FOREIGN KEY ("algorithmActivationId") REFERENCES "algorithm_activations"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_live_trading_signals_order" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_live_signal_confidence" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1))
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_live_trading_signals_created_at" ON "live_trading_signals" ("createdAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_live_trading_signals_status_created_at" ON "live_trading_signals" ("status", "createdAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_live_trading_signals_user_created_at" ON "live_trading_signals" ("userId", "createdAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_live_trading_signals_strategy_created_at" ON "live_trading_signals" ("strategyConfigId", "createdAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_live_trading_signals_activation_created_at" ON "live_trading_signals" ("algorithmActivationId", "createdAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_live_trading_signals_activation_created_at"`);
    await queryRunner.query(`DROP INDEX "public"."idx_live_trading_signals_strategy_created_at"`);
    await queryRunner.query(`DROP INDEX "public"."idx_live_trading_signals_user_created_at"`);
    await queryRunner.query(`DROP INDEX "public"."idx_live_trading_signals_status_created_at"`);
    await queryRunner.query(`DROP INDEX "public"."idx_live_trading_signals_created_at"`);
    await queryRunner.query(`DROP TABLE "live_trading_signals"`);
    await queryRunner.query(`DROP TYPE "live_trading_signal_action_enum"`);
    await queryRunner.query(`DROP TYPE "signal_reason_code_enum"`);
    await queryRunner.query(`DROP TYPE "signal_status_enum"`);
    await queryRunner.query(`DROP TYPE "signal_source_enum"`);
  }
}
