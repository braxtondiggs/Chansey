import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRiskTable implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create risk table entries
    await queryRunner.query(`
      INSERT INTO risk (name, description, level) VALUES
      ('Conservative', 'Low risk, stable returns', 1),
      ('Moderately Conservative', 'Low to medium risk', 2),
      ('Moderate', 'Balanced risk and return', 3),
      ('Moderately Aggressive', 'Higher risk for higher returns', 4),
      ('Aggressive', 'Highest risk for maximum returns', 5),
      ('Custom', 'Personalized risk profile', 6);
    `);

    // Set default risk to Moderate
    await queryRunner.query(`
      ALTER TABLE "user"
      ALTER COLUMN risk_id SET DEFAULT (
        SELECT id FROM risk WHERE name = 'Moderate'
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user" ALTER COLUMN risk_id DROP DEFAULT;
      DELETE FROM risk;
      DROP TABLE "risk";
    `);
  }
}
