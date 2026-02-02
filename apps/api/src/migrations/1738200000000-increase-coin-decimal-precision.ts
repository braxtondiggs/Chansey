import { MigrationInterface, QueryRunner } from 'typeorm';

export class IncreaseCoinDecimalPrecision1738200000000 implements MigrationInterface {
  name = 'IncreaseCoinDecimalPrecision1738200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Increase precision for columns that can have very large values (supply, market cap, volume)
    // From NUMERIC(25,8) to NUMERIC(38,8) to accommodate values up to 10^30
    await queryRunner.query(`ALTER TABLE "coin" ALTER COLUMN "totalSupply" TYPE NUMERIC(38, 8)`);
    await queryRunner.query(`ALTER TABLE "coin" ALTER COLUMN "circulatingSupply" TYPE NUMERIC(38, 8)`);
    await queryRunner.query(`ALTER TABLE "coin" ALTER COLUMN "maxSupply" TYPE NUMERIC(38, 8)`);
    await queryRunner.query(`ALTER TABLE "coin" ALTER COLUMN "marketCap" TYPE NUMERIC(38, 8)`);
    await queryRunner.query(`ALTER TABLE "coin" ALTER COLUMN "totalVolume" TYPE NUMERIC(38, 8)`);
    await queryRunner.query(`ALTER TABLE "coin" ALTER COLUMN "marketCapChange24h" TYPE NUMERIC(38, 8)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert to original precision
    // Note: This may cause data loss if any values exceed the original precision
    await queryRunner.query(`ALTER TABLE "coin" ALTER COLUMN "marketCapChange24h" TYPE NUMERIC(25, 8)`);
    await queryRunner.query(`ALTER TABLE "coin" ALTER COLUMN "totalVolume" TYPE NUMERIC(25, 8)`);
    await queryRunner.query(`ALTER TABLE "coin" ALTER COLUMN "marketCap" TYPE NUMERIC(25, 8)`);
    await queryRunner.query(`ALTER TABLE "coin" ALTER COLUMN "maxSupply" TYPE NUMERIC(25, 8)`);
    await queryRunner.query(`ALTER TABLE "coin" ALTER COLUMN "circulatingSupply" TYPE NUMERIC(25, 8)`);
    await queryRunner.query(`ALTER TABLE "coin" ALTER COLUMN "totalSupply" TYPE NUMERIC(25, 8)`);
  }
}
