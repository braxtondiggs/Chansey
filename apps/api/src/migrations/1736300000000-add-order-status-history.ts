import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderStatusHistory1736300000000 implements MigrationInterface {
  name = 'AddOrderStatusHistory1736300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum type for transition reasons
    await queryRunner.query(`
      CREATE TYPE "order_transition_reason_enum" AS ENUM (
        'exchange_sync',
        'user_cancel',
        'trade_execution',
        'partial_fill',
        'order_expired',
        'market_close',
        'system_cancel',
        'exchange_reject'
      )
    `);

    // Create the order_status_history table
    await queryRunner.query(`
      CREATE TABLE "order_status_history" (
        "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "orderId" UUID NOT NULL,
        "fromStatus" "order_status_enum",
        "toStatus" "order_status_enum" NOT NULL,
        "transitionedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "reason" "order_transition_reason_enum" NOT NULL,
        "metadata" JSONB,
        CONSTRAINT "FK_order_status_history_order"
          FOREIGN KEY ("orderId")
          REFERENCES "order"("id")
          ON DELETE CASCADE
      )
    `);

    // Add table comment
    await queryRunner.query(`
      COMMENT ON TABLE "order_status_history" IS 'Tracks all order status transitions with reasons and metadata'
    `);

    // Add column comments
    await queryRunner.query(`
      COMMENT ON COLUMN "order_status_history"."fromStatus" IS 'Previous status (null for initial creation)'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "order_status_history"."toStatus" IS 'New status after transition'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "order_status_history"."reason" IS 'Reason code for the status change'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "order_status_history"."metadata" IS 'Additional context (exchange data, error messages, etc.)'
    `);

    // Create indexes for common query patterns
    await queryRunner.query(`
      CREATE INDEX "IDX_order_status_history_order_time"
      ON "order_status_history" ("orderId", "transitionedAt")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_order_status_history_time"
      ON "order_status_history" ("transitionedAt")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_order_status_history_transitions"
      ON "order_status_history" ("fromStatus", "toStatus")
    `);

    // Create GIN index for metadata JSONB queries (e.g., finding invalid transitions)
    await queryRunner.query(`
      CREATE INDEX "IDX_order_status_history_metadata"
      ON "order_status_history" USING GIN ("metadata")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_status_history_metadata"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_status_history_transitions"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_status_history_time"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_status_history_order_time"`);

    // Drop table
    await queryRunner.query(`DROP TABLE IF EXISTS "order_status_history"`);

    // Drop enum type
    await queryRunner.query(`DROP TYPE IF EXISTS "order_transition_reason_enum"`);
  }
}
