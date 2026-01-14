import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenamePositionExitsColumnsToCamelCase1737100000000 implements MigrationInterface {
  name = 'RenamePositionExitsColumnsToCamelCase1737100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Rename snake_case columns to camelCase to match entity
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "entry_price" TO "entryPrice"`);
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "stop_loss_price" TO "stopLossPrice"`);
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "take_profit_price" TO "takeProfitPrice"`);
    await queryRunner.query(
      `ALTER TABLE "position_exits" RENAME COLUMN "current_trailing_stop_price" TO "currentTrailingStopPrice"`
    );
    await queryRunner.query(
      `ALTER TABLE "position_exits" RENAME COLUMN "trailing_high_water_mark" TO "trailingHighWaterMark"`
    );
    await queryRunner.query(
      `ALTER TABLE "position_exits" RENAME COLUMN "trailing_low_water_mark" TO "trailingLowWaterMark"`
    );
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "trailing_activated" TO "trailingActivated"`);
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "oco_linked" TO "ocoLinked"`);
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "exit_config" TO "exitConfig"`);
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "exchange_key_id" TO "exchangeKeyId"`);
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "entry_atr" TO "entryAtr"`);
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "triggered_at" TO "triggeredAt"`);
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "exit_price" TO "exitPrice"`);
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "realized_pnl" TO "realizedPnL"`);
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "created_at" TO "createdAt"`);
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "updated_at" TO "updatedAt"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert to snake_case
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "entryPrice" TO "entry_price"`);
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "stopLossPrice" TO "stop_loss_price"`);
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "takeProfitPrice" TO "take_profit_price"`);
    await queryRunner.query(
      `ALTER TABLE "position_exits" RENAME COLUMN "currentTrailingStopPrice" TO "current_trailing_stop_price"`
    );
    await queryRunner.query(
      `ALTER TABLE "position_exits" RENAME COLUMN "trailingHighWaterMark" TO "trailing_high_water_mark"`
    );
    await queryRunner.query(
      `ALTER TABLE "position_exits" RENAME COLUMN "trailingLowWaterMark" TO "trailing_low_water_mark"`
    );
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "trailingActivated" TO "trailing_activated"`);
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "ocoLinked" TO "oco_linked"`);
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "exitConfig" TO "exit_config"`);
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "exchangeKeyId" TO "exchange_key_id"`);
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "entryAtr" TO "entry_atr"`);
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "triggeredAt" TO "triggered_at"`);
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "exitPrice" TO "exit_price"`);
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "realizedPnL" TO "realized_pnl"`);
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "createdAt" TO "created_at"`);
    await queryRunner.query(`ALTER TABLE "position_exits" RENAME COLUMN "updatedAt" TO "updated_at"`);
  }
}
