import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFuturesSupport1740000000000 implements MigrationInterface {
  name = 'AddFuturesSupport1740000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Order table: add futures columns ──
    await queryRunner.query(`ALTER TABLE "order" ADD "marketType" varchar(10) NOT NULL DEFAULT 'spot'`);
    await queryRunner.query(`ALTER TABLE "order" ADD "positionSide" varchar(10)`);
    await queryRunner.query(`ALTER TABLE "order" ADD "leverage" decimal(5,2)`);
    await queryRunner.query(`ALTER TABLE "order" ADD "liquidationPrice" decimal(20,8)`);
    await queryRunner.query(`ALTER TABLE "order" ADD "marginAmount" decimal(20,8)`);
    await queryRunner.query(`ALTER TABLE "order" ADD "marginMode" varchar(10)`);
    await queryRunner.query(`CREATE INDEX "IDX_order_market_type" ON "order" ("marketType")`);

    // ── StrategyConfig table: add market type and leverage ──
    await queryRunner.query(`ALTER TABLE "strategy_configs" ADD "marketType" varchar(20) NOT NULL DEFAULT 'spot'`);
    await queryRunner.query(`ALTER TABLE "strategy_configs" ADD "defaultLeverage" decimal(5,2)`);

    // ── Backtest table: add market type and leverage ──
    await queryRunner.query(`ALTER TABLE "backtests" ADD "marketType" varchar(20) NOT NULL DEFAULT 'spot'`);
    await queryRunner.query(`ALTER TABLE "backtests" ADD "leverage" decimal(5,2)`);

    // ── BacktestTrade table: add futures-specific columns ──
    await queryRunner.query(`ALTER TABLE "backtest_trades" ADD "positionSide" varchar(10)`);
    await queryRunner.query(`ALTER TABLE "backtest_trades" ADD "leverage" decimal(5,2)`);
    await queryRunner.query(`ALTER TABLE "backtest_trades" ADD "liquidationPrice" decimal(20,8)`);
    await queryRunner.query(`ALTER TABLE "backtest_trades" ADD "marginUsed" decimal(20,8)`);

    // ── UserStrategyPosition table: add futures columns ──
    await queryRunner.query(
      `ALTER TABLE "user_strategy_positions" ADD "positionSide" varchar(10) NOT NULL DEFAULT 'long'`
    );
    await queryRunner.query(`ALTER TABLE "user_strategy_positions" ADD "leverage" decimal(5,2) NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE "user_strategy_positions" ADD "liquidationPrice" decimal(20,8)`);
    await queryRunner.query(`ALTER TABLE "user_strategy_positions" ADD "marginAmount" decimal(20,8)`);
    await queryRunner.query(`ALTER TABLE "user_strategy_positions" ADD "maintenanceMargin" decimal(20,8)`);

    // ── Update unique index to include positionSide ──
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_strategy_positions_userId_strategyConfigId_symbol"`);
    // Drop the TypeORM-generated unique index variant as well
    await queryRunner.query(
      `DO $$ BEGIN
        EXECUTE (
          SELECT string_agg('DROP INDEX ' || indexrelid::regclass::text, '; ')
          FROM pg_index
          JOIN pg_class ON pg_class.oid = pg_index.indrelid
          WHERE pg_class.relname = 'user_strategy_positions'
            AND pg_index.indisunique
            AND pg_index.indisprimary = false
            AND (SELECT array_agg(a.attname ORDER BY a.attnum)
                 FROM pg_attribute a
                 WHERE a.attrelid = pg_index.indrelid
                   AND a.attnum = ANY(pg_index.indkey))
                @> ARRAY['userId', 'strategyConfigId', 'symbol']
            AND NOT (SELECT array_agg(a.attname ORDER BY a.attnum)
                     FROM pg_attribute a
                     WHERE a.attrelid = pg_index.indrelid
                       AND a.attnum = ANY(pg_index.indkey))
                @> ARRAY['positionSide']
        );
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_usp_user_strat_symbol_side"
       ON "user_strategy_positions" ("userId", "strategyConfigId", "symbol", "positionSide")`
    );

    // ── Partial index for leveraged positions (speeds up liquidation monitor queries) ──
    await queryRunner.query(
      `CREATE INDEX "IDX_usp_leverage_gt1" ON "user_strategy_positions" ("leverage") WHERE leverage > 1`
    );

    // ── User table: add futures opt-in toggle ──
    await queryRunner.query(`ALTER TABLE "user" ADD "futuresEnabled" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ── Revert User ──
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "futuresEnabled"`);

    // ── Revert UserStrategyPosition ──
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_usp_leverage_gt1"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_usp_user_strat_symbol_side"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_user_strategy_positions_userId_strategyConfigId_symbol"
       ON "user_strategy_positions" ("userId", "strategyConfigId", "symbol")`
    );
    await queryRunner.query(`ALTER TABLE "user_strategy_positions" DROP COLUMN "maintenanceMargin"`);
    await queryRunner.query(`ALTER TABLE "user_strategy_positions" DROP COLUMN "marginAmount"`);
    await queryRunner.query(`ALTER TABLE "user_strategy_positions" DROP COLUMN "liquidationPrice"`);
    await queryRunner.query(`ALTER TABLE "user_strategy_positions" DROP COLUMN "leverage"`);
    await queryRunner.query(`ALTER TABLE "user_strategy_positions" DROP COLUMN "positionSide"`);

    // ── Revert BacktestTrade ──
    await queryRunner.query(`ALTER TABLE "backtest_trades" DROP COLUMN "marginUsed"`);
    await queryRunner.query(`ALTER TABLE "backtest_trades" DROP COLUMN "liquidationPrice"`);
    await queryRunner.query(`ALTER TABLE "backtest_trades" DROP COLUMN "leverage"`);
    await queryRunner.query(`ALTER TABLE "backtest_trades" DROP COLUMN "positionSide"`);

    // ── Revert Backtest ──
    await queryRunner.query(`ALTER TABLE "backtests" DROP COLUMN "leverage"`);
    await queryRunner.query(`ALTER TABLE "backtests" DROP COLUMN "marketType"`);

    // ── Revert StrategyConfig ──
    await queryRunner.query(`ALTER TABLE "strategy_configs" DROP COLUMN "defaultLeverage"`);
    await queryRunner.query(`ALTER TABLE "strategy_configs" DROP COLUMN "marketType"`);

    // ── Revert Order ──
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_market_type"`);
    await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "marginMode"`);
    await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "marginAmount"`);
    await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "liquidationPrice"`);
    await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "leverage"`);
    await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "positionSide"`);
    await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "marketType"`);
  }
}
