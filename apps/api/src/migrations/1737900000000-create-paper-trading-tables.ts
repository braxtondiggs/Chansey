import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePaperTradingTables1737900000000 implements MigrationInterface {
  name = 'CreatePaperTradingTables1737900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create paper_trading_status enum
    await queryRunner.query(`
      CREATE TYPE "paper_trading_status_enum" AS ENUM (
        'ACTIVE',
        'PAUSED',
        'STOPPED',
        'COMPLETED',
        'FAILED'
      )
    `);

    // Create paper_trading_order_side enum
    await queryRunner.query(`
      CREATE TYPE "paper_trading_order_side_enum" AS ENUM (
        'BUY',
        'SELL'
      )
    `);

    // Create paper_trading_order_type enum
    await queryRunner.query(`
      CREATE TYPE "paper_trading_order_type_enum" AS ENUM (
        'MARKET',
        'LIMIT',
        'STOP',
        'STOP_LIMIT'
      )
    `);

    // Create paper_trading_order_status enum
    await queryRunner.query(`
      CREATE TYPE "paper_trading_order_status_enum" AS ENUM (
        'PENDING',
        'FILLED',
        'PARTIAL',
        'CANCELLED',
        'REJECTED'
      )
    `);

    // Create paper_trading_signal_type enum
    await queryRunner.query(`
      CREATE TYPE "paper_trading_signal_type_enum" AS ENUM (
        'ENTRY',
        'EXIT',
        'ADJUSTMENT',
        'RISK_CONTROL'
      )
    `);

    // Create paper_trading_signal_direction enum
    await queryRunner.query(`
      CREATE TYPE "paper_trading_signal_direction_enum" AS ENUM (
        'LONG',
        'SHORT',
        'FLAT'
      )
    `);

    // Create paper_trading_sessions table
    await queryRunner.query(`
      CREATE TABLE "paper_trading_sessions" (
        "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "name" VARCHAR(255) NOT NULL,
        "description" TEXT,
        "status" "paper_trading_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "initialCapital" DECIMAL(18, 8) NOT NULL,
        "currentPortfolioValue" DECIMAL(18, 8),
        "peakPortfolioValue" DECIMAL(18, 8),
        "maxDrawdown" DECIMAL(8, 4),
        "totalReturn" DECIMAL(8, 4),
        "sharpeRatio" DECIMAL(8, 4),
        "winRate" DECIMAL(8, 4),
        "totalTrades" INTEGER DEFAULT 0,
        "winningTrades" INTEGER DEFAULT 0,
        "losingTrades" INTEGER DEFAULT 0,
        "tradingFee" DECIMAL(5, 4) NOT NULL DEFAULT 0.001,
        "pipelineId" UUID,
        "duration" VARCHAR(50),
        "stopConditions" JSONB,
        "stoppedReason" VARCHAR(100),
        "algorithmConfig" JSONB,
        "errorMessage" TEXT,
        "tickIntervalMs" INTEGER NOT NULL DEFAULT 30000,
        "lastTickAt" TIMESTAMPTZ,
        "tickCount" INTEGER NOT NULL DEFAULT 0,
        "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "startedAt" TIMESTAMPTZ,
        "pausedAt" TIMESTAMPTZ,
        "stoppedAt" TIMESTAMPTZ,
        "completedAt" TIMESTAMPTZ,
        "userId" VARCHAR(255) NOT NULL,
        "algorithmId" UUID NOT NULL,
        "exchangeKeyId" UUID NOT NULL,
        CONSTRAINT "fk_paper_trading_sessions_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_paper_trading_sessions_algorithm" FOREIGN KEY ("algorithmId") REFERENCES "algorithm"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_paper_trading_sessions_exchange_key" FOREIGN KEY ("exchangeKeyId") REFERENCES "exchange_key"("id") ON DELETE CASCADE
      )
    `);

    // Create indexes for paper_trading_sessions
    await queryRunner.query(
      `CREATE INDEX "idx_paper_trading_sessions_user_status" ON "paper_trading_sessions" ("userId", "status")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_paper_trading_sessions_algorithm" ON "paper_trading_sessions" ("algorithmId")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_paper_trading_sessions_pipeline" ON "paper_trading_sessions" ("pipelineId") WHERE "pipelineId" IS NOT NULL`
    );
    await queryRunner.query(`CREATE INDEX "idx_paper_trading_sessions_status" ON "paper_trading_sessions" ("status")`);

    // Create paper_trading_accounts table (virtual balances)
    await queryRunner.query(`
      CREATE TABLE "paper_trading_accounts" (
        "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "currency" VARCHAR(20) NOT NULL,
        "available" DECIMAL(18, 8) NOT NULL DEFAULT 0,
        "locked" DECIMAL(18, 8) NOT NULL DEFAULT 0,
        "averageCost" DECIMAL(18, 8),
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "sessionId" UUID NOT NULL,
        CONSTRAINT "fk_paper_trading_accounts_session" FOREIGN KEY ("sessionId") REFERENCES "paper_trading_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "uq_paper_trading_accounts_session_currency" UNIQUE ("sessionId", "currency")
      )
    `);

    // Create index for paper_trading_accounts
    await queryRunner.query(
      `CREATE INDEX "idx_paper_trading_accounts_session" ON "paper_trading_accounts" ("sessionId")`
    );

    // Create paper_trading_signals table
    await queryRunner.query(`
      CREATE TABLE "paper_trading_signals" (
        "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "signalType" "paper_trading_signal_type_enum" NOT NULL,
        "direction" "paper_trading_signal_direction_enum" NOT NULL,
        "instrument" VARCHAR(50) NOT NULL,
        "quantity" DECIMAL(18, 8) NOT NULL,
        "price" DECIMAL(18, 8),
        "confidence" DECIMAL(5, 4),
        "reason" TEXT,
        "payload" JSONB,
        "processed" BOOLEAN NOT NULL DEFAULT false,
        "processedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "sessionId" UUID NOT NULL,
        CONSTRAINT "fk_paper_trading_signals_session" FOREIGN KEY ("sessionId") REFERENCES "paper_trading_sessions"("id") ON DELETE CASCADE
      )
    `);

    // Create indexes for paper_trading_signals
    await queryRunner.query(
      `CREATE INDEX "idx_paper_trading_signals_session" ON "paper_trading_signals" ("sessionId")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_paper_trading_signals_session_processed" ON "paper_trading_signals" ("sessionId", "processed")`
    );

    // Create paper_trading_orders table
    await queryRunner.query(`
      CREATE TABLE "paper_trading_orders" (
        "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "side" "paper_trading_order_side_enum" NOT NULL,
        "orderType" "paper_trading_order_type_enum" NOT NULL DEFAULT 'MARKET',
        "status" "paper_trading_order_status_enum" NOT NULL DEFAULT 'PENDING',
        "symbol" VARCHAR(50) NOT NULL,
        "baseCurrency" VARCHAR(20) NOT NULL,
        "quoteCurrency" VARCHAR(20) NOT NULL,
        "requestedQuantity" DECIMAL(18, 8) NOT NULL,
        "filledQuantity" DECIMAL(18, 8) NOT NULL DEFAULT 0,
        "requestedPrice" DECIMAL(18, 8),
        "executedPrice" DECIMAL(18, 8),
        "averagePrice" DECIMAL(18, 8),
        "slippageBps" DECIMAL(8, 4),
        "fee" DECIMAL(18, 8) NOT NULL DEFAULT 0,
        "feeAsset" VARCHAR(20),
        "totalValue" DECIMAL(18, 8),
        "realizedPnL" DECIMAL(18, 8),
        "realizedPnLPercent" DECIMAL(10, 6),
        "costBasis" DECIMAL(18, 8),
        "metadata" JSONB,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "executedAt" TIMESTAMPTZ,
        "sessionId" UUID NOT NULL,
        "signalId" UUID,
        CONSTRAINT "fk_paper_trading_orders_session" FOREIGN KEY ("sessionId") REFERENCES "paper_trading_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_paper_trading_orders_signal" FOREIGN KEY ("signalId") REFERENCES "paper_trading_signals"("id") ON DELETE SET NULL
      )
    `);

    // Create indexes for paper_trading_orders
    await queryRunner.query(`CREATE INDEX "idx_paper_trading_orders_session" ON "paper_trading_orders" ("sessionId")`);
    await queryRunner.query(
      `CREATE INDEX "idx_paper_trading_orders_session_status" ON "paper_trading_orders" ("sessionId", "status")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_paper_trading_orders_executed_at" ON "paper_trading_orders" ("executedAt") WHERE "executedAt" IS NOT NULL`
    );

    // Create paper_trading_snapshots table
    await queryRunner.query(`
      CREATE TABLE "paper_trading_snapshots" (
        "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "portfolioValue" DECIMAL(18, 8) NOT NULL,
        "cashBalance" DECIMAL(18, 8) NOT NULL,
        "holdings" JSONB NOT NULL,
        "cumulativeReturn" DECIMAL(8, 4) NOT NULL,
        "drawdown" DECIMAL(8, 4) NOT NULL,
        "unrealizedPnL" DECIMAL(18, 8),
        "realizedPnL" DECIMAL(18, 8),
        "prices" JSONB,
        "timestamp" TIMESTAMPTZ NOT NULL,
        "sessionId" UUID NOT NULL,
        CONSTRAINT "fk_paper_trading_snapshots_session" FOREIGN KEY ("sessionId") REFERENCES "paper_trading_sessions"("id") ON DELETE CASCADE
      )
    `);

    // Create indexes for paper_trading_snapshots
    await queryRunner.query(
      `CREATE INDEX "idx_paper_trading_snapshots_session" ON "paper_trading_snapshots" ("sessionId")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_paper_trading_snapshots_session_timestamp" ON "paper_trading_snapshots" ("sessionId", "timestamp")`
    );

    // Add table comments
    await queryRunner.query(
      `COMMENT ON TABLE "paper_trading_sessions" IS 'Paper trading sessions for live simulated trading against real-time market data'`
    );
    await queryRunner.query(
      `COMMENT ON TABLE "paper_trading_accounts" IS 'Virtual account balances per currency for paper trading sessions'`
    );
    await queryRunner.query(
      `COMMENT ON TABLE "paper_trading_signals" IS 'Algorithm signals received during paper trading'`
    );
    await queryRunner.query(
      `COMMENT ON TABLE "paper_trading_orders" IS 'Paper trading orders with simulated execution, slippage, and fees'`
    );
    await queryRunner.query(
      `COMMENT ON TABLE "paper_trading_snapshots" IS 'Periodic portfolio snapshots for charting and analysis'`
    );

    // Add CHECK constraints for data integrity
    await queryRunner.query(
      `ALTER TABLE "paper_trading_signals" ADD CONSTRAINT "chk_signals_confidence" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1))`
    );
    await queryRunner.query(
      `ALTER TABLE "paper_trading_accounts" ADD CONSTRAINT "chk_accounts_available" CHECK ("available" >= 0)`
    );
    await queryRunner.query(
      `ALTER TABLE "paper_trading_accounts" ADD CONSTRAINT "chk_accounts_locked" CHECK ("locked" >= 0)`
    );
    await queryRunner.query(
      `ALTER TABLE "paper_trading_sessions" ADD CONSTRAINT "chk_sessions_max_drawdown" CHECK ("maxDrawdown" IS NULL OR ("maxDrawdown" >= 0 AND "maxDrawdown" <= 1))`
    );
    await queryRunner.query(
      `ALTER TABLE "paper_trading_sessions" ADD CONSTRAINT "chk_sessions_win_rate" CHECK ("winRate" IS NULL OR ("winRate" >= 0 AND "winRate" <= 1))`
    );
    await queryRunner.query(
      `ALTER TABLE "paper_trading_sessions" ADD CONSTRAINT "chk_sessions_initial_capital" CHECK ("initialCapital" > 0)`
    );
    await queryRunner.query(
      `ALTER TABLE "paper_trading_sessions" ADD CONSTRAINT "chk_sessions_trading_fee" CHECK ("tradingFee" >= 0 AND "tradingFee" < 1)`
    );
    await queryRunner.query(
      `ALTER TABLE "paper_trading_snapshots" ADD CONSTRAINT "chk_snapshots_drawdown" CHECK ("drawdown" >= 0 AND "drawdown" <= 1)`
    );

    // Add column comments for key fields
    await queryRunner.query(
      `COMMENT ON COLUMN "paper_trading_sessions"."pipelineId" IS 'Optional FK to Pipeline entity for pipeline integration (nullable for standalone sessions)'`
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "paper_trading_sessions"."duration" IS 'Auto-stop duration (e.g., 7d, 30d, 3m)'`
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "paper_trading_sessions"."stopConditions" IS 'Conditions for auto-stopping: maxDrawdown, targetReturn'`
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "paper_trading_sessions"."stoppedReason" IS 'Why the session stopped: duration_reached, max_drawdown, target_reached, user_cancelled, pipeline_cancelled'`
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "paper_trading_sessions"."algorithmConfig" IS 'Optimized parameters from pipeline or user configuration'`
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "paper_trading_sessions"."tickIntervalMs" IS 'Interval between market data ticks in milliseconds'`
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "paper_trading_sessions"."consecutiveErrors" IS 'Count of consecutive tick processing errors for auto-pause'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop CHECK constraints first
    await queryRunner.query(`ALTER TABLE "paper_trading_snapshots" DROP CONSTRAINT IF EXISTS "chk_snapshots_drawdown"`);
    await queryRunner.query(
      `ALTER TABLE "paper_trading_sessions" DROP CONSTRAINT IF EXISTS "chk_sessions_trading_fee"`
    );
    await queryRunner.query(
      `ALTER TABLE "paper_trading_sessions" DROP CONSTRAINT IF EXISTS "chk_sessions_initial_capital"`
    );
    await queryRunner.query(`ALTER TABLE "paper_trading_sessions" DROP CONSTRAINT IF EXISTS "chk_sessions_win_rate"`);
    await queryRunner.query(
      `ALTER TABLE "paper_trading_sessions" DROP CONSTRAINT IF EXISTS "chk_sessions_max_drawdown"`
    );
    await queryRunner.query(`ALTER TABLE "paper_trading_accounts" DROP CONSTRAINT IF EXISTS "chk_accounts_locked"`);
    await queryRunner.query(`ALTER TABLE "paper_trading_accounts" DROP CONSTRAINT IF EXISTS "chk_accounts_available"`);
    await queryRunner.query(`ALTER TABLE "paper_trading_signals" DROP CONSTRAINT IF EXISTS "chk_signals_confidence"`);

    // Drop tables in reverse order (respecting foreign key constraints)
    await queryRunner.query(`DROP TABLE IF EXISTS "paper_trading_snapshots"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "paper_trading_orders"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "paper_trading_signals"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "paper_trading_accounts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "paper_trading_sessions"`);

    // Drop enums
    await queryRunner.query(`DROP TYPE IF EXISTS "paper_trading_signal_direction_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "paper_trading_signal_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "paper_trading_order_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "paper_trading_order_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "paper_trading_order_side_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "paper_trading_status_enum"`);
  }
}
