import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSecurityAuditLog1736500000000 implements MigrationInterface {
  name = 'CreateSecurityAuditLog1736500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum type for security events
    await queryRunner.query(`
      CREATE TYPE "security_event_type_enum" AS ENUM (
        'LOGIN_SUCCESS',
        'LOGIN_FAILED',
        'LOGOUT',
        'ACCOUNT_LOCKED',
        'PASSWORD_CHANGED',
        'PASSWORD_RESET_REQUESTED',
        'PASSWORD_RESET_COMPLETED',
        'EMAIL_VERIFICATION_SENT',
        'EMAIL_VERIFIED',
        'OTP_ENABLED',
        'OTP_DISABLED',
        'OTP_SENT',
        'OTP_VERIFIED',
        'OTP_FAILED',
        'REGISTRATION'
      )
    `);

    // Create the security audit log table
    await queryRunner.query(`
      CREATE TABLE "security_audit_log" (
        "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "userId" character varying,
        "eventType" "security_event_type_enum" NOT NULL,
        "email" character varying,
        "ipAddress" character varying,
        "userAgent" character varying,
        "metadata" jsonb,
        "success" boolean NOT NULL DEFAULT false,
        "failureReason" character varying,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);

    // Create indexes for common query patterns
    await queryRunner.query(`
      CREATE INDEX "IDX_security_audit_log_userId" ON "security_audit_log" ("userId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_security_audit_log_userId_createdAt" ON "security_audit_log" ("userId", "createdAt")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_security_audit_log_eventType_createdAt" ON "security_audit_log" ("eventType", "createdAt")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_security_audit_log_email" ON "security_audit_log" ("email")
    `);

    // Add comment for documentation
    await queryRunner.query(`
      COMMENT ON TABLE "security_audit_log" IS 'Audit log for security-related events (logins, password changes, etc.)'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_security_audit_log_email"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_security_audit_log_eventType_createdAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_security_audit_log_userId_createdAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_security_audit_log_userId"`);

    // Drop table
    await queryRunner.query(`DROP TABLE IF EXISTS "security_audit_log"`);

    // Drop enum type
    await queryRunner.query(`DROP TYPE IF EXISTS "security_event_type_enum"`);
  }
}
