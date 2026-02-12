import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPositionExitErrorStatus1738800000000 implements MigrationInterface {
  name = 'AddPositionExitErrorStatus1738800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE position_exit_status ADD VALUE IF NOT EXISTS 'error'`);
  }

  public async down(): Promise<void> {
    // PostgreSQL does not support removing individual enum values.
    // The 'error' value will remain in the type but is harmless if unused.
  }
}
