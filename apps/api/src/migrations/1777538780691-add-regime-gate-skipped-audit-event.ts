import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddRegimeGateSkippedAuditEvent1777538780691 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Adding a new enum value requires running outside of a transaction in PostgreSQL
    await queryRunner.query(`COMMIT`);
    await queryRunner.query(`ALTER TYPE "audit_logs_eventtype_enum" ADD VALUE IF NOT EXISTS 'REGIME_GATE_SKIPPED'`);
    await queryRunner.query(`BEGIN`);
  }

  public async down(): Promise<void> {
    // PostgreSQL does not support removing enum values.
  }
}
