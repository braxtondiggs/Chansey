import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddConcentrationLimit1741200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "deployments" ADD COLUMN "concentrationLimit" decimal(10,4) NULL`);
    await queryRunner.query(
      `COMMENT ON COLUMN "deployments"."concentrationLimit" IS 'Max single-asset concentration limit (decimal, 0.35 = 35%). NULL = use risk-level default.'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "deployments" DROP COLUMN "concentrationLimit"`);
  }
}
