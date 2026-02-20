import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOptimizationHeartbeat1739100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "optimization_runs" ADD "lastHeartbeatAt" TIMESTAMPTZ`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "optimization_runs" DROP COLUMN "lastHeartbeatAt"`);
  }
}
