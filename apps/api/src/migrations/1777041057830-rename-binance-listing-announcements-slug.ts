import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class RenameBinanceListingAnnouncementsSlug1777041057830 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "listing_announcements" SET "exchangeSlug" = 'binance_us' WHERE "exchangeSlug" = 'binance'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "listing_announcements" SET "exchangeSlug" = 'binance' WHERE "exchangeSlug" = 'binance_us'`
    );
  }
}
