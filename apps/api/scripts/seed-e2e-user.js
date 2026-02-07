/**
 * Seeds the E2E test user into the database.
 * Used by the CI E2E workflow after the API starts (schema created via synchronize).
 *
 * Requires PG* env vars (PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT).
 */
const bcrypt = require('bcrypt');
const { Client } = require('pg');

async function seed() {
  const client = new Client();
  await client.connect();

  const hash = await bcrypt.hash('Test123!@#', 12);

  await client.query(
    `INSERT INTO "user" (
      id, email, given_name, family_name, "passwordHash", "emailVerified",
      roles, "failedLoginAttempts", "otpEnabled", "otpFailedAttempts",
      hide_balance, "algoTradingEnabled", "algoCapitalAllocationPercentage",
      "createdAt", "updatedAt"
    ) VALUES (
      'e2e-test-0000-0000-0000-000000000001', 'e2e-test@chansey.local', 'E2E', 'Test',
      $1, true, '{user}', 0, false, 0, false, false, 25.00, NOW(), NOW()
    )
    ON CONFLICT (email) DO UPDATE SET
      "passwordHash" = $1,
      "emailVerified" = true,
      "failedLoginAttempts" = 0`,
    [hash]
  );

  await client.end();
  console.log('E2E test user seeded successfully');
}

seed().catch((e) => {
  console.error('Failed to seed E2E test user:', e.message);
  process.exit(1);
});
