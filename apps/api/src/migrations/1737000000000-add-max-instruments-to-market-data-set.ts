import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMaxInstrumentsToMarketDataSet1737000000000 implements MigrationInterface {
  name = 'AddMaxInstrumentsToMarketDataSet1737000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "market_data_sets"
      ADD COLUMN "maxInstruments" integer DEFAULT 50
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "market_data_sets"
      DROP COLUMN "maxInstruments"
    `);
  }
}
