import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNativeAuthColumns1736400000000 implements MigrationInterface {
  name = 'AddNativeAuthColumns1736400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add authentication columns to user table
    await queryRunner.query(`
      ALTER TABLE "user"
      ADD COLUMN IF NOT EXISTS "passwordHash" VARCHAR(255),
      ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "emailVerificationToken" VARCHAR(255),
      ADD COLUMN IF NOT EXISTS "emailVerificationTokenExpiresAt" TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS "otpHash" VARCHAR(255),
      ADD COLUMN IF NOT EXISTS "otpExpiresAt" TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS "otpEnabled" BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "otpFailedAttempts" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "passwordResetToken" VARCHAR(255),
      ADD COLUMN IF NOT EXISTS "passwordResetTokenExpiresAt" TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS "roles" VARCHAR(255) NOT NULL DEFAULT 'user',
      ADD COLUMN IF NOT EXISTS "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMPTZ
    `);

    // Add comments for documentation
    await queryRunner.query(`
      COMMENT ON COLUMN "user"."passwordHash" IS 'Bcrypt hashed password (12 rounds)'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "user"."emailVerified" IS 'Whether user has verified their email address'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "user"."emailVerificationToken" IS 'Token for email verification (expires in 24h)'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "user"."otpHash" IS 'Bcrypt hashed OTP code for 2FA login (expires in 10m)'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "user"."otpEnabled" IS 'Whether email-based OTP is enabled for user'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "user"."otpFailedAttempts" IS 'Counter for OTP brute force protection (locks after 3 attempts)'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "user"."passwordResetToken" IS 'Token for password reset (expires in 1h)'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "user"."roles" IS 'Comma-separated list of user roles (user, admin)'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "user"."failedLoginAttempts" IS 'Counter for brute force protection (locks after 5 attempts)'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "user"."lockedUntil" IS 'Account lockout expiration (15 minutes after 5 failed attempts)'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "user"."lastLoginAt" IS 'Timestamp of last successful login'
    `);

    // Create index for email lookups (used in login/registration)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_email" ON "user" ("email")
    `);

    // Create index for password reset token lookups
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_passwordResetToken"
      ON "user" ("passwordResetToken") WHERE "passwordResetToken" IS NOT NULL
    `);

    // Create index for email verification token lookups
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_emailVerificationToken"
      ON "user" ("emailVerificationToken") WHERE "emailVerificationToken" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes first
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_emailVerificationToken"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_passwordResetToken"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_email"`);

    // Drop columns
    await queryRunner.query(`
      ALTER TABLE "user"
      DROP COLUMN IF EXISTS "passwordHash",
      DROP COLUMN IF EXISTS "emailVerified",
      DROP COLUMN IF EXISTS "emailVerificationToken",
      DROP COLUMN IF EXISTS "emailVerificationTokenExpiresAt",
      DROP COLUMN IF EXISTS "otpHash",
      DROP COLUMN IF EXISTS "otpExpiresAt",
      DROP COLUMN IF EXISTS "otpEnabled",
      DROP COLUMN IF EXISTS "otpFailedAttempts",
      DROP COLUMN IF EXISTS "passwordResetToken",
      DROP COLUMN IF EXISTS "passwordResetTokenExpiresAt",
      DROP COLUMN IF EXISTS "roles",
      DROP COLUMN IF EXISTS "failedLoginAttempts",
      DROP COLUMN IF EXISTS "lockedUntil",
      DROP COLUMN IF EXISTS "lastLoginAt"
    `);
  }
}
