import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConvertRolesToEnum1738300000000 implements MigrationInterface {
  name = 'ConvertRolesToEnum1738300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the role enum type
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "role_enum" AS ENUM ('user', 'admin');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Add a temporary column with the new enum array type
    await queryRunner.query(`
      ALTER TABLE "user"
      ADD COLUMN "roles_new" role_enum[] DEFAULT '{user}'
    `);

    // Migrate existing data from text to enum array
    // Handle comma-separated values from simple-array format
    await queryRunner.query(`
      UPDATE "user"
      SET "roles_new" = (
        SELECT array_agg(LOWER(trim(role))::role_enum)
        FROM unnest(string_to_array("roles", ',')) AS role
        WHERE trim(role) != ''
      )
      WHERE "roles" IS NOT NULL AND "roles" != ''
    `);

    // Set default for any NULL values
    await queryRunner.query(`
      UPDATE "user"
      SET "roles_new" = '{user}'
      WHERE "roles_new" IS NULL OR cardinality("roles_new") = 0
    `);

    // Drop the old column
    await queryRunner.query(`
      ALTER TABLE "user"
      DROP COLUMN "roles"
    `);

    // Rename the new column to the original name
    await queryRunner.query(`
      ALTER TABLE "user"
      RENAME COLUMN "roles_new" TO "roles"
    `);

    // Set NOT NULL constraint and default
    await queryRunner.query(`
      ALTER TABLE "user"
      ALTER COLUMN "roles" SET NOT NULL,
      ALTER COLUMN "roles" SET DEFAULT '{user}'
    `);

    // Update comment
    await queryRunner.query(`
      COMMENT ON COLUMN "user"."roles" IS 'User roles as enum array (user, admin)'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Add temporary column to hold varchar data
    await queryRunner.query(`
      ALTER TABLE "user"
      ADD COLUMN "roles_old" VARCHAR(255) DEFAULT 'user'
    `);

    // Convert enum array back to comma-separated string
    await queryRunner.query(`
      UPDATE "user"
      SET "roles_old" = array_to_string("roles", ',')
    `);

    // Drop the enum array column
    await queryRunner.query(`
      ALTER TABLE "user"
      DROP COLUMN "roles"
    `);

    // Rename back to original
    await queryRunner.query(`
      ALTER TABLE "user"
      RENAME COLUMN "roles_old" TO "roles"
    `);

    // Set NOT NULL constraint
    await queryRunner.query(`
      ALTER TABLE "user"
      ALTER COLUMN "roles" SET NOT NULL
    `);

    // Drop the enum type
    await queryRunner.query(`
      DROP TYPE IF EXISTS "role_enum"
    `);

    // Update comment
    await queryRunner.query(`
      COMMENT ON COLUMN "user"."roles" IS 'Comma-separated list of user roles (user, admin)'
    `);
  }
}
