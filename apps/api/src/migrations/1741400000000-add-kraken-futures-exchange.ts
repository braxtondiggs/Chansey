import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKrakenFuturesExchange1741400000000 implements MigrationInterface {
  name = 'AddKrakenFuturesExchange1741400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "exchange" ("id", "slug", "name", "description", "supported", "isScraped", "centralized", "url", "country")
       VALUES (
         gen_random_uuid(),
         'kraken_futures',
         'Kraken Futures',
         'Kraken Futures (futures.kraken.com) — a separate derivatives exchange from Kraken Spot, offering perpetual and fixed-maturity futures contracts.',
         true,
         false,
         true,
         'https://futures.kraken.com',
         'United Kingdom'
       )`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "exchange" WHERE "slug" = 'kraken_futures'`);
  }
}
