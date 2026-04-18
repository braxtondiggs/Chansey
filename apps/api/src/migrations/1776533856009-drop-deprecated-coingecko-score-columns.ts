import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class DropDeprecatedCoingeckoScoreColumns1776533856009 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "coin" DROP COLUMN IF EXISTS "developerScore"`);
    await queryRunner.query(`ALTER TABLE "coin" DROP COLUMN IF EXISTS "communityScore"`);
    await queryRunner.query(`ALTER TABLE "coin" DROP COLUMN IF EXISTS "liquidityScore"`);
    await queryRunner.query(`ALTER TABLE "coin" DROP COLUMN IF EXISTS "publicInterestScore"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "coin" ADD COLUMN "developerScore" DECIMAL(5, 2) NULL`);
    await queryRunner.query(`ALTER TABLE "coin" ADD COLUMN "communityScore" DECIMAL(5, 2) NULL`);
    await queryRunner.query(`ALTER TABLE "coin" ADD COLUMN "liquidityScore" DECIMAL(5, 2) NULL`);
    await queryRunner.query(`ALTER TABLE "coin" ADD COLUMN "publicInterestScore" DECIMAL(5, 2) NULL`);
  }
}
