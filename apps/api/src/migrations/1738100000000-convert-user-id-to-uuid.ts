import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConvertUserIdToUuid1738100000000 implements MigrationInterface {
  name = 'ConvertUserIdToUuid1738100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Data-preserving migration: converts existing UUID strings (VARCHAR) to native UUID type
    // Assumes existing user.id values are valid UUID format (e.g., 'a1b2c3d4-e5f6-7890-abcd-ef1234567890')

    // Step 1: Drop all foreign key constraints
    await queryRunner.query(
      `ALTER TABLE "algorithm_activations" DROP CONSTRAINT IF EXISTS "FK_ed28233c4f2a303f1fd43854554"`
    );
    await queryRunner.query(
      `ALTER TABLE "algorithm_performances" DROP CONSTRAINT IF EXISTS "FK_fe4a4ddd0574409233b6be1cdcf"`
    );
    await queryRunner.query(`ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "FK_cfa83f61e4d27a87fcae1e025ab"`);
    await queryRunner.query(`ALTER TABLE "backtests" DROP CONSTRAINT IF EXISTS "FK_df3cb58568b4f661bcd4e3457d3"`);
    await queryRunner.query(
      `ALTER TABLE "comparison_reports" DROP CONSTRAINT IF EXISTS "FK_a63f59da76e8eb44c29da80c337"`
    );
    await queryRunner.query(`ALTER TABLE "exchange_key" DROP CONSTRAINT IF EXISTS "FK_0c01bc4e9290300a1da5dd3b2a0"`);
    await queryRunner.query(
      `ALTER TABLE "historical_balance" DROP CONSTRAINT IF EXISTS "FK_596b5ec4e31235f71ddc5de573b"`
    );
    await queryRunner.query(`ALTER TABLE "order" DROP CONSTRAINT IF EXISTS "FK_caabe91507b3379c7ba73637b84"`);
    await queryRunner.query(
      `ALTER TABLE "paper_trading_sessions" DROP CONSTRAINT IF EXISTS "FK_93bc7a7a1ad8d84838bf7eea3b7"`
    );
    await queryRunner.query(`ALTER TABLE "portfolio" DROP CONSTRAINT IF EXISTS "FK_9d041c43c782a9135df1388ae16"`);
    await queryRunner.query(`ALTER TABLE "position_exits" DROP CONSTRAINT IF EXISTS "FK_4f6d2d61d229cc17f35ed93e414"`);
    await queryRunner.query(
      `ALTER TABLE "strategy_configs" DROP CONSTRAINT IF EXISTS "FK_bf45d08e534e60dfbc37f24a8d9"`
    );
    await queryRunner.query(
      `ALTER TABLE "user_strategy_positions" DROP CONSTRAINT IF EXISTS "FK_9304a6d4c99e18905c22f39e020"`
    );

    // Step 2: Clean up orphaned rows (rows with null or invalid userId references)
    // This prevents errors when converting to UUID NOT NULL columns
    await queryRunner.query(`DELETE FROM "algorithm_activations" WHERE "userId" IS NULL OR "userId" = ''`);
    await queryRunner.query(`DELETE FROM "algorithm_performances" WHERE "userId" IS NULL OR "userId" = ''`);
    await queryRunner.query(`DELETE FROM "backtests" WHERE "userId" IS NULL OR "userId" = ''`);
    await queryRunner.query(
      `DELETE FROM "comparison_reports" WHERE "createdByUserId" IS NULL OR "createdByUserId" = ''`
    );
    await queryRunner.query(`DELETE FROM "exchange_key" WHERE "userId" IS NULL OR "userId" = ''`);
    await queryRunner.query(`DELETE FROM "historical_balance" WHERE "userId" IS NULL OR "userId" = ''`);
    await queryRunner.query(`DELETE FROM "order" WHERE "userId" IS NULL OR "userId" = ''`);
    await queryRunner.query(`DELETE FROM "paper_trading_sessions" WHERE "userId" IS NULL OR "userId" = ''`);
    await queryRunner.query(`DELETE FROM "portfolio" WHERE "userId" IS NULL OR "userId" = ''`);
    await queryRunner.query(`DELETE FROM "position_exits" WHERE "user_id" IS NULL OR "user_id" = ''`);
    await queryRunner.query(`DELETE FROM "strategy_configs" WHERE "createdBy" IS NULL OR "createdBy" = ''`);
    await queryRunner.query(`DELETE FROM "user_strategy_positions" WHERE "userId" IS NULL OR "userId" = ''`);

    // Step 3: Convert user.id from VARCHAR to UUID (preserving existing values)
    await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "id" TYPE UUID USING "id"::uuid`);
    await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()`);

    // Step 4: Convert all foreign key columns from VARCHAR to UUID (preserving existing values)
    // For nullable columns, use NULLIF to handle empty strings gracefully
    await queryRunner.query(`ALTER TABLE "algorithm_activations" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid`);
    await queryRunner.query(
      `ALTER TABLE "algorithm_performances" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid`
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ALTER COLUMN "userId" TYPE UUID USING NULLIF("userId", '')::uuid`
    );
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid`);
    await queryRunner.query(
      `ALTER TABLE "comparison_reports" ALTER COLUMN "createdByUserId" TYPE UUID USING "createdByUserId"::uuid`
    );
    await queryRunner.query(`ALTER TABLE "exchange_key" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid`);
    await queryRunner.query(`ALTER TABLE "historical_balance" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid`);
    await queryRunner.query(`ALTER TABLE "order" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid`);
    await queryRunner.query(
      `ALTER TABLE "paper_trading_sessions" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid`
    );
    await queryRunner.query(`ALTER TABLE "portfolio" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid`);
    await queryRunner.query(`ALTER TABLE "position_exits" ALTER COLUMN "user_id" TYPE UUID USING "user_id"::uuid`);
    await queryRunner.query(
      `ALTER TABLE "security_audit_log" ALTER COLUMN "userId" TYPE UUID USING NULLIF("userId", '')::uuid`
    );
    await queryRunner.query(
      `ALTER TABLE "strategy_configs" ALTER COLUMN "createdBy" TYPE UUID USING "createdBy"::uuid`
    );
    await queryRunner.query(
      `ALTER TABLE "user_strategy_positions" ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid`
    );

    // Step 5: Re-add foreign key constraints
    await queryRunner.query(
      `ALTER TABLE "algorithm_activations" ADD CONSTRAINT "FK_ed28233c4f2a303f1fd43854554" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE`
    );
    await queryRunner.query(
      `ALTER TABLE "algorithm_performances" ADD CONSTRAINT "FK_fe4a4ddd0574409233b6be1cdcf" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE`
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_cfa83f61e4d27a87fcae1e025ab" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "backtests" ADD CONSTRAINT "FK_df3cb58568b4f661bcd4e3457d3" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE`
    );
    await queryRunner.query(
      `ALTER TABLE "comparison_reports" ADD CONSTRAINT "FK_a63f59da76e8eb44c29da80c337" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE CASCADE`
    );
    await queryRunner.query(
      `ALTER TABLE "exchange_key" ADD CONSTRAINT "FK_0c01bc4e9290300a1da5dd3b2a0" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE`
    );
    await queryRunner.query(
      `ALTER TABLE "historical_balance" ADD CONSTRAINT "FK_596b5ec4e31235f71ddc5de573b" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE`
    );
    await queryRunner.query(
      `ALTER TABLE "order" ADD CONSTRAINT "FK_caabe91507b3379c7ba73637b84" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE`
    );
    await queryRunner.query(
      `ALTER TABLE "paper_trading_sessions" ADD CONSTRAINT "FK_93bc7a7a1ad8d84838bf7eea3b7" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE`
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio" ADD CONSTRAINT "FK_9d041c43c782a9135df1388ae16" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE`
    );
    await queryRunner.query(
      `ALTER TABLE "position_exits" ADD CONSTRAINT "FK_4f6d2d61d229cc17f35ed93e414" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE`
    );
    await queryRunner.query(
      `ALTER TABLE "strategy_configs" ADD CONSTRAINT "FK_bf45d08e534e60dfbc37f24a8d9" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE`
    );
    await queryRunner.query(
      `ALTER TABLE "user_strategy_positions" ADD CONSTRAINT "FK_9304a6d4c99e18905c22f39e020" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Step 1: Drop foreign key constraints
    await queryRunner.query(
      `ALTER TABLE "algorithm_activations" DROP CONSTRAINT IF EXISTS "FK_ed28233c4f2a303f1fd43854554"`
    );
    await queryRunner.query(
      `ALTER TABLE "algorithm_performances" DROP CONSTRAINT IF EXISTS "FK_fe4a4ddd0574409233b6be1cdcf"`
    );
    await queryRunner.query(`ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "FK_cfa83f61e4d27a87fcae1e025ab"`);
    await queryRunner.query(`ALTER TABLE "backtests" DROP CONSTRAINT IF EXISTS "FK_df3cb58568b4f661bcd4e3457d3"`);
    await queryRunner.query(
      `ALTER TABLE "comparison_reports" DROP CONSTRAINT IF EXISTS "FK_a63f59da76e8eb44c29da80c337"`
    );
    await queryRunner.query(`ALTER TABLE "exchange_key" DROP CONSTRAINT IF EXISTS "FK_0c01bc4e9290300a1da5dd3b2a0"`);
    await queryRunner.query(
      `ALTER TABLE "historical_balance" DROP CONSTRAINT IF EXISTS "FK_596b5ec4e31235f71ddc5de573b"`
    );
    await queryRunner.query(`ALTER TABLE "order" DROP CONSTRAINT IF EXISTS "FK_caabe91507b3379c7ba73637b84"`);
    await queryRunner.query(
      `ALTER TABLE "paper_trading_sessions" DROP CONSTRAINT IF EXISTS "FK_93bc7a7a1ad8d84838bf7eea3b7"`
    );
    await queryRunner.query(`ALTER TABLE "portfolio" DROP CONSTRAINT IF EXISTS "FK_9d041c43c782a9135df1388ae16"`);
    await queryRunner.query(`ALTER TABLE "position_exits" DROP CONSTRAINT IF EXISTS "FK_4f6d2d61d229cc17f35ed93e414"`);
    await queryRunner.query(
      `ALTER TABLE "strategy_configs" DROP CONSTRAINT IF EXISTS "FK_bf45d08e534e60dfbc37f24a8d9"`
    );
    await queryRunner.query(
      `ALTER TABLE "user_strategy_positions" DROP CONSTRAINT IF EXISTS "FK_9304a6d4c99e18905c22f39e020"`
    );

    // Step 2: Revert user.id from UUID back to VARCHAR
    await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "id" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "id" TYPE VARCHAR(255) USING "id"::text`);

    // Step 3: Revert all foreign key columns from UUID back to VARCHAR
    await queryRunner.query(
      `ALTER TABLE "algorithm_activations" ALTER COLUMN "userId" TYPE VARCHAR(255) USING "userId"::text`
    );
    await queryRunner.query(
      `ALTER TABLE "algorithm_performances" ALTER COLUMN "userId" TYPE VARCHAR(255) USING "userId"::text`
    );
    await queryRunner.query(`ALTER TABLE "audit_logs" ALTER COLUMN "userId" TYPE VARCHAR(255) USING "userId"::text`);
    await queryRunner.query(`ALTER TABLE "backtests" ALTER COLUMN "userId" TYPE VARCHAR(255) USING "userId"::text`);
    await queryRunner.query(
      `ALTER TABLE "comparison_reports" ALTER COLUMN "createdByUserId" TYPE VARCHAR(255) USING "createdByUserId"::text`
    );
    await queryRunner.query(`ALTER TABLE "exchange_key" ALTER COLUMN "userId" TYPE VARCHAR(255) USING "userId"::text`);
    await queryRunner.query(
      `ALTER TABLE "historical_balance" ALTER COLUMN "userId" TYPE VARCHAR(255) USING "userId"::text`
    );
    await queryRunner.query(`ALTER TABLE "order" ALTER COLUMN "userId" TYPE VARCHAR(255) USING "userId"::text`);
    await queryRunner.query(
      `ALTER TABLE "paper_trading_sessions" ALTER COLUMN "userId" TYPE VARCHAR(255) USING "userId"::text`
    );
    await queryRunner.query(`ALTER TABLE "portfolio" ALTER COLUMN "userId" TYPE VARCHAR(255) USING "userId"::text`);
    await queryRunner.query(
      `ALTER TABLE "position_exits" ALTER COLUMN "user_id" TYPE VARCHAR(255) USING "user_id"::text`
    );
    await queryRunner.query(
      `ALTER TABLE "security_audit_log" ALTER COLUMN "userId" TYPE VARCHAR(255) USING "userId"::text`
    );
    await queryRunner.query(
      `ALTER TABLE "strategy_configs" ALTER COLUMN "createdBy" TYPE VARCHAR(255) USING "createdBy"::text`
    );
    await queryRunner.query(
      `ALTER TABLE "user_strategy_positions" ALTER COLUMN "userId" TYPE VARCHAR(255) USING "userId"::text`
    );

    // Step 4: Re-add foreign key constraints
    await queryRunner.query(
      `ALTER TABLE "algorithm_activations" ADD CONSTRAINT "FK_ed28233c4f2a303f1fd43854554" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE`
    );
    await queryRunner.query(
      `ALTER TABLE "algorithm_performances" ADD CONSTRAINT "FK_fe4a4ddd0574409233b6be1cdcf" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE`
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_cfa83f61e4d27a87fcae1e025ab" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "backtests" ADD CONSTRAINT "FK_df3cb58568b4f661bcd4e3457d3" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE`
    );
    await queryRunner.query(
      `ALTER TABLE "comparison_reports" ADD CONSTRAINT "FK_a63f59da76e8eb44c29da80c337" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE CASCADE`
    );
    await queryRunner.query(
      `ALTER TABLE "exchange_key" ADD CONSTRAINT "FK_0c01bc4e9290300a1da5dd3b2a0" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE`
    );
    await queryRunner.query(
      `ALTER TABLE "historical_balance" ADD CONSTRAINT "FK_596b5ec4e31235f71ddc5de573b" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE`
    );
    await queryRunner.query(
      `ALTER TABLE "order" ADD CONSTRAINT "FK_caabe91507b3379c7ba73637b84" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE`
    );
    await queryRunner.query(
      `ALTER TABLE "paper_trading_sessions" ADD CONSTRAINT "FK_93bc7a7a1ad8d84838bf7eea3b7" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE`
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio" ADD CONSTRAINT "FK_9d041c43c782a9135df1388ae16" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE`
    );
    await queryRunner.query(
      `ALTER TABLE "position_exits" ADD CONSTRAINT "FK_4f6d2d61d229cc17f35ed93e414" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE`
    );
    await queryRunner.query(
      `ALTER TABLE "strategy_configs" ADD CONSTRAINT "FK_bf45d08e534e60dfbc37f24a8d9" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE`
    );
    await queryRunner.query(
      `ALTER TABLE "user_strategy_positions" ADD CONSTRAINT "FK_9304a6d4c99e18905c22f39e020" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE`
    );
  }
}
