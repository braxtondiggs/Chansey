import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOhlcTables1736800000000 implements MigrationInterface {
  name = 'CreateOhlcTables1736800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create ohlc_candles table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ohlc_candles" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "coinId" uuid NOT NULL,
        "exchangeId" uuid NOT NULL,
        "timestamp" TIMESTAMPTZ NOT NULL,
        "open" DECIMAL(25,8) NOT NULL,
        "high" DECIMAL(25,8) NOT NULL,
        "low" DECIMAL(25,8) NOT NULL,
        "close" DECIMAL(25,8) NOT NULL,
        "volume" DECIMAL(30,8) NOT NULL DEFAULT 0,
        "quoteVolume" DECIMAL(30,2) NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT "UQ_ohlc_candles_coin_timestamp_exchange"
          UNIQUE ("coinId", "timestamp", "exchangeId"),
        CONSTRAINT "FK_ohlc_candles_coin"
          FOREIGN KEY ("coinId") REFERENCES "coin"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ohlc_candles_exchange"
          FOREIGN KEY ("exchangeId") REFERENCES "exchange"("id") ON DELETE CASCADE
      )
    `);

    // Add comments for documentation
    await queryRunner.query(`
      COMMENT ON TABLE "ohlc_candles" IS 'Hourly OHLC candle data from cryptocurrency exchanges'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "ohlc_candles"."timestamp" IS 'Candle open timestamp (start of hour, UTC)'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "ohlc_candles"."volume" IS 'Trading volume in base currency (e.g., BTC)'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "ohlc_candles"."quoteVolume" IS 'Trading volume in quote currency (USD)'
    `);

    // Create indexes for efficient queries
    // Primary query pattern: get candles for coins within date range
    await queryRunner.query(`
      CREATE INDEX "IDX_ohlc_candles_coinId_timestamp"
      ON "ohlc_candles" ("coinId", "timestamp")
    `);

    // For daily pruning job
    await queryRunner.query(`
      CREATE INDEX "IDX_ohlc_candles_timestamp"
      ON "ohlc_candles" ("timestamp")
    `);

    // For exchange-specific queries
    await queryRunner.query(`
      CREATE INDEX "IDX_ohlc_candles_exchangeId_timestamp"
      ON "ohlc_candles" ("exchangeId", "timestamp")
    `);

    // Create exchange_symbol_map table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "exchange_symbol_map" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "coinId" uuid NOT NULL,
        "exchangeId" uuid NOT NULL,
        "symbol" VARCHAR(20) NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
        "priority" INTEGER NOT NULL DEFAULT 0,
        "lastSyncAt" TIMESTAMPTZ NULL,
        "failureCount" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT "UQ_exchange_symbol_map_coin_exchange"
          UNIQUE ("coinId", "exchangeId"),
        CONSTRAINT "FK_exchange_symbol_map_coin"
          FOREIGN KEY ("coinId") REFERENCES "coin"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_exchange_symbol_map_exchange"
          FOREIGN KEY ("exchangeId") REFERENCES "exchange"("id") ON DELETE CASCADE
      )
    `);

    // Add comments for documentation
    await queryRunner.query(`
      COMMENT ON TABLE "exchange_symbol_map" IS 'Maps coins to exchange-specific trading symbols'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "exchange_symbol_map"."symbol" IS 'Trading symbol on this exchange (e.g., BTC/USD, BCH/USD)'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "exchange_symbol_map"."priority" IS 'Fallback priority (0 = highest priority)'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "exchange_symbol_map"."failureCount" IS 'Consecutive sync failure count for alerting'
    `);

    // Create indexes for exchange_symbol_map
    await queryRunner.query(`
      CREATE INDEX "IDX_exchange_symbol_map_exchangeId_isActive"
      ON "exchange_symbol_map" ("exchangeId", "isActive")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_exchange_symbol_map_coinId"
      ON "exchange_symbol_map" ("coinId")
    `);

    // Partial index for active mappings with priority ordering
    await queryRunner.query(`
      CREATE INDEX "IDX_exchange_symbol_map_active_priority"
      ON "exchange_symbol_map" ("coinId", "priority")
      WHERE "isActive" = TRUE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop exchange_symbol_map indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_exchange_symbol_map_active_priority"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_exchange_symbol_map_coinId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_exchange_symbol_map_exchangeId_isActive"`);

    // Drop exchange_symbol_map table
    await queryRunner.query(`DROP TABLE IF EXISTS "exchange_symbol_map"`);

    // Drop ohlc_candles indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ohlc_candles_exchangeId_timestamp"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ohlc_candles_timestamp"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ohlc_candles_coinId_timestamp"`);

    // Drop ohlc_candles table
    await queryRunner.query(`DROP TABLE IF EXISTS "ohlc_candles"`);
  }
}
