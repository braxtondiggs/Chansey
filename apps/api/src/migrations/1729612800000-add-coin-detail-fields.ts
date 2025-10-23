import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddCoinDetailFields1729612800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add links column (JSONB for external resource links)
    await queryRunner.addColumn(
      'coin',
      new TableColumn({
        name: 'links',
        type: 'jsonb',
        isNullable: true,
        default: null
      })
    );

    // Add metadataLastUpdated column (track when description/links were last refreshed)
    await queryRunner.addColumn(
      'coin',
      new TableColumn({
        name: 'metadataLastUpdated',
        type: 'timestamptz',
        isNullable: true,
        default: null
      })
    );

    // Note: slug and description already exist in the Coin entity, no migration needed for those fields
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('coin', 'metadataLastUpdated');
    await queryRunner.dropColumn('coin', 'links');
  }
}
