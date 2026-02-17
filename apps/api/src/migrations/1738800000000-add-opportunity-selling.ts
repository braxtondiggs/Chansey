import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOpportunitySelling1738800000000 implements MigrationInterface {
  name = 'AddOpportunitySelling1738800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum type for opportunity sell decisions
    await queryRunner.query(`
      CREATE TYPE "opportunity_sell_decision_enum" AS ENUM (
        'approved',
        'rejected_disabled',
        'rejected_low_confidence',
        'rejected_no_eligible',
        'rejected_insufficient_proceeds',
        'rejected_max_liquidation'
      )
    `);

    // Create the opportunity_sell_evaluations table
    await queryRunner.query(`
      CREATE TABLE "opportunity_sell_evaluations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "buySignalCoinId" varchar(100) NOT NULL,
        "buySignalConfidence" decimal(5,4) NOT NULL,
        "shortfall" decimal(20,8) NOT NULL,
        "availableCash" decimal(20,8) NOT NULL,
        "portfolioValue" decimal(20,8) NOT NULL,
        "projectedProceeds" decimal(20,8) NOT NULL,
        "decision" "opportunity_sell_decision_enum" NOT NULL,
        "reason" text NOT NULL,
        "evaluationDetails" jsonb NOT NULL,
        "isBacktest" boolean NOT NULL DEFAULT false,
        "backtestId" uuid,
        "evaluatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_opportunity_sell_evaluations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_opportunity_sell_evaluations_user" FOREIGN KEY ("user_id")
          REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    // Create indexes
    await queryRunner.query(
      `CREATE INDEX "IDX_opp_sell_user_evaluated" ON "opportunity_sell_evaluations" ("user_id", "evaluatedAt")`
    );
    await queryRunner.query(`CREATE INDEX "IDX_opp_sell_decision" ON "opportunity_sell_evaluations" ("decision")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_opp_sell_buy_coin" ON "opportunity_sell_evaluations" ("buySignalCoinId")`
    );

    // Add opportunity selling columns to user table
    await queryRunner.query(`
      ALTER TABLE "user"
      ADD COLUMN "enableOpportunitySelling" boolean NOT NULL DEFAULT false
    `);

    const defaultConfig = JSON.stringify({
      minOpportunityConfidence: 0.7,
      minHoldingPeriodHours: 48,
      protectGainsAbovePercent: 15,
      protectedCoins: [],
      minOpportunityAdvantagePercent: 10,
      maxLiquidationPercent: 30,
      useAlgorithmRanking: true
    });

    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN "opportunitySellingConfig" jsonb NOT NULL DEFAULT $$${defaultConfig}$$`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove user columns
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "opportunitySellingConfig"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "enableOpportunitySelling"`);

    // Drop indexes
    await queryRunner.query(`DROP INDEX "IDX_opp_sell_buy_coin"`);
    await queryRunner.query(`DROP INDEX "IDX_opp_sell_decision"`);
    await queryRunner.query(`DROP INDEX "IDX_opp_sell_user_evaluated"`);

    // Drop table
    await queryRunner.query(`DROP TABLE "opportunity_sell_evaluations"`);

    // Drop enum type
    await queryRunner.query(`DROP TYPE "opportunity_sell_decision_enum"`);
  }
}
