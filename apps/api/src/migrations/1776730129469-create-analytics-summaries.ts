import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateAnalyticsSummaries1776730129469 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "backtest_summaries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "backtestId" uuid NOT NULL,
        "totalSignals" integer NOT NULL DEFAULT 0,
        "entryCount" integer NOT NULL DEFAULT 0,
        "exitCount" integer NOT NULL DEFAULT 0,
        "adjustmentCount" integer NOT NULL DEFAULT 0,
        "riskControlCount" integer NOT NULL DEFAULT 0,
        "avgConfidence" decimal(6, 4),
        "confidenceSum" decimal(25, 8) NOT NULL DEFAULT 0,
        "confidenceCount" integer NOT NULL DEFAULT 0,
        "totalTrades" integer NOT NULL DEFAULT 0,
        "buyCount" integer NOT NULL DEFAULT 0,
        "sellCount" integer NOT NULL DEFAULT 0,
        "totalVolume" decimal(25, 8) NOT NULL DEFAULT 0,
        "totalFees" decimal(25, 8) NOT NULL DEFAULT 0,
        "winCount" integer NOT NULL DEFAULT 0,
        "lossCount" integer NOT NULL DEFAULT 0,
        "grossProfit" decimal(25, 8) NOT NULL DEFAULT 0,
        "grossLoss" decimal(25, 8) NOT NULL DEFAULT 0,
        "largestWin" decimal(25, 8),
        "largestLoss" decimal(25, 8),
        "avgWin" decimal(25, 8),
        "avgLoss" decimal(25, 8),
        "totalRealizedPnL" decimal(25, 8),
        "holdTimeMinMs" bigint,
        "holdTimeMaxMs" bigint,
        "holdTimeAvgMs" bigint,
        "holdTimeMedianMs" bigint,
        "holdTimeCount" integer NOT NULL DEFAULT 0,
        "slippageAvgBps" decimal(10, 4),
        "slippageMaxBps" decimal(10, 4),
        "slippageP95Bps" decimal(10, 4),
        "slippageTotalImpact" decimal(25, 8) NOT NULL DEFAULT 0,
        "slippageFillCount" integer NOT NULL DEFAULT 0,
        "holdTimeHistogram" jsonb,
        "slippageHistogram" jsonb,
        "signalsByConfidenceBucket" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "signalsByType" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "signalsByDirection" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "signalsByInstrument" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "tradesByInstrument" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "computedAt" timestamptz NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_backtest_summaries" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_backtest_summaries_backtestId" UNIQUE ("backtestId"),
        CONSTRAINT "FK_backtest_summaries_backtestId"
          FOREIGN KEY ("backtestId") REFERENCES "backtests" ("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_backtest_summaries_computedAt" ON "backtest_summaries" ("computedAt")`);

    await queryRunner.query(`
      CREATE TABLE "optimization_run_summaries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "optimizationRunId" uuid NOT NULL,
        "combinationsTested" integer NOT NULL DEFAULT 0,
        "resultCount" integer NOT NULL DEFAULT 0,
        "overfittingCount" integer NOT NULL DEFAULT 0,
        "bestScore" decimal(18, 4),
        "improvement" decimal(18, 4),
        "avgTrainScore" decimal(18, 4),
        "avgTestScore" decimal(18, 4),
        "avgDegradation" decimal(18, 4),
        "avgConsistency" decimal(18, 4),
        "overfittingRate" decimal(6, 4),
        "computedAt" timestamptz NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_optimization_run_summaries" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_optimization_run_summaries_runId" UNIQUE ("optimizationRunId"),
        CONSTRAINT "FK_optimization_run_summaries_runId"
          FOREIGN KEY ("optimizationRunId") REFERENCES "optimization_runs" ("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_optimization_run_summaries_computedAt" ON "optimization_run_summaries" ("computedAt")`
    );

    await queryRunner.query(`
      CREATE TABLE "paper_trading_session_summaries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "sessionId" uuid NOT NULL,
        "totalOrders" integer NOT NULL DEFAULT 0,
        "buyCount" integer NOT NULL DEFAULT 0,
        "sellCount" integer NOT NULL DEFAULT 0,
        "totalVolume" decimal(25, 8) NOT NULL DEFAULT 0,
        "totalFees" decimal(25, 8) NOT NULL DEFAULT 0,
        "totalPnL" decimal(25, 8) NOT NULL DEFAULT 0,
        "avgSlippageBps" decimal(10, 4),
        "slippageSumBps" decimal(18, 4) NOT NULL DEFAULT 0,
        "slippageCount" integer NOT NULL DEFAULT 0,
        "totalSignals" integer NOT NULL DEFAULT 0,
        "processedCount" integer NOT NULL DEFAULT 0,
        "confidenceSum" decimal(25, 8) NOT NULL DEFAULT 0,
        "confidenceCount" integer NOT NULL DEFAULT 0,
        "ordersBySymbol" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "signalsByType" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "signalsByDirection" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "computedAt" timestamptz NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_paper_trading_session_summaries" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_paper_trading_session_summaries_sessionId" UNIQUE ("sessionId"),
        CONSTRAINT "FK_paper_trading_session_summaries_sessionId"
          FOREIGN KEY ("sessionId") REFERENCES "paper_trading_sessions" ("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_paper_trading_session_summaries_computedAt" ON "paper_trading_session_summaries" ("computedAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "paper_trading_session_summaries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "optimization_run_summaries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "backtest_summaries"`);
  }
}
