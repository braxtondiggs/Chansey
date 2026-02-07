import * as bcrypt from 'bcrypt';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedE2eTestUser1738800000000 implements MigrationInterface {
  name = 'SeedE2eTestUser1738800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const passwordHash = await bcrypt.hash('Test123!@#', 12);

    await queryRunner.query(
      `
      INSERT INTO "user" (
        id,
        email,
        given_name,
        family_name,
        "passwordHash",
        "emailVerified",
        roles,
        "failedLoginAttempts",
        "otpEnabled",
        "otpFailedAttempts",
        hide_balance,
        "algoTradingEnabled",
        "algoCapitalAllocationPercentage",
        "createdAt",
        "updatedAt"
      ) VALUES (
        'e2e-test-0000-0000-0000-000000000001',
        'e2e-test@chansey.local',
        'E2E',
        'Test',
        $1,
        true,
        '{user}',
        0,
        false,
        0,
        false,
        false,
        25.00,
        NOW(),
        NOW()
      )
      ON CONFLICT (email) DO UPDATE SET
        "passwordHash" = $1,
        "emailVerified" = true,
        "failedLoginAttempts" = 0,
        given_name = 'E2E',
        family_name = 'Test'
    `,
      [passwordHash]
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "user" WHERE email = 'e2e-test@chansey.local'`);
  }
}
