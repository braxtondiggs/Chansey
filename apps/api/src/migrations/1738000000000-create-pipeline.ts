import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePipeline1738000000000 implements MigrationInterface {
  name = 'CreatePipeline1738000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create pipeline_status enum
    await queryRunner.query(`
      CREATE TYPE "pipeline_status_enum" AS ENUM (
        'PENDING',
        'RUNNING',
        'PAUSED',
        'COMPLETED',
        'FAILED',
        'CANCELLED'
      )
    `);

    // Create pipeline_stage enum
    await queryRunner.query(`
      CREATE TYPE "pipeline_stage_enum" AS ENUM (
        'OPTIMIZE',
        'HISTORICAL',
        'LIVE_REPLAY',
        'PAPER_TRADE',
        'COMPLETED'
      )
    `);

    // Create pipeline_recommendation enum
    await queryRunner.query(`
      CREATE TYPE "pipeline_recommendation_enum" AS ENUM (
        'DEPLOY',
        'NEEDS_REVIEW',
        'DO_NOT_DEPLOY'
      )
    `);

    // Create pipelines table
    await queryRunner.query(`
      CREATE TABLE "pipelines" (
        "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "name" VARCHAR(255) NOT NULL,
        "description" TEXT,
        "status" "pipeline_status_enum" NOT NULL DEFAULT 'PENDING',
        "currentStage" "pipeline_stage_enum" NOT NULL DEFAULT 'OPTIMIZE',
        "strategyConfigId" UUID NOT NULL,
        "exchangeKeyId" UUID NOT NULL,
        "optimizationRunId" UUID,
        "historicalBacktestId" UUID,
        "liveReplayBacktestId" UUID,
        "paperTradingSessionId" UUID,
        "stageConfig" JSONB NOT NULL,
        "progressionRules" JSONB NOT NULL,
        "optimizedParameters" JSONB,
        "stageResults" JSONB,
        "recommendation" "pipeline_recommendation_enum",
        "summaryReport" JSONB,
        "failureReason" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "startedAt" TIMESTAMPTZ,
        "completedAt" TIMESTAMPTZ,
        "userId" VARCHAR(255) NOT NULL,
        CONSTRAINT "fk_pipelines_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_pipelines_strategy_config" FOREIGN KEY ("strategyConfigId") REFERENCES "strategy_configs"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_pipelines_exchange_key" FOREIGN KEY ("exchangeKeyId") REFERENCES "exchange_key"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_pipelines_optimization_run" FOREIGN KEY ("optimizationRunId") REFERENCES "optimization_runs"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_pipelines_historical_backtest" FOREIGN KEY ("historicalBacktestId") REFERENCES "backtests"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_pipelines_live_replay_backtest" FOREIGN KEY ("liveReplayBacktestId") REFERENCES "backtests"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_pipelines_paper_trading_session" FOREIGN KEY ("paperTradingSessionId") REFERENCES "paper_trading_sessions"("id") ON DELETE SET NULL
      )
    `);

    // Create indexes for pipelines
    await queryRunner.query(`CREATE INDEX "idx_pipelines_user_status" ON "pipelines" ("userId", "status")`);
    await queryRunner.query(`CREATE INDEX "idx_pipelines_strategy_config" ON "pipelines" ("strategyConfigId")`);
    await queryRunner.query(`CREATE INDEX "idx_pipelines_status" ON "pipelines" ("status")`);
    await queryRunner.query(`CREATE INDEX "idx_pipelines_current_stage" ON "pipelines" ("currentStage")`);
    await queryRunner.query(`CREATE INDEX "idx_pipelines_created_at" ON "pipelines" ("createdAt")`);
    await queryRunner.query(
      `CREATE INDEX "idx_pipelines_optimization_run" ON "pipelines" ("optimizationRunId") WHERE "optimizationRunId" IS NOT NULL`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pipelines_historical_backtest" ON "pipelines" ("historicalBacktestId") WHERE "historicalBacktestId" IS NOT NULL`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pipelines_live_replay_backtest" ON "pipelines" ("liveReplayBacktestId") WHERE "liveReplayBacktestId" IS NOT NULL`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_pipelines_paper_trading" ON "pipelines" ("paperTradingSessionId") WHERE "paperTradingSessionId" IS NOT NULL`
    );

    // Add table comments
    await queryRunner.query(
      `COMMENT ON TABLE "pipelines" IS 'Strategy development pipelines orchestrating optimization, backtesting, live replay, and paper trading stages'`
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "pipelines"."currentStage" IS 'Current stage in the pipeline: OPTIMIZE -> HISTORICAL -> LIVE_REPLAY -> PAPER_TRADE -> COMPLETED'`
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "pipelines"."stageConfig" IS 'Configuration for each pipeline stage (optimization params, backtest settings, paper trading config)'`
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "pipelines"."progressionRules" IS 'Metric thresholds required for advancing to the next stage'`
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "pipelines"."optimizedParameters" IS 'Best parameters from optimization stage, used in subsequent stages'`
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "pipelines"."stageResults" IS 'Results collected from each completed stage'`
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "pipelines"."recommendation" IS 'Final deployment recommendation: DEPLOY, NEEDS_REVIEW, or DO_NOT_DEPLOY'`
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "pipelines"."summaryReport" IS 'Comprehensive final report with metrics comparison across all stages'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pipelines_paper_trading"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pipelines_live_replay_backtest"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pipelines_historical_backtest"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pipelines_optimization_run"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pipelines_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pipelines_current_stage"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pipelines_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pipelines_strategy_config"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pipelines_user_status"`);

    // Drop table
    await queryRunner.query(`DROP TABLE IF EXISTS "pipelines"`);

    // Drop enums
    await queryRunner.query(`DROP TYPE IF EXISTS "pipeline_recommendation_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "pipeline_stage_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "pipeline_status_enum"`);
  }
}
