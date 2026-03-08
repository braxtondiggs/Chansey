import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveExchangeKeyFromActivationsAndPipelines1741200000000 implements MigrationInterface {
  name = 'RemoveExchangeKeyFromActivationsAndPipelines1741200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop FK and index on algorithm_activations.exchangeKeyId
    await queryRunner.query(
      `ALTER TABLE "algorithm_activations" DROP CONSTRAINT IF EXISTS "FK_algorithm_activations_exchangeKeyId"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_algorithm_activations_exchangeKeyId"`);
    // Also drop the generic index name that TypeORM may have generated
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_exchangeKeyId"`);
    await queryRunner.query(`ALTER TABLE "algorithm_activations" DROP COLUMN IF EXISTS "exchangeKeyId"`);

    // 2. Drop FK and column on pipelines.exchangeKeyId
    await queryRunner.query(`ALTER TABLE "pipelines" DROP CONSTRAINT IF EXISTS "fk_pipelines_exchange_key"`);
    await queryRunner.query(`ALTER TABLE "pipelines" DROP CONSTRAINT IF EXISTS "FK_pipelines_exchangeKeyId"`);
    await queryRunner.query(`ALTER TABLE "pipelines" DROP COLUMN IF EXISTS "exchangeKeyId"`);

    // 3. Add exchangeKeyId column to user_strategy_positions
    await queryRunner.query(`ALTER TABLE "user_strategy_positions" ADD "exchangeKeyId" uuid`);

    // 4. Add FK constraint on user_strategy_positions.exchangeKeyId → exchange_key.id
    await queryRunner.query(
      `ALTER TABLE "user_strategy_positions" ADD CONSTRAINT "FK_user_strategy_positions_exchangeKeyId" FOREIGN KEY ("exchangeKeyId") REFERENCES "exchange_key"("id") ON DELETE SET NULL ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop FK and column from user_strategy_positions
    await queryRunner.query(
      `ALTER TABLE "user_strategy_positions" DROP CONSTRAINT IF EXISTS "FK_user_strategy_positions_exchangeKeyId"`
    );
    await queryRunner.query(`ALTER TABLE "user_strategy_positions" DROP COLUMN IF EXISTS "exchangeKeyId"`);

    // 2. Re-add exchangeKeyId to pipelines
    await queryRunner.query(`ALTER TABLE "pipelines" ADD "exchangeKeyId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "pipelines" ADD CONSTRAINT "fk_pipelines_exchange_key" FOREIGN KEY ("exchangeKeyId") REFERENCES "exchange_key"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );

    // 3. Re-add exchangeKeyId to algorithm_activations
    await queryRunner.query(`ALTER TABLE "algorithm_activations" ADD "exchangeKeyId" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_algorithm_activations_exchangeKeyId" ON "algorithm_activations" ("exchangeKeyId")`
    );
    await queryRunner.query(
      `ALTER TABLE "algorithm_activations" ADD CONSTRAINT "FK_algorithm_activations_exchangeKeyId" FOREIGN KEY ("exchangeKeyId") REFERENCES "exchange_key"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
  }
}
