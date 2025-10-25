import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLiveReplaySupport20251023182000 implements MigrationInterface {
  name = 'AddLiveReplaySupport20251023182000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type t
          JOIN pg_enum e ON t.oid = e.enumtypid
          WHERE t.typname = 'backtests_type_enum' AND e.enumlabel = 'LIVE_REPLAY'
        ) THEN
          ALTER TYPE "backtests_type_enum" ADD VALUE 'LIVE_REPLAY';
        END IF;
      END$$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type t
          JOIN pg_enum e ON t.oid = e.enumtypid
          WHERE t.typname = 'backtests_status_enum' AND e.enumlabel = 'PAUSED'
        ) THEN
          ALTER TYPE "backtests_status_enum" ADD VALUE 'PAUSED';
        END IF;
      END$$;
    `);
  }

  public async down(): Promise<void> {
    // Postgres does not support removing enum values in a straightforward way.
    // This migration intentionally leaves the added enum values in place on rollback.
  }
}
