import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class ConvertOhlcCandlesToHypertable1776694039342 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS timescaledb`);

    await queryRunner.query(`ALTER TABLE "ohlc_candles" DROP CONSTRAINT "ohlc_candles_pkey"`);
    await queryRunner.query(`
      ALTER TABLE "ohlc_candles"
      ADD CONSTRAINT "ohlc_candles_pkey" PRIMARY KEY ("id", "timestamp")
    `);

    await queryRunner.query(`
      SELECT create_hypertable(
        'ohlc_candles',
        'timestamp',
        chunk_time_interval => INTERVAL '30 days',
        migrate_data => true,
        if_not_exists => true
      )
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ohlc_candles_coinId_timestamp"`);
    await queryRunner.query(`
      CREATE INDEX "IDX_ohlc_candles_coinId_timestamp"
        ON "ohlc_candles" ("coinId", "timestamp")
        INCLUDE ("open", "high", "low", "close", "volume", "quoteVolume")
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ohlc_candles_exchangeId_timestamp"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // TimescaleDB does not support in-place hypertable -> regular table conversion.
    // Forward-only migration: the down path only reverts PK and index shape.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ohlc_candles_coinId_timestamp"`);
    await queryRunner.query(`
      CREATE INDEX "IDX_ohlc_candles_coinId_timestamp"
        ON "ohlc_candles" ("coinId", "timestamp")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_ohlc_candles_exchangeId_timestamp"
        ON "ohlc_candles" ("exchangeId", "timestamp")
    `);

    await queryRunner.query(`ALTER TABLE "ohlc_candles" DROP CONSTRAINT "ohlc_candles_pkey"`);
    await queryRunner.query(`ALTER TABLE "ohlc_candles" ADD CONSTRAINT "ohlc_candles_pkey" PRIMARY KEY ("id")`);
  }
}
