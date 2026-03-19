import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWatchedCoinSelectionType1741700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Adding a new enum value requires running outside of a transaction in PostgreSQL
    await queryRunner.query(`COMMIT`);
    await queryRunner.query(`ALTER TYPE coin_selection_type_enum ADD VALUE IF NOT EXISTS 'WATCHED'`);
    await queryRunner.query(`BEGIN`);

    // Migrate existing MANUAL records for non-custom-risk users to WATCHED
    // These are "watch only" selections that were previously conflated with trading selections
    await queryRunner.query(`
      UPDATE coin_selection cs
      SET type = 'WATCHED'
      FROM "user" u
      LEFT JOIN risk r ON u."coinRiskId" = r.id
      WHERE cs."userId" = u.id
        AND cs.type = 'MANUAL'
        AND (r.level IS NULL OR r.level != 6)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert WATCHED records back to MANUAL
    await queryRunner.query(`
      UPDATE coin_selection
      SET type = 'MANUAL'
      WHERE type = 'WATCHED'
    `);

    // Note: PostgreSQL does not support removing enum values
    // The WATCHED value will remain in the enum but won't be used
  }
}
